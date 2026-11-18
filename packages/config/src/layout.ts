// レイアウトプリセット設定。vde-layout(https://github.com/yuki-yano/vde-layout)のように、
// あらかじめ定義したタイル構成をCLI（`niwa layout apply <name>`）から名前指定して適用できるようにする。
// `--startup`で紐づけたBoardはアプリ起動時にもこのプリセットで組み直される
// （保持先はworkspaces.jsonのPersistedBoard.startup）。
// タイル分割は既存のワークスペース内部表現（TileSplit）と同じ「2分割・ratio(0.1〜0.9)のネスト」で表現する
// （ADR 0001で決めた二分木構造をそのまま踏襲。vde-layoutのようなN分割配列は採用しない）。

export interface LayoutTabConfig {
  /** タブ名（サイドバー・タブバー表示用）。省略時はデフォルトの連番ラベル */
  name?: string;
  /** 使用するシェルプロファイルのid（`niwa shell-profile list`で確認）。省略時はデフォルトシェル */
  shellProfile?: string;
  /** 作業ディレクトリ。省略時はホームディレクトリ */
  cwd?: string;
  /**
   * プリセット内でこのタブを指す名前（英数字・`-`・`_`）。プリセット内で一意にする。
   * このタブより後に書いたタブのcommandで`{{tab:<ref>}}`と書くと、このタブのtabIdに置き換わる
   */
  ref?: string;
  /**
   * タブ作成後に流し込むコマンド（末尾に自動でEnterを送信する）。複数行なら1行ずつ実行される。
   * `{{tab:<ref>}}`は、refを付けた先行タブのtabIdに置き換わる
   */
  command?: string;
  /** commandを送信するまでの待ち時間(ms)。シェル起動直後の取りこぼし防止用。省略時は0 */
  delay?: number;
  /**
   * trueならcommandを対話シェルへ入力せず、シェル経由で直接実行する（`zsh -l -i -c <command>`等）。
   * コマンドが終了するとタブも閉じる（終了コードが0以外なら、終了した旨を表示してキー入力で閉じる）。
   * commandが必須で、delayとは併用できない
   */
  closeOnExit?: boolean;
  /** タブごとのkey-value変数（`tab var set`相当で注入） */
  vars?: Record<string, string>;
  /** このタブに最終フォーカスを当てる。プリセット全体で1つまで指定できる */
  focus?: boolean;
  /**
   * 起動時にこのプリセットで組み直すとき、前回の終了時にこのタブで実行中だったコマンドを
   * commandより優先して打ち直す。打ち直すのは設定のresume.allowに載ったコマンドだけで、
   * 該当しなければcommandを実行する。省略時はプリセットのresumeに従う
   */
  resume?: boolean;
}

export interface LayoutTileConfig {
  kind: "tile";
  /** そのタイルに作るタブ一覧（最低1つ） */
  tabs: LayoutTabConfig[];
  /** アクティブにするタブのindex（tabs配列の添字）。省略時は最後のタブ */
  activeTab?: number;
}

export interface LayoutSplitConfig {
  kind: "split";
  orientation: "horizontal" | "vertical";
  /** firstが占める比率(0.1〜0.9)。省略時は0.5 */
  ratio?: number;
  first: LayoutNodeConfig;
  second: LayoutNodeConfig;
}

export type LayoutNodeConfig = LayoutTileConfig | LayoutSplitConfig;

export interface LayoutPreset {
  /** `niwa layout list`に表示する説明文 */
  description?: string;
  /** 全タブのresumeの既定値。省略時はfalse（commandをそのまま実行する） */
  resume?: boolean;
  layout: LayoutNodeConfig;
}

/** プリセット名（`niwa layout apply <name>`のname）→定義のマップ */
export type LayoutsConfig = Record<string, LayoutPreset>;
