import { define } from "gunshi";
import { ipcSocketPath, pingNiwaterm } from "../ipc-client";

export default define({
  name: "ping",
  description: "niwatermアプリとの疎通確認",
  run: async () => {
    const result = await pingNiwaterm(ipcSocketPath());
    if (result.ok) {
      console.log(`pong (pid ${result.pid})`);
      return;
    }
    console.error(`niwatermに接続できませんでした: ${result.error}`);
    process.exit(1);
  },
});
