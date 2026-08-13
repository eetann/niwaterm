// レイアウトプリセット設定。vde-layout(https://github.com/yuki-yano/vde-layout)のように、
// あらかじめ定義したタイル構成をCLI（`niwaterm layout apply <name>`）から名前指定して適用できるようにする。
// タイル分割は既存のワークスペース内部表現（TileSplit）と同じ「2分割・ratio(0.1〜0.9)のネスト」で表現する
// （ADR 0001で決めた二分木構造をそのまま踏襲。vde-layoutのようなN分割配列は採用しない）。

export interface LayoutTabConfig {
  /** タブ名（サイドバー・タブバー表示用）。省略時はデフォルトの連番ラベル */
  name?: string;
  /** 使用するシェルプロファイルのid（`niwaterm shell-profiles`で確認）。省略時はデフォルトシェル */
  shellProfile?: string;
  /** 作業ディレクトリ。省略時はホームディレクトリ */
  cwd?: string;
  /** タブ作成後に流し込むコマンド（`send-keys`相当、末尾に自動でEnterを送信する） */
  command?: string;
  /** commandを送信するまでの待ち時間(ms)。シェル起動直後の取りこぼし防止用。省略時は0 */
  delay?: number;
  /** タブごとのkey-value変数（`set-var`相当で注入） */
  vars?: Record<string, string>;
  /** このタブに最終フォーカスを当てる。プリセット全体で1つまで指定できる */
  focus?: boolean;
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
  /** `niwaterm layout list`に表示する説明文 */
  description?: string;
  layout: LayoutNodeConfig;
}

/** プリセット名（`niwaterm layout apply <name>`のname）→定義のマップ */
export type LayoutsConfig = Record<string, LayoutPreset>;
