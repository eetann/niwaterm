import { define } from "gunshi";
import { isAgent } from "../../agent-hook";
import { agentConfigPath, setupAgent } from "../../agent-setup";
import { failAndExit } from "../../cli-error";

export default define({
  name: "setup",
  description: "エージェントの設定へniwatermのhooksを追加・更新する",
  args: {
    agent: { type: "positional", description: "codex-cli または claude-code" },
    config: {
      type: "string",
      description: "書き込み先のJSON設定ファイル（省略時はエージェントのグローバル設定）",
    },
    cli: {
      type: "string",
      description: "hooksから呼ぶCLI（niwa または niwa-dev。省略時はNIWATERM_APP_VARIANTから選択）",
    },
  },
  run: async (ctx) => {
    const agent = ctx.values.agent;
    const cli =
      ctx.values.cli ??
      (process.env["NIWATERM_APP_VARIANT"] === "niwaterm-wip" ? "niwa-dev" : "niwa");
    if (!isAgent(agent))
      return failAndExit(
        "agent setupに失敗しました: codex-cli または claude-code を指定してください",
      );
    if (cli !== "niwa" && cli !== "niwa-dev")
      return failAndExit(
        "agent setupに失敗しました: --cli は niwa または niwa-dev を指定してください",
      );
    try {
      const result = await setupAgent(agent, ctx.values.config ?? agentConfigPath(agent), cli);
      console.log(`${result.changed ? "更新しました" : "変更はありません"}: ${result.path}`);
      if (agent === "codex-cli")
        console.log("Codexの /hooks で設定を確認して信頼し、Codexを再起動してください。");
      else console.log("Claude Codeを再起動してください。");
    } catch (error) {
      failAndExit(
        `agent setupに失敗しました: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  },
});
