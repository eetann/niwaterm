import { define } from "gunshi";
import { failAndExit } from "../cli-error";
import { applyLayout, listLayouts, resolveIpcEndpoint } from "../ipc-client";

const listCommand = define({
  name: "list",
  description: "利用可能なレイアウトプリセットの一覧を表示",
  run: async () => {
    const result = await listLayouts(resolveIpcEndpoint());
    if (!result.ok) {
      failAndExit(`layout listに失敗しました: ${result.error}`);
    }
    if (result.layouts.length === 0) {
      console.log("レイアウトプリセットが設定されていません（niwaterm.config.tsのlayoutsを参照）");
      return;
    }
    for (const layout of result.layouts) {
      console.log(`${layout.name}\t${layout.description ?? ""}`);
    }
  },
});

const applyCommand = define({
  name: "apply",
  description: "レイアウトプリセットを適用する",
  args: {
    name: {
      type: "positional",
      description: "適用するプリセット名（niwaterm layout listで確認）",
    },
    "new-workspace": {
      type: "boolean",
      description: "新規ワークスペースとして適用する（デフォルト）",
    },
    replace: {
      type: "boolean",
      description: "現在のワークスペースを置き換えて適用する（既存タブ・PTYは無条件で閉じる）",
    },
  },
  run: async (ctx) => {
    if (ctx.values["new-workspace"] && ctx.values.replace) {
      failAndExit("layout applyに失敗しました: --new-workspaceと--replaceは同時に指定できません");
    }
    const target = ctx.values.replace ? "replace" : "new-workspace";
    const result = await applyLayout(resolveIpcEndpoint(), ctx.values.name, target);
    if (!result.ok) {
      failAndExit(`layout applyに失敗しました: ${result.error}`);
    }
    console.log(`workspace: ${result.workspaceId}`);
  },
});

export default define({
  name: "layout",
  description: "レイアウトプリセットを一覧・適用する（vde-layoutライク）",
  subCommands: { list: listCommand, apply: applyCommand },
  run: () => {
    console.log('Run "niwaterm layout list" or "niwaterm layout apply <name>".');
  },
});
