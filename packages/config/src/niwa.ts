// キーバインドの値に関数ハンドラを取れるようにするための実行時API。
// ADR等の議論の要点: tmuxのif-shell/run-shell/{}束ねのような専用DSLは増やさず、
// 素のTSのif文・Bun.spawn・関数呼び出しの並びに任せる。niwaterm固有の状態・操作にアクセスする
// 部分（タイル・タブ・ポップアップ・ワークスペース・クリップボード）だけをAPIとして提供する。
//
// 実装（createNiwaApi相当）はsrc/bun側が持つ。このファイルは型のみで、bun側実装への依存を持たない
// （このパッケージはmainview側からもimportされるため）。

import type { KeyBindingString, KeybindAction, SecondKeyString } from "./keybindings";

export type FocusDirection = "up" | "down" | "left" | "right";
export type SplitOrientationValue = "horizontal" | "vertical";

export interface NiwaTileInfo {
  id: string;
  /** フォーカス中タイルのアクティブタブが報告している作業ディレクトリ（OSC7シェル統合）。未報告ならundefined */
  cwd: string | undefined;
}

export interface NiwaSplitOptions {
  orientation: SplitOrientationValue;
  ratio?: number;
  /** 省略時はフォーカス中タイルのアクティブタブのcwdを引き継ぐ（既存のtile splitと同じ方針） */
  cwd?: string;
}

export interface NiwaTileApi {
  /** フォーカス中タイルの情報を返す */
  current(): NiwaTileInfo | null;
  split(opts: NiwaSplitOptions): { tileId: string; tabId: string } | null;
  focus(direction: FocusDirection): void;
  /** フォーカス中タイルのアクティブタブを閉じる */
  close(): void;
}

export interface NiwaNewTabOptions {
  /** 省略時はフォーカス中タイルに作成する */
  tileId?: string;
  cwd?: string;
  /** shell.profilesで定義したid。省略時はdefaultShell */
  shellProfile?: string;
}

export interface NiwaTabVarApi {
  get(tabId: string, key: string): string | undefined;
  set(tabId: string, key: string, value: string): void;
}

export interface NiwaTabApi {
  create(opts?: NiwaNewTabOptions): { tabId: string } | null;
  /**
   * 指定タブへキーを送信する（tmuxのsend-keys、CLIの`niwaterm tab send-keys`相当）。
   * リテラル文字列と特殊キー名（Enter/Escape/Tab/C-a等）を複数個混在指定できる。
   * 例: niwa.tab.sendKeys(tabId, "cd ~/ghq", "Enter")
   */
  sendKeys(tabId: string, ...keys: string[]): void;
  var: NiwaTabVarApi;
}

export interface NiwaPopupOpenOptions {
  /** 省略時はフォーカス中タイルのアクティブタブのcwdを引き継ぐ */
  cwd?: string;
  /** 指定すると、このコマンドをシェルの代わりに実行する（ワンショット実行）。終了すると自動的にポップアップも閉じる */
  command?: string;
  /** 表示サイズ（1〜100のパーセント）。省略時はCSS側の既定値に従う */
  width?: number;
  height?: number;
}

export interface NiwaPopupApi {
  open(opts?: NiwaPopupOpenOptions): { tabId: string } | null;
}

export interface NiwaWorkspaceApi {
  create(cwd?: string): string;
  switch(workspaceId: string): boolean;
}

export interface NiwaClipboardApi {
  write(text: string): void;
  /** 読み取れない場合は空文字列 */
  read(): Promise<string>;
}

export interface KeybindOptions {
  /** trueならprefix不要で即時発火する（directと同じ扱い。cmd/ctrlのいずれかを含むKeyBindingStringのみ有効） */
  noPrefix?: boolean;
}

/**
 * キーバインドの関数ハンドラ。呼び出しタイミングは登録時（configファイル実行時）ではなく、
 * 実際にそのキーが押された時。niwa.tile.current()等はこの時点の実際の状態を返す。
 */
export type KeybindHandler = (niwa: Niwa) => void | Promise<void>;

export interface Niwa {
  /** prefixキー本体を設定する。例: niwa.prefix("ctrl+b") */
  prefix(binding: KeyBindingString): void;
  /**
   * キーにアクションを割り当てる。actionは既存アクション名の文字列、または任意の処理を書ける関数ハンドラ。
   * 同じkeyへ複数回呼ぶと後勝ちで上書きされる（デフォルト設定の上にユーザー設定を重ねる用途）。
   * keyはnoPrefix未指定ならprefix入力後の2打目キー表記（SecondKeyString）、
   * noPrefix:trueならKeyBindingString表記（cmd/ctrl必須）
   */
  keybind(
    key: SecondKeyString | KeyBindingString,
    action: KeybindAction | KeybindHandler,
    opts?: KeybindOptions,
  ): void;
  /** keybindで割り当てたバインドを解除する */
  unbind(key: SecondKeyString | KeyBindingString, opts?: KeybindOptions): void;
  /**
   * 明示的な待ち時間(ms)。PTY起動〜シェルの入力受付までのタイミングはniwaterm側では検知しないため、
   * ハンドラ内で必要な待ちはこれで明示する（layoutsプリセットのdelayフィールドと同じ思想）
   */
  sleep(ms: number): Promise<void>;
  tile: NiwaTileApi;
  tab: NiwaTabApi;
  popup: NiwaPopupApi;
  workspace: NiwaWorkspaceApi;
  clipboard: NiwaClipboardApi;
}
