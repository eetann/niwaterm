import { define } from "gunshi";
import { failAndExit } from "../../cli-error";
import { resolveIpcEndpoint, respawnTab } from "../../ipc-client";

export default define({
  name: "respawn",
  description:
    "指定したタブのプロセスを強制終了し、同じtabIdのまま再起動する（tmux respawn-pane -k相当）",
  args: {
    tab: {
      type: "string",
      short: "t",
      required: true,
      description: "再起動するtabId（niwaterm listで確認）",
    },
    shell: {
      type: "string",
      short: "s",
      description:
        "指定したシェルプロファイル（idはniwaterm shell-profilesで確認）で再起動する（省略時はデフォルトシェル）",
    },
    cwd: {
      type: "string",
      description:
        "再起動後の作業ディレクトリ（省略時は元のタブが実際にいるディレクトリを引き継ぐ）",
    },
    command: {
      type: "string",
      description: "指定すると、シェルの代わりにこのコマンドを実行する（ワンショット実行）",
    },
  },
  run: async (ctx) => {
    const result = await respawnTab(
      resolveIpcEndpoint(),
      ctx.values.tab,
      ctx.values.shell,
      ctx.values.cwd,
      ctx.values.command,
    );
    if (!result.ok) {
      failAndExit(`tab respawnに失敗しました: ${result.error}`);
    }
  },
});
