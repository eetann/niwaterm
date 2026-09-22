export {
  type AppearanceConfig,
  defaultAppearance,
  defaultUiColors,
  isTabBarMode,
  isTitleBarMode,
  type ResolvedAppearanceConfig,
  type ResolvedUiColors,
  scaleLineHeight,
  type TabBarMode,
  type TitleBarMode,
  type UiColorsConfig,
} from "./appearance";
export {
  type BoardConfig,
  type BoardStatusPreset,
  defaultBoardConfig,
  isNewTabCwdMode,
  type NewTabCwdMode,
  normalizeBoardStatuses,
  type ResolvedBoardConfig,
  type ResolvedBoardStatus,
  resolveBoardStatus,
} from "./board";
export { type BrowserConfig, defaultBrowserConfig, type ResolvedBrowserConfig } from "./browser";
export {
  type CustomViewConfig,
  type CustomViewHandler,
  type CustomViewHandlers,
  type ResolvedCustomViewConfig,
  WORKSPACES_VIEW_ID,
} from "./custom-view";
export { defineConfig, type KeybindingsFn, type NiwatermConfig } from "./define-config";
export type {
  LayoutNodeConfig,
  LayoutPreset,
  LayoutSplitConfig,
  LayoutTabConfig,
  LayoutTileConfig,
  LayoutsConfig,
} from "./layout";
export {
  type MouseConfig,
  defaultMouseConfig,
  type ResolvedMouseConfig,
  type SelectionMenuContext,
  type SelectionMenuFn,
  type SelectionMenuItem,
} from "./mouse";
export type { NiwatermProjectConfig } from "./project";
export { type ShellConfig, type ShellProfile } from "./shell";
export {
  defaultTerminalConfig,
  type ResolvedTerminalConfig,
  type TerminalConfig,
} from "./terminal";
export { type WorkspaceConfig } from "./workspace";
export {
  type WorktreeConfig,
  type WorktreeHook,
  type WorktreeHookContext,
  type WorktreeOpenMode,
} from "./worktree";
export {
  canonicalizeParsed,
  canonicalizeSecondKey,
  compileKeybindings,
  type BindingEntry,
  type BindingTarget,
  type CompiledBindingEntry,
  type CompiledKeybindings,
  type CustomBindingRef,
  type DetailedBinding,
  defaultKeybindings,
  DEFAULT_REPEAT_TIMEOUT_MS,
  defaultWindowsKeybindings,
  isBindingTarget,
  isCustomBindingRef,
  isDetailedBinding,
  isKeybindAction,
  KEYBIND_ACTIONS,
  type KeyBindingString,
  type KeybindAction,
  type KeybindingsConfig,
  type ParsedKeyBinding,
  type ParsedSecondKey,
  parseKeyBindingString,
  parseSecondKeyString,
  parseSetBoardStatusAction,
  parseShowSidebarViewAction,
  platformDefaultKeybindings,
  resolveBindingEntry,
  type SecondKeyString,
  SET_BOARD_STATUS_PREFIX,
  type SetBoardStatusAction,
  SHOW_SIDEBAR_VIEW_PREFIX,
  type ShowSidebarViewAction,
} from "./keybindings";
export {
  type FocusDirection,
  type KeybindHandler,
  type KeybindOptions,
  type Niwa,
  type NiwaBellApi,
  type NiwaBellEvent,
  type NiwaBellHandler,
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
