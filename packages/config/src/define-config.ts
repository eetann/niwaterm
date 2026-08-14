import type { AppearanceConfig } from "./appearance";
import type { BrowserConfig } from "./browser";
import type { CustomViewConfig } from "./custom-view";
import type { KeybindingsConfig } from "./keybindings";
import type { LayoutsConfig } from "./layout";
import type { ShellConfig } from "./shell";
import type { WorkspaceConfig } from "./workspace";

export interface NiwatermConfig {
  /**
   * キーバインド設定。キーはKeyBindingString、値はKeybindAction。
   * 未指定のキーはdefaultKeybindingsの割り当てのまま有効。
   * 例: { ...defaultKeybindings, "cmd+d": "split-horizontal" }
   */
  keybindings?: KeybindingsConfig;
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
   * ユーザー定義HTML UI（サイドバーの固定パネル・「名前付きビュー」としてのタブ表示）設定。
   * pathかurlのどちらかを指定する（pathが優先）。未指定なら機能自体がオフになる。
   * 例: { name: "Notes", path: "./notes.html" }
   */
  customView?: CustomViewConfig;
  /**
   * シェル設定。新規タブ作成時に使うデフォルトシェル・追加のシェルプロファイル（PowerShell・SSH先等）を変更できる。
   * defaultの未指定時はOS標準（macOS/Linux: /bin/zsh、Windows: powershell.exe）。
   * 例: { default: "/bin/bash", profiles: [{ id: "ssh-dev", name: "dev server", command: "ssh dev" }] }
   */
  shell?: ShellConfig;
  /**
   * レイアウトプリセット設定。`niwaterm layout apply <name>`で名前指定して適用できる
   * タイル構成（2分割ratioのネスト）とタブごとのcommand/cwd/vars/focus等を定義する。
   * 例: { dev: { layout: { kind: "tile", tabs: [{ name: "editor", command: "nvim" }] } } }
   */
  layouts?: LayoutsConfig;
  /**
   * ワークスペース設定。新規ワークスペース作成時（アプリ起動時の最初のワークスペース・
   * `niwaterm new-workspace`）の最初のタブに使うデフォルトcwdを変更できる。
   * 未指定時はOS標準のホームディレクトリ（WSL上でniwaterm自体を動かしている場合は
   * 自然にWSL側のホームディレクトリになる）。分割・新規タブ作成時のcwd継承には影響しない。
   * 例: { defaultCwd: "/home/eetann/projects" }
   */
  workspace?: WorkspaceConfig;
}

/** 型推論とエディタ補完のためのヘルパー。渡された値をそのまま返す */
export function defineConfig(config: NiwatermConfig): NiwatermConfig {
  return config;
}
