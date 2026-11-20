// コマンドテンプレート（commandTemplates）の入力モーダルへ渡す内容の組み立てと、送る文字列の確定。
// optionsの関数はbun側でしか呼べないため、モーダルを開くたびにここで評価して選択肢の配列へ
// 直してからwebviewへ渡す（ホバーボタンのitemsと同じ方式）。

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type {
  CommandTemplateBuiltinOptions,
  CommandTemplateContext,
  CommandTemplateDefaultFn,
  CommandTemplateOption,
  CommandTemplateOptionsFn,
  Niwa,
  ResolvedCommandTemplateConfig,
} from "@niwaterm/config";
import {
  type CommandTemplateSegment,
  emptyFieldNames,
  fieldNamesOf,
  type PreparedCommandTemplate,
  type PreparedCommandTemplateField,
  renderCommandTemplate,
} from "../shared/command-template";
import { appSupportDir } from "./app-paths";

/** 関数を含む解決済みの欄1つ。並びはcommandに最初に出てきた順 */
export interface CommandTemplateFieldDef {
  name: string;
  label: string;
  /** 未指定は空文字列 */
  placeholder: string;
  /** nullなら自由入力の欄 */
  options:
    | CommandTemplateOption[]
    | CommandTemplateBuiltinOptions
    | CommandTemplateOptionsFn
    | null;
  /** 未指定は空文字列。関数ならモーダルを開くたびに呼ぶ */
  default: string | CommandTemplateDefaultFn;
  quote: boolean;
  focus: boolean;
}

/** 関数を含む解決済みのテンプレート1つ。webviewへ渡せない部分をbun側に残すための型 */
export interface CommandTemplateDef {
  id: string;
  name: string;
  description: string;
  command: string;
  segments: CommandTemplateSegment[];
  fields: CommandTemplateFieldDef[];
  rememberLastValues: boolean;
}

export type CommandTemplateSubmitResult = { ok: true; text: string } | { ok: false; error: string };

/** rememberLastValuesの値の置き場所。テンプレートid → 欄のname → 値 */
export interface RememberedValuesStore {
  get(templateId: string): Record<string, string> | undefined;
  set(templateId: string, values: Record<string, string>): void;
}

export interface CommandTemplatesHandle {
  /** コマンドパレットへ配る一覧（関数を除いたもの）。設定に並べた順 */
  resolved(): ResolvedCommandTemplateConfig[];
  has(id: string): boolean;
  /** モーダルを開くたびに呼ぶ。未知のidならnull */
  prepare(id: string, ctx: CommandTemplateContext): Promise<PreparedCommandTemplate | null>;
  /**
   * モーダルで送られた値からコマンドを組み立てる。空の欄があれば組み立てない。
   * 組み立てられたらrememberLastValuesのテンプレートは値を覚える
   */
  submit(id: string, values: Record<string, string>): CommandTemplateSubmitResult;
}

/** 組み込みの選択肢を作る。ワークスペースは名前を出してidを入れ、今のワークスペースを初期値にする */
function builtinOptions(
  source: CommandTemplateBuiltinOptions,
  niwa: Niwa,
): { options: CommandTemplateOption[]; preferred: string | undefined } {
  switch (source) {
    case "workspace": {
      const workspaces = niwa.workspace.list();
      return {
        // 名前の無いワークスペースの呼び方はサイドバー（sidebar-props.tsのworkspaceLabel）と揃える
        options: workspaces.map((workspace, index) => ({
          label: workspace.name || `Workspace ${index + 1}`,
          value: workspace.id,
          ...(workspace.active ? { description: "今のワークスペース" } : {}),
        })),
        preferred: workspaces.find((workspace) => workspace.active)?.id,
      };
    }
  }
}

/** 関数が返した選択肢を揃える。文字列はlabelとvalueを同じにし、形の崩れた要素は飛ばす */
export function normalizeOptions(list: unknown, scope: string): CommandTemplateOption[] {
  if (!Array.isArray(list)) {
    throw new Error("配列ではありません");
  }
  const options: CommandTemplateOption[] = [];
  for (const item of list) {
    if (typeof item === "string") {
      options.push({ label: item, value: item });
      continue;
    }
    if (typeof item === "object" && item !== null) {
      const v = item as Record<string, unknown>;
      if (typeof v["value"] === "string") {
        options.push({
          label: typeof v["label"] === "string" ? v["label"] : v["value"],
          value: v["value"],
          ...(typeof v["description"] === "string" ? { description: v["description"] } : {}),
        });
        continue;
      }
    }
    console.log(`[bun] ${scope}: ignoring invalid option: ${String(item)}`);
  }
  return options;
}

/** defaultを値へ直す。空文字列・関数の失敗・文字列以外の戻り値は初期値なしとして扱う */
async function resolveDefault(
  field: CommandTemplateFieldDef,
  ctx: CommandTemplateContext,
  niwa: Niwa,
  scope: string,
): Promise<string | undefined> {
  if (typeof field.default === "string") return field.default === "" ? undefined : field.default;
  try {
    const value: unknown = await field.default(ctx, niwa);
    if (value === undefined || typeof value === "string") return value;
    console.log(`[bun] ${scope}: ignoring non-string default: ${String(value)}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.log(`[bun] ${scope}: failed to build default: ${message}`);
  }
  return undefined;
}

async function prepareField(
  field: CommandTemplateFieldDef,
  remembered: string | undefined,
  ctx: CommandTemplateContext,
  niwa: Niwa,
  scope: string,
): Promise<PreparedCommandTemplateField> {
  const base = {
    name: field.name,
    label: field.label,
    placeholder: field.placeholder,
    quote: field.quote,
    focus: field.focus,
  };
  const defaultScope = `${scope}.default`;
  const optionsScope = `${scope}.options`;
  if (field.options === null) {
    const initial = remembered ?? (await resolveDefault(field, ctx, niwa, defaultScope)) ?? "";
    return { ...base, options: null, error: null, initial };
  }

  let options: CommandTemplateOption[];
  let preferred: string | undefined;
  try {
    if (typeof field.options === "function") {
      options = normalizeOptions(await field.options(ctx, niwa), optionsScope);
    } else if (typeof field.options === "string") {
      ({ options, preferred } = builtinOptions(field.options, niwa));
    } else {
      options = field.options;
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.log(`[bun] ${optionsScope}: failed to build options: ${message}`);
    return { ...base, options: [], error: `候補を作れませんでした: ${message}`, initial: "" };
  }

  // 選択肢の欄は選べる値しか入れない。前回の値・defaultが今の候補から消えていたら次の手へ回す。
  // defaultの関数は候補を作り終えてから呼ぶ（候補の関数がgit fetch等で状態を変えた後を見られるように）
  const values = new Set(options.map((option) => option.value));
  const defaultValue = await resolveDefault(field, ctx, niwa, defaultScope);
  const initial =
    [remembered, defaultValue, preferred].find(
      (value): value is string => value !== undefined && values.has(value),
    ) ??
    options[0]?.value ??
    "";
  return { ...base, options, error: null, initial };
}

export function createCommandTemplates(
  defs: CommandTemplateDef[],
  niwa: Niwa,
  store: RememberedValuesStore,
): CommandTemplatesHandle {
  const byId = new Map(defs.map((def) => [def.id, def]));

  return {
    resolved() {
      return defs.map((def) => ({
        id: def.id,
        name: def.name,
        description: def.description,
        command: def.command,
      }));
    },
    has(id) {
      return byId.has(id);
    },
    async prepare(id, ctx) {
      const def = byId.get(id);
      if (!def) return null;
      const remembered = def.rememberLastValues ? store.get(id) : undefined;
      const fields = await Promise.all(
        def.fields.map((field) =>
          prepareField(
            field,
            remembered?.[field.name],
            ctx,
            niwa,
            `commandTemplates.${id}.fields.${field.name}`,
          ),
        ),
      );
      return {
        id: def.id,
        name: def.name,
        description: def.description,
        command: def.command,
        fields,
      };
    },
    submit(id, values) {
      const def = byId.get(id);
      if (!def) return { ok: false, error: `テンプレートが見つかりません: ${id}` };
      const names = fieldNamesOf(def.segments);
      const picked = Object.fromEntries(names.map((name) => [name, values[name] ?? ""]));
      const empty = emptyFieldNames(names, picked);
      if (empty.length > 0) {
        return { ok: false, error: `空の欄があります: ${empty.join(", ")}` };
      }
      const quoteByName = Object.fromEntries(def.fields.map((field) => [field.name, field.quote]));
      if (def.rememberLastValues) store.set(id, picked);
      return { ok: true, text: renderCommandTemplate(def.segments, picked, quoteByName) };
    },
  };
}

/** プロセス内だけで覚えるRememberedValuesStore。テストと、保存先を渡さない呼び出し用 */
export function createMemoryRememberedValuesStore(): RememberedValuesStore {
  const all = new Map<string, Record<string, string>>();
  return {
    get: (templateId) => all.get(templateId),
    set: (templateId, values) => {
      all.set(templateId, values);
    },
  };
}

export function rememberedValuesFilePath(): string {
  return join(appSupportDir(), "command-template-values.json");
}

/**
 * ファイルへ保存するRememberedValuesStore。アプリを再起動しても前回の値を初期値にできるよう、
 * 設定のホットリロードでは作り直さずアプリ起動中ずっと同じものを使う。
 * 読めない・壊れているファイルは空として扱い、例外を投げない
 */
export function createFileRememberedValuesStore(path: string): RememberedValuesStore {
  let cache: Record<string, Record<string, string>> | null = null;

  function load(): Record<string, Record<string, string>> {
    if (cache !== null) return cache;
    cache = {};
    try {
      const data: unknown = JSON.parse(readFileSync(path, "utf8"));
      if (typeof data === "object" && data !== null) {
        for (const [id, values] of Object.entries(data)) {
          if (typeof values !== "object" || values === null) continue;
          cache[id] = Object.fromEntries(
            Object.entries(values).filter((entry): entry is [string, string] => {
              return typeof entry[1] === "string";
            }),
          );
        }
      }
    } catch {
      // 初回（ファイルが無い）・壊れたファイルは空から始める
    }
    return cache;
  }

  return {
    get(templateId) {
      return load()[templateId];
    },
    set(templateId, values) {
      const all = load();
      all[templateId] = values;
      try {
        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(path, `${JSON.stringify(all, null, 2)}\n`);
      } catch (err) {
        console.log(`[bun] failed to save command template values: ${String(err)}`);
      }
    },
  };
}
