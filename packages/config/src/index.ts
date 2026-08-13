export {
  type AppearanceConfig,
  defaultAppearance,
  type ResolvedAppearanceConfig,
} from "./appearance";
export { type BrowserConfig, defaultBrowserConfig, type ResolvedBrowserConfig } from "./browser";
export { type CustomViewConfig, type ResolvedCustomViewConfig } from "./custom-view";
export { defineConfig, type NiwatermConfig } from "./define-config";
export type {
  LayoutNodeConfig,
  LayoutPreset,
  LayoutSplitConfig,
  LayoutTabConfig,
  LayoutTileConfig,
  LayoutsConfig,
} from "./layout";
export { type ShellConfig, type ShellProfile } from "./shell";
export {
  canonicalizeParsed,
  compileKeybindings,
  defaultKeybindings,
  defaultWindowsKeybindings,
  isKeybindAction,
  KEYBIND_ACTIONS,
  type KeyBindingString,
  type KeybindAction,
  type KeybindingsConfig,
  type ParsedKeyBinding,
  parseKeyBindingString,
  platformDefaultKeybindings,
} from "./keybindings";
