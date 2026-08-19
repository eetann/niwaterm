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
  description: "レイアウトプリセットを適用する（ADR 0006、Board単位）",
  args: {
    name: {
      type: "positional",
      description: "適用するプリセット名（niwaterm layout listで確認）",
    },
    replace: {
      type: "boolean",
      description: "既存Boardを置き換えて適用する（既存タブ・PTYは無条件で閉じる）",
    },
    workspace: {
      type: "string",
      short: "w",
      description:
        "新規Boardの作成先workspaceId（--replace未指定時のみ有効。省略時は現在アクティブなワークスペース）",
    },
    board: {
      type: "string",
      description:
        "--replace時の対象boardId（省略時は現在アクティブなBoard。--replace未指定時は指定不可）",
    },
    cwd: {
      type: "string",
      description:
        "タブのtabConfig.cwd未指定時に使う作業ディレクトリ（省略時はこのコマンドを実行したディレクトリ）",
    },
  },
  run: async (ctx) => {
    if (ctx.values.replace && ctx.values.workspace) {
      failAndExit("layout applyに失敗しました: --replaceと--workspaceは同時に指定できません");
    }
    if (!ctx.values.replace && ctx.values.board) {
      failAndExit("layout applyに失敗しました: --boardは--replace指定時のみ使用できます");
    }
    const target = ctx.values.replace ? "replace" : "new-board";
    const cwd = ctx.values.cwd ?? process.cwd();
    const result = await applyLayout(
      resolveIpcEndpoint(),
      ctx.values.name,
      target,
      cwd,
      ctx.values.workspace,
      ctx.values.board,
    );
    if (!result.ok) {
      failAndExit(`layout applyに失敗しました: ${result.error}`);
    }
    console.log(`board: ${result.boardId}`);
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
