import type { AppearanceConfig } from "./appearance";
import type { BrowserConfig } from "./browser";
import type { CustomViewConfig } from "./custom-view";
import type { KeybindingsConfig } from "./keybindings";

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
}

/** 型推論とエディタ補完のためのヘルパー。渡された値をそのまま返す */
export function defineConfig(config: NiwatermConfig): NiwatermConfig {
  return config;
}
