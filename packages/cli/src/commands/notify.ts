import { define } from "gunshi";
import { failAndExit } from "../cli-error";
import { resolveIpcEndpoint, sendNotification } from "../ipc-client";

export default define({
  name: "notify",
  description:
    "OSのデスクトップ通知を出す（AIエージェントがタスク完了等をユーザーへ知らせる用途を想定。" +
    "クリックしてもniwatermへのフォーカス移動は行わない）",
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
  },
  run: async (ctx) => {
    const result = await sendNotification(
      resolveIpcEndpoint(),
      ctx.values.title,
      ctx.values.body,
      ctx.values.subtitle,
      ctx.values.silent,
    );
    if (!result.ok) {
      failAndExit(`notifyに失敗しました: ${result.error}`);
    }
  },
});
