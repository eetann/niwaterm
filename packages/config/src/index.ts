export {
  type AppearanceConfig,
  defaultAppearance,
  type ResolvedAppearanceConfig,
} from "./appearance";
export { type BrowserConfig, defaultBrowserConfig, type ResolvedBrowserConfig } from "./browser";
export { type CustomViewConfig, type ResolvedCustomViewConfig } from "./custom-view";
export { defineConfig, type KeybindingsFn, type NiwatermConfig } from "./define-config";
export type {
  LayoutNodeConfig,
  LayoutPreset,
  LayoutSplitConfig,
  LayoutTabConfig,
  LayoutTileConfig,
  LayoutsConfig,
} from "./layout";
export type { NiwatermProjectConfig } from "./project";
export { type ShellConfig, type ShellProfile } from "./shell";
export { type WorkspaceConfig } from "./workspace";
export {
  canonicalizeParsed,
  canonicalizeSecondKey,
  compileKeybindings,
  type BindingEntry,
  type BindingTarget,
  type CompiledBindingEntry,
  type CompiledKeybindings,
  type CustomBindingRef,
  defaultKeybindings,
  DEFAULT_REPEAT_TIMEOUT_MS,
  defaultWindowsKeybindings,
  isBindingTarget,
  isCustomBindingRef,
  isKeybindAction,
  isRepeatableBinding,
  KEYBIND_ACTIONS,
  type KeyBindingString,
  type KeybindAction,
  type KeybindingsConfig,
  type ParsedKeyBinding,
  type ParsedSecondKey,
  parseKeyBindingString,
  parseSecondKeyString,
  platformDefaultKeybindings,
  type RepeatableBinding,
  resolveBindingEntry,
  type SecondKeyString,
} from "./keybindings";
export {
  type FocusDirection,
  type KeybindHandler,
  type KeybindOptions,
  type Niwa,
  type NiwaClipboardApi,
  type NiwaNewTabOptions,
  type NiwaNotifyOptions,
  type NiwaPopupApi,
  type NiwaPopupOpenOptions,
  type NiwaSplitOptions,
  type NiwaTabApi,
  type NiwaTabVarApi,
  type NiwaTileApi,
  type NiwaTileInfo,
  type NiwaWorkspaceApi,
  type SplitOrientationValue,
} from "./niwa";
