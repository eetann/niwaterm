import { defaultAppearance, defineConfig } from "@niwaterm/config";

export default defineConfig({
  keybindings: (niwa) => {
    // デフォルトキーバインドは先に登録済みの状態でこの関数が呼ばれるため、
    // 上書き・追加したい分だけniwa.keybindで書けばよい
    niwa.keybind("d", "split-horizontal");
    niwa.keybind("shift+d", "split-vertical");

    // 任意のTSコードを書ける（tmuxのif-shell/run-shell相当は素のif文・Bun.spawnで表現する）
    niwa.keybind("g", () => {
      niwa.popup.open({ width: 90, height: 90, command: "lazygit" });
    });
  },
  appearance: {
    // defaultAppearanceを丸ごと引き継ぎつつ、一部だけ上書きする例
    ...defaultAppearance,
    fontSize: 14,
    foreground: "#e0e0e0",
    background: "#101010",
  },
});
