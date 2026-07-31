import type { AppearanceConfig } from "./appearance";
import type { BrowserConfig } from "./browser";
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
}

/** 型推論とエディタ補完のためのヘルパー。渡された値をそのまま返す */
export function defineConfig(config: NiwatermConfig): NiwatermConfig {
  return config;
}
