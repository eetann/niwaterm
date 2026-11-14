// キーバインドの値に関数ハンドラを取れるようにするための実行時API。
// ADR等の議論の要点: tmuxのif-shell/run-shell/{}束ねのような専用DSLは増やさず、
// 素のTSのif文・Bun.spawn・関数呼び出しの並びに任せる。niwaterm固有の状態・操作にアクセスする
// 部分（タイル・タブ・ポップアップ・Board・ワークスペース・クリップボード）だけをAPIとして提供する。
//
// 実装（createNiwaApi相当）はsrc/bun側が持つ。このファイルは型のみで、bun側実装への依存を持たない
// （このパッケージはmainview側からもimportされるため）。

import type { CopyModeAction, CopyModeSearchAction } from "./copy-mode-keybindings";
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
   * 指定タブへキーを送信する（tmuxのsend-keys、CLIの`niwa tab send-keys`相当）。
   * リテラル文字列と特殊キー名（Enter/Escape/Tab/C-a等）を複数個混在指定できる。
   * 例: niwa.tab.sendKeys(tabId, "cd ~/ghq", "Enter")
   */
  sendKeys(tabId: string, ...keys: string[]): void;
  /**
   * 指定タブへフォーカスを移す。所属ワークスペースへの切替・タイルフォーカス・タブのアクティブ化を
   * まとめて行う（tmuxのselect-pane、CLIの`niwa tab focus`相当）。対象タブが存在しない場合はfalse
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

export interface NiwaPopupRunOptions {
  /** 省略時はフォーカス中タイルのアクティブタブのcwdを引き継ぐ */
  cwd?: string;
  /** 表示サイズ（1〜100のパーセント）。省略時はCSS側の既定値に従う */
  width?: number;
  height?: number;
}

export interface NiwaPopupApi {
  open(opts?: NiwaPopupOpenOptions): { tabId: string } | null;
  /**
   * ポップアップでcommandを実行し、閉じるまで待って標準出力を返す
   * （CLIの`popup open --capture-stdout`相当。fzf-tmuxの結果受け渡し方式と同じ発想で、
   * UIの描画はポップアップ内に残したままcommandの標準出力だけを分離して受け取る）。
   * fzf等でユーザーに選ばせた結果をキーバインドのハンドラ側で使いたい場合に用いる。
   * 既にポップアップが開いている場合はnull、commandが何も出力しなかった場合は空文字列
   */
  run(command: string, opts?: NiwaPopupRunOptions): Promise<string | null>;
}

export interface NiwaBoardApi {
  /**
   * アクティブなワークスペースに新規Boardを作成し、アクティブにする（tmuxの`new-window`相当。
   * Boardは1ワークスペース内の複数タイルレイアウトで、tmuxのWindowに対応する。ADR 0006）。
   * cwdは最初のタブの作業ディレクトリで、省略時はOS標準（tab.create等と違いフォーカス中タブの
   * cwdは引き継がない）。作成できなかった場合はnull
   */
  create(cwd?: string): string | null;
  /**
   * Boardを所属ワークスペース内の表示順（サイドバーの並び）のindex番目へ
   * 移動する。indexは0始まりで、範囲外は先頭・末尾へクランプする。中身（レイアウト・タブ）と
   * アクティブなBoardは変更しない。別のワークスペースへ移すのはmoveToWorkspace。
   * boardIdが存在しない場合はfalse
   */
  move(boardId: string, index: number): boolean;
  /**
   * Boardを別のワークスペースへ移す（tmuxの`move-window`相当）。レイアウト・タブ・実行中の
   * プロセスはそのまま移る。indexは移動先での挿入位置（0始まり）で、省略・範囲外は末尾。
   * アクティブなBoardは移動元・移動先とも変更しない。
   * 移動元がこれで空になる場合はそのワークスペースごと閉じる（ポップアップを開いていれば
   * 一緒に閉じる）。boardId・workspaceIdのどちらかが存在しない場合はfalse
   */
  moveToWorkspace(boardId: string, workspaceId: string, index?: number): boolean;
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
   * ワークスペースを表示順（サイドバー・ウィンドウタイトルの番号）のindex番目へ移動する。
   * indexは0始まりで、範囲外は先頭・末尾へクランプする。中身（レイアウト・タブ）と
   * アクティブなワークスペースは変更しない。workspaceIdが存在しない場合はfalse
   */
  move(workspaceId: string, index: number): boolean;
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

/** `niwa.list()`・`niwa list --json`が返す、ワークスペースからタブまでの一覧 */
export interface NiwaListTree {
  /** サイドバーの並び順 */
  workspaces: NiwaListWorkspace[];
}

export interface NiwaListWorkspace {
  id: string;
  /** ユーザーが付けた名前。未設定はnull */
  name: string | null;
  active: boolean;
  /** サイドバーの並び順 */
  boards: NiwaListBoard[];
}

export interface NiwaListBoard {
  id: string;
  /** ユーザー・CLIが付けた名前。未設定はnull */
  name: string | null;
  /** 名前の無いBoardへ設定（board.naming）が自動で付けた名前。付けられなければnull */
  autoName: string | null;
  /** 所属するワークスペースで表示中のBoardか */
  active: boolean;
  /** 作業フェーズ（`board phase set`）。未設定はnull */
  phase: string | null;
  /** 紐づくgitワークツリーの絶対パス。未設定はnull */
  worktreePath: string | null;
  /** 紐づけ先のディレクトリが見つからないか。紐づけの無いBoardは常にfalse */
  worktreeMissing: boolean;
  /** 紐づくレイアウトプリセットと起動時の組み直し方。未設定はnull */
  startup: { preset: string; restoreMode: "layout" | "restore" } | null;
  /** タイルの分割の木。葉の`id`は`tiles`の`id`と対応する */
  layout: NiwaListLayoutNode;
  /** 左上から右下への並び順 */
  tiles: NiwaListTile[];
  /** タイルの並び順、タイルの中ではタブバーの並び順 */
  tabs: NiwaListTab[];
}

export type NiwaListLayoutNode =
  | { kind: "leaf"; id: string }
  | {
      kind: "split";
      id: string;
      orientation: SplitOrientationValue;
      /** 0〜1。firstが占める比率 */
      ratio: number;
      first: NiwaListLayoutNode;
      second: NiwaListLayoutNode;
    };

export interface NiwaListTile {
  id: string;
  /** ユーザーが付けた名前。未設定はnull */
  name: string | null;
  /** Boardの中でフォーカスを持つタイルか */
  focused: boolean;
  /** ズーム表示中か */
  zoomed: boolean;
  activeTabId: string;
  tabIds: string[];
}

export interface NiwaListTab {
  id: string;
  tileId: string;
  kind: "terminal" | "browser";
  /** ユーザー・レイアウトプリセットが付けた名前。未設定はnull */
  name: string | null;
  /** タイルの中で表示中のタブか */
  active: boolean;
  /** シェル統合が報告した作業ディレクトリ（タブ変数`cwd`）。未報告はnull */
  cwd: string | null;
  /** ブラウザタブの表示中のURL。ターミナルのタブはnull */
  url: string | null;
  /** プログラムが終了したまま残っているターミナルのタブか */
  exited: boolean;
  /** タブ変数（`cwd`・`branch`・`agent_status`などを含む） */
  vars: Record<string, string>;
}

export interface NiwaNotifyOptions {
  title: string;
  body?: string;
  /** サブタイトル（macOSのみ独立表示、他OSはbodyの下の追加行として表示される） */
  subtitle?: string;
  /** trueなら通知音を鳴らさない */
  silent?: boolean;
  /** 通知元のタブ。指定するとクリック時にそのタブへ遷移する（macOSのみ。他OSでは無視される） */
  tabId?: string;
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

/** ベル（BEL文字 0x07）が鳴った時の状況。niwa.on("bell", ...)のハンドラへ渡る */
export interface NiwaBellEvent {
  tabId: string;
  /** ユーザーがサイドバーから設定したタブ名。未設定はnull */
  tabName: string | null;
  tileId: string;
  boardId: string;
  workspaceId: string;
  /** 鳴った時点でniwatermのウィンドウがフォーカスされていたか */
  windowFocused: boolean;
  /** 鳴った時点でそのタブが画面に出ていたか（別Board・別ワークスペース・非アクティブタブならfalse） */
  visible: boolean;
  /**
   * 鳴った時点でそのタブに書かれていたエージェントの状態（contrib/agent-integration/のhooksが
   * 書き込むタブ変数agent_status。"idle" / "working" / "blocked"）。hooksを入れていない、
   * あるいはエージェントが動いていないタブではnull
   */
  agentStatus: string | null;
}

export type NiwaBellHandler = (event: NiwaBellEvent) => unknown;

export interface NiwaBellApi {
  /**
   * ベルの既定の処理（タブへのマーク付けと、そのタブが画面に出ていない時のデスクトップ通知）を実行する。
   * niwa.on("bell", ...)を定義すると既定の処理は走らなくなるため、既定の挙動へ何か足したいだけの
   * 場合はハンドラの中からこれを呼ぶ
   */
  default(event: NiwaBellEvent): void;
  /** タブにベルのマークを付ける。マークはそのタブが画面に出た時点で自動的に消える */
  mark(tabId: string): void;
  /** タブのベルのマークを消す */
  clear(tabId: string): void;
}

/** ターミナル出力の中のリンクがクリックされた時の状況。niwa.on("open-link", ...)のハンドラへ渡る */
export interface NiwaLinkEvent {
  /** 開こうとしているURL（link.rulesのformatを適用した後の値） */
  url: string;
  /** 画面上でマッチした文字列そのもの。formatでURLへ組み替えた場合は元の見た目が残る */
  text: string;
  tabId: string;
  tileId: string;
  /** そのタブが報告している作業ディレクトリ（OSC7シェル統合）。未報告ならundefined */
  cwd: string | undefined;
}

export type NiwaLinkHandler = (event: NiwaLinkEvent) => unknown;

export interface NiwaLinkApi {
  /**
   * リンクの既定の処理（link.openの設定に従って、OS既定のブラウザかniwatermのブラウザタブで開く）を
   * 実行する。niwa.on("open-link", ...)を定義すると既定の処理は走らなくなるため、条件によって
   * 既定へ戻したい場合はハンドラの中からこれを呼ぶ
   */
  default(event: NiwaLinkEvent): void;
  /** URLをOS既定のブラウザで開く（link.openの設定に関わらず外部で開く） */
  openExternal(url: string): void;
}

export interface NiwaCommandTemplateApi {
  /**
   * commandTemplatesのテンプレートを入力モーダルで開く。idはテンプレートのid（省略時はnameから
   * 作ったもの。`niwa config show`で確かめられる）。該当するテンプレートが無い場合はfalse
   */
  open(id: string): boolean;
}

export interface KeybindOptions {
  /** trueならprefix不要で即時発火する（directと同じ扱い。cmd/ctrl/altのいずれかを含むKeyBindingStringのみ有効） */
  noPrefix?: boolean;
  /**
   * trueなら、このバインドの発火後repeatTimeoutMs以内はprefix無しで同じ2打目キーテーブルの
   * repeatableなキーを連打できる（tmuxのbind-key -r相当）。noPrefix:trueのdirect側にも型上は指定できるが、
   * directはprefix無しの即時発火でOSのキーリピートがそのまま連続入力を生むため実効果を持たない
   */
  repeat?: boolean;
  /**
   * キーバインド一覧（`niwa keybind list`）に表示する説明。省略時はアクション名（文字列アクション）
   * または`function`（関数ハンドラ）が表示されるため、関数ハンドラには何をするバインドなのかを書いておく
   */
  description?: string;
  /** prefixの表へ登録する（省略時と同じ）。コピーモードの表へは`"copy"`・`"copy-search"`を指定する */
  mode?: "prefix";
}

/**
 * コピーモードの表へ登録するときのオプション。`"copy"`はコピーモード中、`"copy-search"`は
 * 検索文字列（`/` `?`の後）を入力している間の表。キーは修飾なし・ctrl/cmd付きのどちらも書け、
 * `"copy"`の表に限り空白区切りで連続キーを書ける（例: `"g g"`）
 */
export interface CopyModeKeybindOptions {
  mode: "copy" | "copy-search";
  /** キーバインド一覧（`niwa keybind list`）に表示する説明 */
  description?: string;
}

/**
 * キーバインドの関数ハンドラ。呼び出しタイミングは登録時（configファイル実行時）ではなく、
 * 実際にそのキーが押された時。niwa.tile.current()等はこの時点の実際の状態を返す。
 */
export type KeybindHandler = (niwa: Niwa) => unknown;

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
  /** コピーモード中のキーにコピーモードのアクション（`copy-`で始まる名前）か関数ハンドラを割り当てる */
  keybind(
    key: string,
    action: CopyModeAction | KeybindHandler,
    opts: CopyModeKeybindOptions & { mode: "copy" },
  ): void;
  /** 検索文字列の入力中のキーに、検索入力のアクション（`copy-search-`で始まる名前）か関数ハンドラを割り当てる */
  keybind(
    key: string,
    action: CopyModeSearchAction | KeybindHandler,
    opts: CopyModeKeybindOptions & { mode: "copy-search" },
  ): void;
  /** keybindで割り当てたバインドを解除する */
  unbind(
    key: SecondKeyString | KeyBindingString,
    opts?: KeybindOptions | Pick<CopyModeKeybindOptions, "mode">,
  ): void;
  /**
   * ターミナル側で起きた出来事に対する処理を登録する。同じイベントへ複数回呼ぶと後勝ちで上書きされる。
   * ハンドラを登録するとそのイベントの既定の処理は走らなくなるため、既定の挙動を残したい場合は
   * ハンドラの中からniwa.bell.default(event)を呼ぶ
   */
  on(event: "bell", handler: NiwaBellHandler): void;
  on(event: "open-link", handler: NiwaLinkHandler): void;
  /**
   * 明示的な待ち時間(ms)。PTY起動〜シェルの入力受付までのタイミングはniwaterm側では検知しないため、
   * ハンドラ内で必要な待ちはこれで明示する（layoutsプリセットのdelayフィールドと同じ思想）
   */
  sleep(ms: number): Promise<void>;
  /**
   * OSのデスクトップ通知を出す（クリックしてもniwatermへのフォーカス移動は行わない。
   * 現時点ではElectrobun側にクリック検知の仕組みが無いための制約）
   */
  notify(opts: NiwaNotifyOptions): void;
  /**
   * 設定ファイルを再読み込みする（ファイル監視での自動リロード・reload-configキーバインドと同じ処理）。
   * 完了を待ってから後続処理（例: niwa.notifyでリロード完了を通知）を書ける。
   * 呼び出し元のハンドラ自体もこの再読み込みでniwa.keybindが再登録されるが、実行中のハンドラは
   * 差し替え前の登録内容のまま最後まで走る（handlerRegistryの参照を握っているため）
   */
  reloadConfig(): Promise<void>;
  /** このウィンドウのワークスペース・Board・タイル・タブを返す（`niwa list --json`と同じ形） */
  list(): NiwaListTree;
  tile: NiwaTileApi;
  tab: NiwaTabApi;
  bell: NiwaBellApi;
  link: NiwaLinkApi;
  popup: NiwaPopupApi;
  board: NiwaBoardApi;
  workspace: NiwaWorkspaceApi;
  clipboard: NiwaClipboardApi;
  shell: NiwaShellApi;
  commandTemplate: NiwaCommandTemplateApi;
}
