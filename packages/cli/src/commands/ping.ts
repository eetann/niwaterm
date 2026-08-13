import { define } from "gunshi";
import { failAndExit } from "../cli-error";
import { resolveIpcEndpoint, pingNiwaterm } from "../ipc-client";

export default define({
  name: "ping",
  description: "niwatermアプリとの疎通確認",
  run: async () => {
    const result = await pingNiwaterm(resolveIpcEndpoint());
    if (result.ok) {
      console.log(`pong (pid ${result.pid})`);
      return;
    }
    failAndExit(`niwatermに接続できませんでした: ${result.error}`);
  },
});
