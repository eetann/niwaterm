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
    wait: {
      type: "boolean",
      description:
        "ポップアップが閉じる（コマンド終了・手動close・タブへの昇格いずれも）までコマンドの終了を待つ。省略時はtabIdを表示して即座に終了する",
    },
    "capture-stdout": {
      type: "boolean",
      description:
        "commandの標準出力をキャプチャし、popupが閉じた後にこのCLIプロセス自身の標準出力へそのまま出力する（--waitは暗黙に有効になる。commandと同時指定必須）。fzf-tmuxのポップアップ相当の使い方を想定: 呼び出し元シェルは`selected=$(niwaterm popup open --capture-stdout -- fzf ...)`のように結果を直接受け取れる（UIの描画自体はpopup内に残ったまま、コマンドの標準出力だけを分離して返す）",
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
    const captureStdout = ctx.values["capture-stdout"];
    if (captureStdout && command === undefined) {
      failAndExit("popup openに失敗しました: --capture-stdoutはcommandと同時指定が必要です");
    }
    const result = await openPopup(
      resolveIpcEndpoint(),
      ctx.values.cwd,
      command,
      ctx.values.width,
      ctx.values.height,
      ctx.values.wait,
      captureStdout,
    );
    if (!result.ok) {
      failAndExit(`popup openに失敗しました: ${result.error}`);
    }
    // --capture-stdoutは呼び出し元シェルが結果を直接受け取れるよう、標準出力をコマンドの
    // 結果だけに保つ（tabId等の付随情報を混ぜない。fzf-tmux相当の使い方を想定）
    if (captureStdout) {
      process.stdout.write(result.stdout ?? "");
    } else {
      console.log(`tab: ${result.tabId}`);
    }
  },
});
