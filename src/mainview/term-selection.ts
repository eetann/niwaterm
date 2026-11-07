// .termのinnerHTML差し替えをまたいでテキスト選択を引き継ぐための位置計算。
//
// 差し替えは選択の端点があるテキストノードごと作り直すため、何もしないと選択はその場で消える。
// 差し替え前の端点を「画面テキスト（textContent）上の行と行内の位置」で覚えておき、
// 差し替え後の同じ位置へ張り直す。DOMを触る部分はindex.ts側が持つ。
//
// 選択をコピーモードへ引き継ぐときの、画面テキスト上の位置→セル（桁・行）の変換もここに置く。

import { splitCells } from "../shared/wide-char";

/** 画面テキスト上の位置。colは行頭からのUTF-16単位の位置 */
export interface TextPoint {
  row: number;
  col: number;
}

/** 画面テキスト上の選択の両端（textContent先頭からのUTF-16単位の位置） */
export interface TextSelectionOffsets {
  anchor: number;
  focus: number;
}

function rowStarts(text: string): number[] {
  const starts = [0];
  for (let i = text.indexOf("\n"); i >= 0; i = text.indexOf("\n", i + 1)) starts.push(i + 1);
  return starts;
}

function pointAt(starts: number[], offset: number): TextPoint {
  let row = 0;
  while (row + 1 < starts.length && (starts[row + 1] ?? 0) <= offset) row++;
  return { row, col: offset - (starts[row] ?? 0) };
}

function rowText(text: string, starts: number[], row: number): string | null {
  const start = starts[row];
  if (start === undefined) return null;
  const next = starts[row + 1];
  return text.slice(start, next === undefined ? text.length : next - 1);
}

/**
 * 差し替え前の選択を差し替え後の画面テキストへ移す。選択が掛かっている行の内容が1行でも
 * 変わっていたらnull（同じ位置へ張り直すと、利用者が選んだのとは別の文字を選んだことになるため）。
 * 行単位で比べるので、選択と無関係な行（スピナーやプロンプト等）だけが変わった描画では引き継げる
 */
export function remapSelection(
  oldText: string,
  newText: string,
  selection: TextSelectionOffsets,
): TextSelectionOffsets | null {
  const oldStarts = rowStarts(oldText);
  const newStarts = rowStarts(newText);
  const anchor = pointAt(oldStarts, selection.anchor);
  const focus = pointAt(oldStarts, selection.focus);
  const firstRow = Math.min(anchor.row, focus.row);
  const lastRow = Math.max(anchor.row, focus.row);
  for (let row = firstRow; row <= lastRow; row++) {
    const before = rowText(oldText, oldStarts, row);
    if (before === null || before !== rowText(newText, newStarts, row)) return null;
  }
  return {
    anchor: (newStarts[anchor.row] ?? 0) + anchor.col,
    focus: (newStarts[focus.row] ?? 0) + focus.col,
  };
}

/** ビューポート座標のセル。xは桁（全角文字は2桁を占める）、yは行 */
export interface CellPoint {
  x: number;
  y: number;
}

/** 選択の両端をセルへ直したもの。両端のセルを含む */
export interface SelectionCells {
  /** 選択を始めた側の端 */
  anchor: CellPoint;
  /** 選択を終えた側の端 */
  cursor: CellPoint;
}

/** 画面テキスト上の位置にある文字のセル。行末の改行を指したらnull */
function cellOfOffset(text: string, starts: number[], offset: number): CellPoint | null {
  const { row, col } = pointAt(starts, offset);
  let used = 0;
  let x = 0;
  for (const cell of splitCells(rowText(text, starts, row) ?? "")) {
    used += cell.text.length;
    if (col < used) return { x, y: row };
    x += cell.width;
  }
  return null;
}

/** 行の最後の文字のセル。空行なら0桁 */
function lastCellOfRow(text: string, starts: number[], row: number): CellPoint {
  let x = 0;
  let lastX = 0;
  for (const cell of splitCells(rowText(text, starts, row) ?? "")) {
    lastX = x;
    x += cell.width;
  }
  return { x: lastX, y: row };
}

/**
 * 画面テキスト上の選択を、コピーモードへ渡すセルの範囲へ直す。DOMの選択の端は文字の間を指す
 * （終端の位置にある文字は含まない）が、コピーモードの範囲は両端のセルを含むので、後ろ側の端は
 * 1文字手前の文字のセルにする。行末の改行に掛かった端は、始端なら次の行の頭、終端ならその行の
 * 最後の文字へ寄せる。空の選択と、改行だけを選んだ選択はnull
 */
export function selectionCells(
  text: string,
  selection: TextSelectionOffsets,
): SelectionCells | null {
  const lo = Math.min(selection.anchor, selection.focus);
  const hi = Math.max(selection.anchor, selection.focus);
  if (lo === hi) return null;
  const starts = rowStarts(text);
  const start = cellOfOffset(text, starts, lo) ?? { x: 0, y: pointAt(starts, lo).row + 1 };
  const endRow = pointAt(starts, hi - 1).row;
  const end = cellOfOffset(text, starts, hi - 1) ?? lastCellOfRow(text, starts, endRow);
  if (start.y > end.y || (start.y === end.y && start.x > end.x)) return null;
  return selection.anchor <= selection.focus
    ? { anchor: start, cursor: end }
    : { anchor: end, cursor: start };
}
