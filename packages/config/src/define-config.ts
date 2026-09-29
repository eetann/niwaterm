import type { AppearanceConfig } from "./appearance";
import type { BoardConfig } from "./board";
import type { BrowserConfig } from "./browser";
import type { CustomViewConfig } from "./custom-view";
import type { HoverButtonConfig } from "./hover-button";
import type { KeybindingsConfig } from "./keybindings";
import type { LayoutsConfig } from "./layout";
import type { LinkConfig } from "./link";
import type { MouseConfig } from "./mouse";
import type { Niwa } from "./niwa";
import type { ShellConfig } from "./shell";
import type { SidebarConfig } from "./sidebar";
import type { StatusBarConfig } from "./status-bar";
import type { TerminalConfig } from "./terminal";
import type { WorkspaceConfig } from "./workspace";
import type { WorktreeConfig } from "./worktree";

/**
 * キーバインドを登録する関数。niwa.keybind/niwa.prefix/niwa.unbindで登録するほか、
 * niwa.tile/tab/popup/workspace/clipboard APIを使った関数ハンドラも割り当てられる。
 * デフォルトキーバインドは先に登録済みの状態で呼ばれるため、上書き・追加したい分だけ書けばよい。
 */
export type KeybindingsFn = (niwa: Niwa) => void;

export interface NiwatermConfig {
  /**
   * キーバインド設定（tmux風のprefix方式）。
   * 関数（推奨、KeybindingsFn）: niwa.keybindで1エントリずつ登録する。複数アクションの束ね・
   * 条件分岐・シェル実行を伴う複雑なバインドや、関心事ごとの複数ファイル分割に対応できる。
   * 例: (niwa) => { niwa.keybind("d", "split-horizontal"); }
   *
   * オブジェクト（従来形式、KeybindingsConfig）: prefix・bindings・directの3フィールドを持つ
   * 宣言的な形。未指定のフィールドはdefaultKeybindingsの値のまま有効。単純な文字列アクションの
   * 割り当てのみで済む場合はこちらでもよい。
   * 例: { ...defaultKeybindings, bindings: { ...defaultKeybindings.bindings, d: "split-horizontal" } }
   */
  keybindings?: KeybindingsConfig | KeybindingsFn;
  /**
   * フォント・カラーテーマ設定。未指定のフィールドはdefaultAppearanceの値のまま有効。
   * 例: { ...defaultAppearance, fontSize: 16 }
   */
  appearance?: AppearanceConfig;
  /**
   * ブラウザタブ設定。未指定のフィールドはdefaultBrowserConfigの値のまま有効。
   * 例: { defaultUrl: "https://example.com" }
   */
  browser?: BrowserConfig;
  /**
   * ユーザー定義HTML UI（サイドバーのパネル・「名前付きビュー」としてのタブ表示）設定。
   * 配列に並べた順でサイドバーのビュー切替に並ぶ。各要素はpathかurlのどちらかを指定する
   * （pathが優先）。空配列・未指定なら機能自体がオフになる。
   * 例: [{ name: "Notes", path: "./notes.html" }]
   */
  customViews?: CustomViewConfig[];
  /**
   * タブの表示領域の端に置くボタンの設定。位置（8方向）ごとに取っ手を出し、押した時に
   * 並べる項目をitemsで組み立てる（handle: falseなら取っ手を出さず、端へマウスを寄せた間だけ出す）。
   * 項目1つならただのボタン、複数なら目次のように並ぶ。showを書けばそのタブに出すかどうかを絞れる（タブ変数・cwdで判定できる）。
   * 空配列・未指定なら機能自体がオフになる。
   * 例: [{ position: "bottom-right", items: (ctx, niwa) => [{ label: "git", run: () => niwa.popup.open({ command: "lazygit" }) }] }]
   */
  hoverButtons?: HoverButtonConfig[];
  /**
   * シェル設定。新規タブ作成時に使うデフォルトシェル・追加のシェルプロファイル（PowerShell・SSH先等）を変更できる。
   * defaultの未指定時はOS標準（macOS/Linux: /bin/zsh、Windows: powershell.exe）。
   * 例: { default: "/bin/bash", profiles: [{ id: "ssh-dev", name: "dev server", command: "ssh dev" }] }
   */
  shell?: ShellConfig;
  /**
   * ターミナル本体の挙動設定。スクロールバックの保持行数を変更できる。
   * 未指定のフィールドはdefaultTerminalConfigの値のまま有効。
   * 例: { scrollback: 50000 }
   */
  terminal?: TerminalConfig;
  /**
   * レイアウトプリセット設定。`niwaterm layout apply <name>`で名前指定して適用できる
   * タイル構成（2分割ratioのネスト）とタブごとのcommand/cwd/vars/focus等を定義する。
   * `layout apply <name> --startup`（または`board startup layout`）で紐づけたBoardは、
   * アプリ起動時にも保存した骨格の復元ではなくここのプリセットで組み直される。
   * 例: { dev: { layout: { kind: "tile", tabs: [{ name: "editor", command: "nvim" }] } } }
   */
  layouts?: LayoutsConfig;
  /**
   * ターミナル出力の中のURLをクリックで開くための設定。URLとみなす正規表現（rules）・
   * 開くのに押しておく修飾キー（modifier）・開き先（open）を指定する。
   * 未指定のフィールドは既定値のまま有効。開く処理そのものを差し替えたい場合は
   * keybindingsの関数形式の中でniwa.on("open-link", ...)を使う。
   * 例: { open: "browser-tab" }
   */
  link?: LinkConfig;
  /**
   * マウス操作の挙動設定。選択時の自動コピー（copyOnSelect）と、選択範囲の右クリックメニューに
   * 並べる項目（selectionMenu）を指定する。未指定のフィールドはdefaultMouseConfigの値のまま有効。
   * 例: { copyOnSelect: true }
   */
  mouse?: MouseConfig;
  /**
   * ワークスペース設定。新規ワークスペース作成時（アプリ起動時の最初のワークスペース・
   * `niwaterm workspace new`）の最初のタブに使うデフォルトcwdを変更できる。
   * 未指定時はOS標準のホームディレクトリ（WSL上でniwaterm自体を動かしている場合は
   * 自然にWSL側のホームディレクトリになる）。分割・新規タブ作成時のcwd継承には影響しない。
   * 例: { defaultCwd: "/home/eetann/projects" }
   */
  workspace?: WorkspaceConfig;
  /**
   * Board設定。タブ追加・タイル分割・ポップアップで新しいタブを開くときのcwdを、
   * 今のタブからの引き継ぎ（既定）にするか、Boardに紐づくワークツリーにするかを選べる。
   * 例: { newTabCwd: "worktree" }
   */
  board?: BoardConfig;
  /**
   * サイドバーの表示設定。ワークスペース一覧のBoard行に出すステータスライン（Board名の下の行）へ
   * 並べる項目と順番を指定する。未指定ならフェーズ・ブランチ・エージェント状態の3つが出る。
   * 例: { boardStatus: ["builtin:branch", { source: "tab-var:ticket", prefix: "#" }] }
   */
  sidebar?: SidebarConfig;
  /**
   * ウィンドウ下端のステータスバー。左・中央・右の3区画へ部品を並べる（tmuxのstatus-left/right、
   * lualine相当）。部品はビルトイン（`builtin:mode`等）・タブ変数（`tab-var:<name>`）・render関数で書け、
   * runを書いた部品は押せる。未指定の区画は既定値（左にモード、右にcwd）のまま。falseなら出さない。
   * 例: { right: ["tab-var:branch", "builtin:cwd", { render: () => new Date().toLocaleTimeString(), interval: 1000 }] }
   */
  statusBar?: StatusBarConfig | false;
  /**
   * git worktree管理の設定。新規ワークツリーの置き場所テンプレート（worktree.dir）と、
   * 作成後の開き方の既定値（worktree.open）を指定する。
   * リポジトリ固有の方針は<repoRoot>/.niwaterm/config.tsでも書け、項目ごとにそちらが優先される。
   * 例: { dir: ".worktrees/${branch}", open: "board" }
   */
  worktree?: WorktreeConfig;
}

/** 型推論とエディタ補完のためのヘルパー。渡された値をそのまま返す */
export function defineConfig(config: NiwatermConfig): NiwatermConfig {
  return config;
}
