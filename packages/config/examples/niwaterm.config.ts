import { defaultAppearance, defineConfig } from "@niwaterm/config";

export default defineConfig({
  keybindings: (niwa) => {
    // デフォルトキーバインドは先に登録済みの状態でこの関数が呼ばれるため、
    // 上書き・追加したい分だけniwa.keybindで書けばよい
    niwa.keybind("d", "split-horizontal");
    niwa.keybind("shift+d", "split-vertical");

    // 任意のTSコードを書ける（tmuxのif-shell/run-shell相当は素のif文・Bun.spawnで表現する）。
    // descriptionは`niwaterm keybind list`の一覧表示に使われる（省略すると"function"とだけ表示される）
    niwa.keybind(
      "g",
      () => {
        niwa.popup.open({ width: 90, height: 90, command: "lazygit" });
      },
      { description: "lazygitをポップアップで開く" },
    );
  },
  mouse: {
    // 選択範囲を右クリックした時のメニュー項目。右クリックのたびに呼ばれるため、
    // 拡張子・OSによる出し分けは素のif文で書ける（組み込みの「コピー」は常に先頭に出る）
    selectionMenu: (selection, niwa) => {
      const path = selection.text.trim();
      const opener = process.platform === "win32" ? "explorer.exe" : "open";
      return [
        {
          label: `${opener}で開く`,
          run: () => niwa.shell.run(`${opener} '${path}'`, { cwd: selection.cwd }),
        },
      ];
    },
  },
  appearance: {
    // defaultAppearanceを丸ごと引き継ぎつつ、一部だけ上書きする例
    ...defaultAppearance,
    fontSize: 14,
    foreground: "#e0e0e0",
    background: "#101010",
  },
});
