import { define } from "gunshi";
import { failAndExit } from "../cli-error";
import { openPopup, resolveIpcEndpoint } from "../ipc-client";

export default define({
  name: "popup",
  description: "タイル・タブに所属しない一時的なポップアップ画面を開く（tmuxのpopup/floating相当）",
  args: {
    cwd: {
      type: "string",
      description:
        "ポップアップの作業ディレクトリ（省略時はフォーカス中タブが実際にいるディレクトリ）",
    },
    width: {
      type: "number",
      description: "表示幅（1〜100のパーセント、省略時は既定値）",
    },
    height: {
      type: "number",
      description: "表示高さ（1〜100のパーセント、省略時は既定値）",
    },
    command: {
      type: "positional",
      multiple: true,
      description:
        "デフォルトシェルの起動後に実行するコマンド（省略時はシェルを起動したままにする）。指定すると実行完了で自動的にポップアップが閉じる（ワンショット実行。例: niwaterm popup lazygit）。既知の制約: lazygit/nvim等の対話的TUIでは自動closeが機能しないことがある（詳細: niwaterm docs show cli）",
    },
  },
  run: async (ctx) => {
    const commandParts = ctx.values.command ?? [];
    const command = commandParts.length > 0 ? commandParts.join(" ") : undefined;
    const result = await openPopup(
      resolveIpcEndpoint(),
      ctx.values.cwd,
      command,
      ctx.values.width,
      ctx.values.height,
    );
    if (!result.ok) {
      failAndExit(`popupに失敗しました: ${result.error}`);
    }
    console.log(`tab: ${result.tabId}`);
  },
});
