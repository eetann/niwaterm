// コマンドの一部だけを差し替えて使い回すテンプレート（commandTemplates）の設定。
// custom-view.tsと同様、未設定なら機能自体がオフになる（既定のテンプレートは無い）。
// 差し替える部分はcommandの中に`{{name}}`で書き、モーダルで入力・選択した値を埋めて
// アクティブなタブへ入力する（またはクリップボードへコピーする）。

import type { Niwa } from "./niwa";

/** optionsの関数へ渡る、モーダルを開いた時点のアクティブなタブの状況 */
export interface CommandTemplateContext {
  /** アクティブなタブが無い（ブラウザタブ等も含めて1つも開いていない）ときはundefined */
  tabId: string | undefined;
  /** そのタブが報告している作業ディレクトリ（OSC7シェル統合）。未報告ならundefined */
  cwd: string | undefined;
  /** そのタブのタブ変数。cwdもこの中の"cwd"に入っている */
  vars: Record<string, string>;
}

/** 選択肢1件。labelをモーダルに出し、選ぶとvalueがコマンドへ入る */
export interface CommandTemplateOption {
  label: string;
  value: string;
  /** 候補の右側に小さく出す補足 */
  description?: string;
}

/**
 * niwatermが候補を用意する選択肢。
 * - `"workspace"`: ワークスペースの一覧。名前を出し、idが入る。今のワークスペースを初期値にする
 */
export type CommandTemplateBuiltinOptions = "workspace";

export const COMMAND_TEMPLATE_BUILTIN_OPTIONS: readonly CommandTemplateBuiltinOptions[] = [
  "workspace",
];

export function isCommandTemplateBuiltinOptions(
  value: unknown,
): value is CommandTemplateBuiltinOptions {
  return (
    typeof value === "string" &&
    (COMMAND_TEMPLATE_BUILTIN_OPTIONS as readonly string[]).includes(value)
  );
}

/** 選択肢の並び。文字列だけの要素はlabelとvalueが同じになる */
export type CommandTemplateOptionList = (string | CommandTemplateOption)[];

/**
 * モーダルを開くたびに呼ばれ、その時点の選択肢を返す関数。
 * git branchの一覧やファイル一覧のような、状況で変わる候補をniwa.shell.run等で作れる
 */
export type CommandTemplateOptionsFn = (
  ctx: CommandTemplateContext,
  niwa: Niwa,
) => CommandTemplateOptionList | Promise<CommandTemplateOptionList>;

/**
 * モーダルを開くたびに呼ばれ、その時点の初期値を返す関数。クリップボードの中身を見て
 * 初期値にするといった、状況で変わる初期値をniwa.clipboard.read等で作れる。
 * undefinedを返すと初期値なしとして扱う
 */
export type CommandTemplateDefaultFn = (
  ctx: CommandTemplateContext,
  niwa: Niwa,
) => string | undefined | Promise<string | undefined>;

export interface CommandTemplateField {
  /** 入力欄の見出し。省略時は`{{name}}`のname */
  label?: string;
  /** 自由入力の欄に薄く出す入力例 */
  placeholder?: string;
  /**
   * 選択肢。省略時は自由入力の欄になる。配列で固定の選択肢、組み込みの名前
   * （CommandTemplateBuiltinOptions）でniwatermが用意する候補、関数で開くたびに作る候補を指定する
   */
  options?: CommandTemplateOptionList | CommandTemplateBuiltinOptions | CommandTemplateOptionsFn;
  /**
   * 開いた時点で入れておく値。関数なら開くたびに呼んで決める。
   * 選択肢の欄ではいずれかのvalueと一致するときだけ使う
   */
  default?: string | CommandTemplateDefaultFn;
  /** trueなら開いた時点でこの欄にフォーカスする。複数あれば最初の欄。省略時は先頭の欄 */
  focus?: boolean;
  /**
   * 値をシェル用にクォートするか。省略時はtrueで、空白や記号を含む値だけを`'...'`で囲む。
   * 値にオプションや複数の引数をまとめて入れたいときはfalseにする
   */
  quote?: boolean;
}

export interface CommandTemplateConfig {
  /**
   * キーバインド・ホバーボタンの`niwa.commandTemplate.open(id)`から指す名前。
   * 省略時はnameから作る
   */
  id?: string;
  /** モーダルの見出しとコマンドパレットの項目名 */
  name: string;
  /** モーダルの見出しの下に出す説明 */
  description?: string;
  /** 差し替える部分を`{{name}}`で書いたコマンド。同じnameを複数回書くと同じ値が入る */
  command: string;
  /** `{{name}}`ごとの入力欄の設定。書かなかったnameは見出しがnameの自由入力の欄になる */
  fields?: Record<string, CommandTemplateField>;
  /** trueなら前回送った値を次に開いたときの初期値にする。省略時はfalse */
  rememberLastValues?: boolean;
}

/** コマンドパレットに並べるための、関数を除いた解決済みのテンプレート */
export interface ResolvedCommandTemplateConfig {
  id: string;
  name: string;
  /** 未指定は空文字列 */
  description: string;
  command: string;
}
