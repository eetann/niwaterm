import { define } from "gunshi";
import { failAndExit } from "../cli-error";
import { resolveIpcEndpoint, sendNotification } from "../ipc-client";

export default define({
  name: "notify",
  description:
    "OSのデスクトップ通知を出す（AIエージェントがタスク完了等をユーザーへ知らせる用途を想定。" +
    "macOSではクリックすると通知元のタブへ遷移する）",
  args: {
    title: {
      type: "string",
      required: true,
      description: "通知のタイトル",
    },
    body: {
      type: "string",
      description: "通知本文",
    },
    subtitle: {
      type: "string",
      description: "サブタイトル（macOSのみ独立表示、他OSはbodyの下の追加行として表示される）",
    },
    silent: {
      type: "boolean",
      description: "指定すると通知音を鳴らさない",
    },
    tab: {
      type: "string",
      description:
        "クリック時の遷移先タブ（macOSのみ。省略時はこのコマンドを実行しているタブ。niwaterm外から実行した場合は遷移しない）",
    },
  },
  run: async (ctx) => {
    const result = await sendNotification(
      resolveIpcEndpoint(),
      ctx.values.title,
      ctx.values.body,
      ctx.values.subtitle,
      ctx.values.silent,
      // 省略時にアクティブタブへフォールバックしないのは、通知を出した時点のアクティブタブは
      // 通知元と無関係で、クリックで飛ばされても意味が無いため
      ctx.values.tab ?? process.env["NIWATERM_TAB_ID"],
    );
    if (!result.ok) {
      failAndExit(`notifyに失敗しました: ${result.error}`);
    }
  },
});
