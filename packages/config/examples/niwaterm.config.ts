import { defaultAppearance, defaultKeybindings, defineConfig } from "@niwaterm/config";

export default defineConfig({
  keybindings: {
    // defaultKeybindingsを丸ごと引き継ぎつつ、一部だけ上書きする例
    ...defaultKeybindings,
    "cmd+d": "split-horizontal",
    "cmd+shift+d": "split-vertical",
  },
  appearance: {
    // defaultAppearanceを丸ごと引き継ぎつつ、一部だけ上書きする例
    ...defaultAppearance,
    fontSize: 14,
    foreground: "#e0e0e0",
    background: "#101010",
  },
});
