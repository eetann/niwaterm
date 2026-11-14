// コマンドテンプレート（commandTemplates）のcommandの分解と、入力値を埋めたコマンドの組み立て。
// webview側（入力中のプレビュー）とbun側（タブへ送る文字列の確定）の両方から使い、
// 同じ関数を通すことで「プレビューに見えているもの＝実際に送られるもの」にする。

import type { CommandTemplateOption } from "@niwaterm/config";

/** webviewへ渡す欄1つ。選択肢は評価済み */
export interface PreparedCommandTemplateField {
  name: string;
  label: string;
  placeholder: string;
  quote: boolean;
  /** nullなら自由入力の欄。空配列は選べる候補が無い状態 */
  options: CommandTemplateOption[] | null;
  /** 選択肢を作れなかった理由。作れたときはnull */
  error: string | null;
  /** 開いた時点で入れておく値 */
  initial: string;
}

/** モーダル1回ぶんの内容 */
export interface PreparedCommandTemplate {
  id: string;
  name: string;
  description: string;
  command: string;
  fields: PreparedCommandTemplateField[];
}

/** 入力モーダルの送り方。pasteはEnterを押さずにタブへ入力、runはEnterまで送る、copyはクリップボードへ */
export type CommandTemplateAction = "paste" | "run" | "copy";

export type CommandTemplateSegment =
  | { kind: "text"; text: string }
  | { kind: "field"; name: string };

/** `{{name}}`のnameに使える文字。前後の空白は許す（`{{ branch }}`） */
const FIELD_PATTERN = /\{\{\s*([A-Za-z_][A-Za-z0-9_-]*)\s*\}\}/g;

/** commandを地の文と`{{name}}`の並びへ分解する。nameにできない`{{...}}`は地の文のまま残す */
export function parseCommandTemplate(command: string): CommandTemplateSegment[] {
  const segments: CommandTemplateSegment[] = [];
  let last = 0;
  for (const match of command.matchAll(FIELD_PATTERN)) {
    const index = match.index;
    if (index > last) segments.push({ kind: "text", text: command.slice(last, index) });
    segments.push({ kind: "field", name: match[1] as string });
    last = index + match[0].length;
  }
  if (last < command.length) segments.push({ kind: "text", text: command.slice(last) });
  return segments;
}

/** commandに出てくるnameを、最初に出てきた順に重複なく返す。モーダルの欄はこの順に並ぶ */
export function fieldNamesOf(segments: readonly CommandTemplateSegment[]): string[] {
  const names: string[] = [];
  for (const segment of segments) {
    if (segment.kind === "field" && !names.includes(segment.name)) names.push(segment.name);
  }
  return names;
}

/** クォートしなくてもシェルが1つの引数としてそのまま受け取る文字だけで出来た値 */
const SHELL_SAFE_PATTERN = /^[A-Za-z0-9_@%+=:,./-]+$/;

/**
 * 値をシェルの1引数としてクォートする。安全な文字だけなら手を加えず、それ以外は`'...'`で囲む。
 * 値の中の`'`は`'"'"'`へ置き換える（シングルクォートを閉じ、ダブルクォートで`'`を1文字足して開き直す）。
 * この置き換えはPOSIX系シェル（zsh・bash）の書き方。貼る先のシェルはniwatermから分からないため、
 * `'`を含む値をPowerShellへ貼る場合は利用者がquote: falseにして自分で書く
 */
export function quoteShellArg(value: string): string {
  if (SHELL_SAFE_PATTERN.test(value)) return value;
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

/**
 * 入力値を埋めたコマンドを組み立てる。quoteがfalseのnameはそのまま埋める。
 * valuesに無いnameは空文字列として扱う（空の欄があるかの判定は呼び出し側で先に行う）
 */
export function renderCommandTemplate(
  segments: readonly CommandTemplateSegment[],
  values: Readonly<Record<string, string>>,
  quoteByName: Readonly<Record<string, boolean>>,
): string {
  return segments
    .map((segment) => {
      if (segment.kind === "text") return segment.text;
      const value = values[segment.name] ?? "";
      if (value === "" || quoteByName[segment.name] === false) return value;
      return quoteShellArg(value);
    })
    .join("");
}

/** 空の欄のnameを欄の並び順で返す。1つでもあればコマンドを送らない */
export function emptyFieldNames(
  names: readonly string[],
  values: Readonly<Record<string, string>>,
): string[] {
  return names.filter((name) => (values[name] ?? "") === "");
}
