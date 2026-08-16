import { define } from "gunshi";
import { failAndExit } from "../../cli-error";
import { openPopup, resolveIpcEndpoint } from "../../ipc-client";

export default define({
  name: "open",
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
        "デフォルトシェル（WSLプロファイル等も含む）でこのコマンドを実行する（省略時はシェルを起動したままにする）。コマンドが終了すると自動的にポップアップが閉じる（ワンショット実行。lazygit等のフルスクリーンTUIでも機能する。例: niwaterm popup open lazygit）",
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
      failAndExit(`popup openに失敗しました: ${result.error}`);
    }
    console.log(`tab: ${result.tabId}`);
  },
});
