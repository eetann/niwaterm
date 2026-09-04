import { createInterface } from "node:readline/promises";
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

/** 非対話環境（パイプ・スクリプト実行等）ではハングせずエラーで終了し、--replace-forceの利用を促す */
async function confirmReplace(boardLabel: string): Promise<boolean> {
  if (!process.stdin.isTTY) {
    failAndExit(
      "layout applyに失敗しました: 非対話環境のため--replaceの確認ができません。確認をスキップするには--replace-forceを使ってください",
    );
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await rl.question(
      `${boardLabel}の既存タブ・PTYをすべて閉じてレイアウトを適用します。よろしいですか？ (y/N) `,
    );
    return /^y(es)?$/i.test(answer.trim());
  } finally {
    rl.close();
  }
}

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
      description:
        "既存Boardを置き換えて適用する（既存タブ・PTYは無条件で閉じる。実行前にy/nで確認する）",
    },
    "replace-force": {
      type: "boolean",
      description: "--replaceと同じだが、確認なしで実行する",
    },
    workspace: {
      type: "string",
      short: "w",
      description:
        "新規Boardの作成先workspaceId（--replace/--replace-force未指定時のみ有効。省略時は現在アクティブなワークスペース）",
    },
    board: {
      type: "string",
      description:
        "--replace/--replace-force時の対象boardId（省略時は現在アクティブなBoard。それ以外は指定不可）",
    },
    cwd: {
      type: "string",
      description:
        "タブのtabConfig.cwd未指定時に使う作業ディレクトリ（省略時はこのコマンドを実行したディレクトリ）",
    },
    startup: {
      type: "boolean",
      description:
        "次回以降の起動時も、このBoardをこのプリセットで組み直す（保存した骨格の復元ではなくcommandごと再実行される）",
    },
  },
  run: async (ctx) => {
    const isReplace = ctx.values.replace || ctx.values["replace-force"];
    if (isReplace && ctx.values.workspace) {
      failAndExit(
        "layout applyに失敗しました: --replace/--replace-forceと--workspaceは同時に指定できません",
      );
    }
    if (!isReplace && ctx.values.board) {
      failAndExit(
        "layout applyに失敗しました: --boardは--replace/--replace-force指定時のみ使用できます",
      );
    }

    if (ctx.values.replace && !ctx.values["replace-force"]) {
      const boardLabel = ctx.values.board ? `Board ${ctx.values.board}` : "現在アクティブなBoard";
      const confirmed = await confirmReplace(boardLabel);
      if (!confirmed) {
        console.log("キャンセルしました");
        return;
      }
    }

    const target = isReplace ? "replace" : "new-board";
    const cwd = ctx.values.cwd ?? process.cwd();
    const result = await applyLayout(resolveIpcEndpoint(), ctx.values.name, {
      target,
      cwd,
      workspaceId: ctx.values.workspace,
      boardId: ctx.values.board,
      startup: ctx.values.startup,
    });
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
