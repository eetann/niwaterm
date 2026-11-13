import { createInterface } from "node:readline/promises";
import { define } from "gunshi";
import { failAndExit } from "../cli-error";
import { confirmTrust } from "../layout-trust";
import {
  applyLayout,
  type BoardListEntry,
  listLayouts,
  listWorkspaces,
  resolveIpcEndpoint,
  type WorkspaceListEntry,
} from "../ipc-client";
import { resolveWorkspaceQuery } from "../resolve-workspace";

const listCommand = define({
  name: "list",
  description: "利用可能なレイアウトプリセットの一覧を表示",
  args: {
    cwd: {
      type: "string",
      description:
        "プロジェクトローカルのプリセット（.niwaterm/config.ts）を探す起点ディレクトリ（省略時はこのコマンドを実行したディレクトリ）",
    },
  },
  run: async (ctx) => {
    const result = await listLayouts(resolveIpcEndpoint(), ctx.values.cwd ?? process.cwd());
    if (!result.ok) {
      failAndExit(`layout listに失敗しました: ${result.error}`);
    }
    // 解決元を必ず出す: 同名プリセットはproject → global → builtinの順で優先されるため、
    // どれが適用されるのかが名前だけでは分からない
    for (const layout of result.layouts) {
      const source = layout.builtin
        ? "[builtin]"
        : layout.projectRoot
          ? `[project: ${layout.projectRoot}]`
          : "[global]";
      console.log(`${layout.name}\t${source}\t${layout.description ?? ""}`);
    }
    // ビルトインは常に出るので、ユーザー定義が1件も無いことは件数からは分からない
    if (result.layouts.every((layout) => layout.builtin)) {
      console.log(
        "（ユーザー定義のレイアウトプリセットはありません。niwaterm.config.tsのlayouts、または.niwaterm/config.tsを参照）",
      );
    }
  },
});

/**
 * --replaceの対象Boardを引く。boardId省略時のフォールバックはアプリ側（/apply-layoutの
 * target: "replace"）と同じく「アクティブWorkspaceのactiveBoard」に揃える。
 * 見つからない場合はundefined（適用自体がアプリ側で弾かれる）
 */
function findReplaceTargetBoard(
  workspaces: WorkspaceListEntry[],
  boardId: string | undefined,
): BoardListEntry | undefined {
  if (boardId) {
    return workspaces.flatMap((w) => w.boards).find((b) => b.boardId === boardId);
  }
  const active = workspaces.find((w) => w.active);
  return active?.boards.find((b) => b.boardId === active.activeBoardId);
}

/**
 * --replaceの適用で閉じられる既存タブがあるか。対象Boardが単一タイル・単一タブなら
 * 適用で失われるものが無いため、破壊的操作の確認自体が不要になる。
 * 対象Boardが見つからないときはtrue（存在しないboardIdの指定等。適用はアプリ側で弾かれる）
 */
export function replaceClosesExistingTabs(
  workspaces: WorkspaceListEntry[],
  boardId: string | undefined,
): boolean {
  const board = findReplaceTargetBoard(workspaces, boardId);
  if (!board) return true;
  return !(board.layout.kind === "leaf" && board.layout.tabIds.length === 1);
}

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
      description: "適用するプリセット名（niwa layout listで確認）",
    },
    replace: {
      type: "boolean",
      description:
        "既存Boardを置き換えて適用する（既存タブ・PTYは無条件で閉じる。閉じるタブがある場合のみ実行前にy/nで確認する）",
    },
    "replace-force": {
      type: "boolean",
      description: "--replaceと同じだが、確認なしで実行する",
    },
    workspace: {
      type: "string",
      short: "w",
      description:
        "新規Boardの作成先ワークスペース（workspaceIdか名前の一部。--replace/--replace-force未指定時のみ有効。省略時は現在アクティブなワークスペース）",
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
    trust: {
      type: "boolean",
      description:
        "プロジェクトローカルのプリセットを--startupで紐づける際の確認をスキップする（非対話環境用）",
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

    const target = isReplace ? "replace" : "new-board";
    const cwd = ctx.values.cwd ?? process.cwd();
    const endpoint = resolveIpcEndpoint();
    const workspaceId =
      ctx.values.workspace !== undefined
        ? await resolveWorkspaceQuery(endpoint, "layout apply", ctx.values.workspace)
        : undefined;

    // trustの確認を--replaceの破壊的確認より先に取る。逆順だと「既存タブを全部閉じますか？」に
    // yと答えた直後に別の確認が出て、そこでnと答えると最初の確認が無駄になる。
    // 判定には読み取り専用のlayout listを使い、解決元がプロジェクトローカルかを事前に見る
    // （アプリ側のtrust gateは残してあるので、ここを通り抜けても最終的には弾かれる）
    let trust = ctx.values.trust;
    if (ctx.values.startup && !trust) {
      const listed = await listLayouts(endpoint, cwd);
      if (!listed.ok) {
        failAndExit(`layout applyに失敗しました: ${listed.error}`);
      }
      const projectRoot = listed.layouts.find((l) => l.name === ctx.values.name)?.projectRoot;
      if (projectRoot) {
        if (!(await confirmTrust({ projectRoot, preset: ctx.values.name }))) {
          console.log("キャンセルしました");
          return;
        }
        trust = true;
      }
    }

    if (ctx.values.replace && !ctx.values["replace-force"]) {
      // 一覧を取れないときは安全側に倒して確認する（接続不能ならこの後の適用自体も失敗する）
      const listed = await listWorkspaces(endpoint);
      if (!listed.ok || replaceClosesExistingTabs(listed.workspaces, ctx.values.board)) {
        const boardLabel = ctx.values.board ? `Board ${ctx.values.board}` : "現在アクティブなBoard";
        const confirmed = await confirmReplace(boardLabel);
        if (!confirmed) {
          console.log("キャンセルしました");
          return;
        }
      }
    }

    const applyOnce = (t: boolean | undefined) =>
      applyLayout(endpoint, ctx.values.name, {
        target,
        cwd,
        workspaceId,
        boardId: ctx.values.board,
        startup: ctx.values.startup,
        trust: t,
      });

    let result = await applyOnce(trust);
    // 事前確認をすり抜けた場合（プリセット一覧を取ってから適用するまでの間に設定が変わった等）の保険。
    // アプリ側が同意を求めてきたら、ここでも確認を取って付け直す
    if (!result.ok && "needsTrust" in result) {
      if (!(await confirmTrust(result.needsTrust))) {
        console.log("キャンセルしました");
        return;
      }
      result = await applyOnce(true);
    }
    if (!result.ok) {
      failAndExit(`layout applyに失敗しました: ${result.error}`);
    }
    const source = result.projectRoot ? ` [project: ${result.projectRoot}]` : "";
    console.log(`board: ${result.boardId}\tpreset: ${ctx.values.name}${source}`);
  },
});

export default define({
  name: "layout",
  description: "レイアウトプリセットを一覧・適用する（vde-layoutライク）",
  subCommands: { list: listCommand, apply: applyCommand },
  run: () => {
    console.log('Run "niwa layout list" or "niwa layout apply <name>".');
  },
});
