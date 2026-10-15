import { styleText } from "node:util";
import { define } from "gunshi";
import { failAndExit } from "../cli-error";
import {
  resolveIpcEndpoint,
  getListTree,
  type ListTree,
  type ListTreeBoard,
  type ListTreeLayoutNode,
  type ListTreeWorkspace,
} from "../ipc-client";

/** 表示の役割ごとの色付け。色の選び方をここに集め、整形処理は役割だけを指定する */
export interface ListPalette {
  /** ユーザーが付けた名前・自動名 */
  name: (text: string) => string;
  /** (active)・(focused)など今の状態を表す印 */
  state: (text: string) => string;
  /** 分割ノードの行や、ブラウザタブのURLなど補足 */
  muted: (text: string) => string;
  /** [phase: …]・[startup: …]など付けられた属性 */
  tag: (text: string) => string;
  /** (exited)・(missing)など注意を引きたい状態 */
  alert: (text: string) => string;
}

const plain = (text: string) => text;

export const PLAIN_PALETTE: ListPalette = {
  name: plain,
  state: plain,
  muted: plain,
  tag: plain,
  alert: plain,
};

/**
 * 端末の16色だけを使い、ユーザーの端末テーマの配色に従わせる。styleTextはstdoutが端末で
 * なければ・NO_COLORが付いていれば色を付けず、FORCE_COLORが付いていれば付ける
 */
export const COLOR_PALETTE: ListPalette = {
  name: (text) => styleText("cyan", text),
  state: (text) => styleText("green", text),
  muted: (text) => styleText("dim", text),
  tag: (text) => styleText("yellow", text),
  alert: (text) => styleText("red", text),
};

/** 名前があればidの直後へ` "名前"`として差し込む。未設定は空文字列 */
function nameSuffix(name: string | null | undefined, palette: ListPalette): string {
  return name ? ` ${palette.name(`"${name}"`)}` : "";
}

function stateSuffix(enabled: boolean, label: string, palette: ListPalette): string {
  return enabled ? ` ${palette.state(`(${label})`)}` : "";
}

function layoutLines(
  node: ListTreeLayoutNode,
  board: ListTreeBoard,
  depth: number,
  palette: ListPalette,
): string[] {
  const indent = "  ".repeat(depth);
  if (node.kind === "split") {
    return [
      `${indent}${palette.muted(`${node.id} (split: ${node.orientation})`)}`,
      ...layoutLines(node.first, board, depth + 1, palette),
      ...layoutLines(node.second, board, depth + 1, palette),
    ];
  }
  const tile = board.tiles.find((t) => t.id === node.id);
  const lines = [
    `${indent}${node.id}${nameSuffix(tile?.name, palette)}` +
      `${stateSuffix(tile?.focused ?? false, "focused", palette)}` +
      `${stateSuffix(tile?.zoomed ?? false, "zoomed", palette)}`,
  ];
  for (const tab of board.tabs.filter((t) => t.tileId === node.id)) {
    const url = tab.url ? ` ${palette.muted(`[browser: ${tab.url}]`)}` : "";
    const exited = tab.exited ? ` ${palette.alert("(exited)")}` : "";
    lines.push(
      `${indent}  ${tab.id}${nameSuffix(tab.name, palette)}` +
        `${stateSuffix(tab.active, "active", palette)}${url}${exited}`,
    );
  }
  return lines;
}

function boardLines(board: ListTreeBoard, depth: number, palette: ListPalette): string[] {
  const indent = "  ".repeat(depth);
  // 自動名はniwaterm側の表示と揃えるために出す（ユーザーが付けた名前と紛れないよう括弧なしにする）
  const name = board.name ?? board.autoName;
  const startup = board.startup
    ? ` ${palette.tag(`[${board.startup.restoreMode === "layout" ? "startup" : "preset"}: ${board.startup.preset}]`)}`
    : "";
  const phase = board.phase ? ` ${palette.tag(`[phase: ${board.phase}]`)}` : "";
  return [
    `${indent}${board.id}${nameSuffix(name, palette)}` +
      `${stateSuffix(board.active, "active", palette)}${startup}${phase}`,
    ...layoutLines(board.layout, board, depth + 1, palette),
  ];
}

function workspaceLines(entry: ListTreeWorkspace, palette: ListPalette): string[] {
  const head = `${entry.id}${nameSuffix(entry.name, palette)}${stateSuffix(entry.active, "active", palette)}`;
  // Board 1つのみ（大半のケース）はBoard行を省略し、直接タイル階層を表示する
  // （サイドバーの表示方針・ADR 0006と揃える）。ただしレイアウトプリセットや作業フェーズが
  // 紐づいているBoardは、board startupの対象を確認できるようBoard行を残す
  const only = entry.boards.length === 1 ? entry.boards[0] : undefined;
  if (only && !only.startup && !only.phase) {
    return [head, ...layoutLines(only.layout, only, 1, palette)];
  }
  return [head, ...entry.boards.flatMap((board) => boardLines(board, 1, palette))];
}

export function formatListTree(tree: ListTree, palette: ListPalette = PLAIN_PALETTE): string[] {
  return tree.workspaces.flatMap((entry) => workspaceLines(entry, palette));
}

export default define({
  name: "list",
  description: "ワークスペース・Board・タイル・タブの一覧を表示",
  args: {
    json: {
      type: "boolean",
      description: "JSON形式で出力する（スクリプト・jq・AIエージェントからのパース用）",
    },
  },
  run: async (ctx) => {
    const result = await getListTree(resolveIpcEndpoint());
    if (!result.ok) {
      failAndExit(`niwatermに接続できませんでした: ${result.error}`);
    }
    if (ctx.values.json) {
      // タブ変数を含むため大きくなりうる。console.logはパイプ相手だと途中で切れる
      // （docs/known-issues/bun-cli-stdout-breaks-over-pipe-for-large-output.md）
      process.stdout.write(`${JSON.stringify(result.tree, null, 2)}\n`);
      return;
    }
    for (const line of formatListTree(result.tree, COLOR_PALETTE)) {
      console.log(line);
    }
  },
});
