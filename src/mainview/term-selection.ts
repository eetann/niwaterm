// .termのinnerHTML差し替えをまたいでテキスト選択を引き継ぐための位置計算。
//
// 差し替えは選択の端点があるテキストノードごと作り直すため、何もしないと選択はその場で消える。
// 差し替え前の端点を「画面テキスト（textContent）上の行と行内の位置」で覚えておき、
// 差し替え後の同じ位置へ張り直す。DOMを触る部分はindex.ts側が持つ。

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
