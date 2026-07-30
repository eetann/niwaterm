export {
  type AppearanceConfig,
  defaultAppearance,
  type ResolvedAppearanceConfig,
} from "./appearance";
export { defineConfig, type NiwatermConfig } from "./define-config";
export {
  canonicalizeParsed,
  compileKeybindings,
  defaultKeybindings,
  isKeybindAction,
  KEYBIND_ACTIONS,
  type KeyBindingString,
  type KeybindAction,
  type KeybindingsConfig,
  type ParsedKeyBinding,
  parseKeyBindingString,
} from "./keybindings";
