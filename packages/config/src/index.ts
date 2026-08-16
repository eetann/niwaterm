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
export { type WorkspaceConfig } from "./workspace";
export {
  canonicalizeParsed,
  canonicalizeSecondKey,
  compileKeybindings,
  type CompiledKeybindings,
  defaultKeybindings,
  defaultWindowsKeybindings,
  isKeybindAction,
  KEYBIND_ACTIONS,
  type KeyBindingString,
  type KeybindAction,
  type KeybindingsConfig,
  type ParsedKeyBinding,
  type ParsedSecondKey,
  parseKeyBindingString,
  parseSecondKeyString,
  platformDefaultKeybindings,
  type SecondKeyString,
} from "./keybindings";
