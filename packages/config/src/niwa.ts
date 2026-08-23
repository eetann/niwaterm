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

export interface NiwaTileResizeOptions {
  /** 拡大する方向。フォーカス中タイルから見てこの方向の軸のsplitのratioを調整する */
  direction: FocusDirection;
  /** ratioの増減幅（0〜1）。省略時は既定値（小さめの1ステップ分） */
  amount?: number;
}

export interface NiwaTileApi {
  /** フォーカス中タイルの情報を返す */
  current(): NiwaTileInfo | null;
  split(opts: NiwaSplitOptions): { tileId: string; tabId: string } | null;
  focus(direction: FocusDirection): void;
  /**
   * フォーカス中タイルをdirection方向へamount分拡大する（tmuxのresize-pane相当）。
   * direction方向の軸に一致するsplitが祖先に無い場合（例: 単一タイルのワークスペース）はfalse
   */
  resize(opts: NiwaTileResizeOptions): boolean;
  /**
   * フォーカス中タイルの一時的なズーム表示を切り替える（tmuxのresize-pane -Z相当）。
   * ズーム中は他のtileが隠れ、フォーカス中タイルだけが画面全体に表示される。戻り値はトグル後の状態（true=ズーム中）
   */
  zoom(): boolean;
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
  /**
   * 全ワークスペース・タイル・タブを横断して、keyの値がvalueと一致するタブのtabIdを返す
   * （tmuxの`list-panes -F "#{pane_id} #{@role}"` | awk相当）。
   * role変数等を頼りにした`niwa.tab.show`とのペインフォーカス移動の組み立てに使う
   */
  find(key: string, value: string): string[];
}

export interface NiwaTabRespawnOptions {
  /** 省略時は元のcwdを引き継ごうとする（OSC7報告済みの最新cwd） */
  cwd?: string;
  /** shell.profilesで定義したid。省略時はdefaultShell */
  shellProfile?: string;
  /** 指定すると、このコマンドをシェルの代わりに実行する（popup.openのcommandと同じ意味） */
  command?: string;
}

export interface NiwaTabApi {
  /** フォーカス中タイルのアクティブタブの情報を返す。アクティブタブが無い場合はnull */
  current(): { tabId: string } | null;
  create(opts?: NiwaNewTabOptions): { tabId: string } | null;
  /**
   * 指定タブのプロセスを強制終了し、同じtabId・タイル位置のまま再起動する（tmuxのrespawn-pane -k相当）。
   * 対象タブが存在しない・ブラウザタブの場合はfalse
   */
  respawn(tabId: string, opts?: NiwaTabRespawnOptions): boolean;
  /**
   * 指定タブへキーを送信する（tmuxのsend-keys、CLIの`niwaterm tab send-keys`相当）。
   * リテラル文字列と特殊キー名（Enter/Escape/Tab/C-a等）を複数個混在指定できる。
   * 例: niwa.tab.sendKeys(tabId, "cd ~/ghq", "Enter")
   */
  sendKeys(tabId: string, ...keys: string[]): void;
  /**
   * 指定タブへフォーカスを移す。所属ワークスペースへの切替・タイルフォーカス・タブのアクティブ化を
   * まとめて行う（tmuxのselect-pane、CLIの`niwaterm tab show`相当）。対象タブが存在しない場合はfalse
   */
  show(tabId: string): boolean;
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

export interface NiwaWorkspaceInfo {
  id: string;
  /** ユーザーがサイドバーから設定した名前。未設定はnull（表示側で連番にフォールバック） */
  name: string | null;
  active: boolean;
}

export interface NiwaWorkspaceApi {
  create(cwd?: string): string;
  switch(workspaceId: string): boolean;
  /**
   * 2つのワークスペースの表示順（サイドバー・ウィンドウタイトルの番号）を入れ替える
   * （tmuxのswap-window相当）。中身（レイアウト・タブ）は一切変更しない。
   * どちらかのidが存在しない、または同一idの場合はfalse
   */
  swap(workspaceIdA: string, workspaceIdB: string): boolean;
  /** 全ワークスペースを表示順（サイドバー・ウィンドウタイトルの番号順）で返す */
  list(): NiwaWorkspaceInfo[];
  /** 現在アクティブなワークスペースのidを返す（tmuxのswitch-clientが参照するcurrent-window相当） */
  current(): string;
}

export interface NiwaClipboardApi {
  write(text: string): void;
  /** 読み取れない場合は空文字列 */
  read(): Promise<string>;
}

export interface NiwaShellRunOptions {
  /** shell.profilesで定義したid。省略時はdefaultShell */
  shellProfile?: string;
  cwd?: string;
  /** 追加で設定する環境変数（wsl.exeプロファイルの場合はWSLENVへも自動で追記される） */
  env?: Record<string, string>;
}

export interface NiwaShellRunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface NiwaShellApi {
  /**
   * 指定コマンドを、現在のシェルプロファイル設定（wsl.exe/powershell.exe/zsh等）に従って
   * ログイン・インタラクティブシェル経由で実行し、結果を返す（tmuxのrun-shell相当）。
   * PTYを使わないワンショット実行で、GUI上にタブ・ポップアップは作らない。対話的な出力を
   * 見せたい場合はpopup.open({ command })を使うこと
   */
  run(command: string, opts?: NiwaShellRunOptions): Promise<NiwaShellRunResult>;
}

export interface KeybindOptions {
  /** trueならprefix不要で即時発火する（directと同じ扱い。cmd/ctrl/altのいずれかを含むKeyBindingStringのみ有効） */
  noPrefix?: boolean;
  /**
   * trueなら、このバインドの発火後repeatTimeoutMs以内はprefix無しで同じ2打目キーテーブルの
   * repeatableなキーを連打できる（tmuxのbind-key -r相当）。noPrefix:trueのdirect側にも型上は指定できるが、
   * directは元々prefix無しの即時発火でOSのキーリピートがそのまま連続入力を生むため実効果を持たない
   */
  repeat?: boolean;
}

/**
 * キーバインドの関数ハンドラ。呼び出しタイミングは登録時（configファイル実行時）ではなく、
 * 実際にそのキーが押された時。niwa.tile.current()等はこの時点の実際の状態を返す。
 */
export type KeybindHandler = (niwa: Niwa) => void | Promise<void>;

export interface Niwa {
  /** prefixキー本体を設定する。例: niwa.prefix("ctrl+b") */
  prefix(binding: KeyBindingString): void;
  /** repeat:trueなバインドが連打とみなす間隔(ms)を設定する。省略時は既定500ms */
  repeatTimeout(ms: number): void;
  /**
   * キーにアクションを割り当てる。actionは既存アクション名の文字列、または任意の処理を書ける関数ハンドラ。
   * 同じkeyへ複数回呼ぶと後勝ちで上書きされる（デフォルト設定の上にユーザー設定を重ねる用途）。
   * keyはnoPrefix未指定ならprefix入力後の2打目キー表記（SecondKeyString）、
   * noPrefix:trueならKeyBindingString表記（cmd/ctrl/altのいずれか必須）
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
  shell: NiwaShellApi;
}
