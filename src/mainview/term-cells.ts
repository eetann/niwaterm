// 描画済み画面のテキストと、桁・行（ビューポート座標）との対応付け。
//
// フォーマッタのHTMLは1行＝"\n"区切り・1セル1文字（全角は2セル）で出力され、行末の空白は
// 含まれない。カーソルを「そのセルに乗っている文字」に合わせて描くために、テキストを
// 桁として数え直す係。

import { isWideChar } from "../shared/wide-char";

/** 桁・行で指したセルに乗っている文字と、そのセルの実際の位置 */
export interface TermCell {
  char: string;
  /** そのセルの開始桁。全角文字の右半分を指した場合は左半分の桁になる */
  col: number;
  /** 2セル幅を占める文字か */
  wide: boolean;
}

/**
 * 画面テキストのうち、ビューポート座標(x, y)のセルに乗っている文字を返す。
 * 行の内容より右の桁（フォーマッタが出力しない行末の空白）と存在しない行はnull。
 */
export function cellAt(screenText: string, x: number, y: number): TermCell | null {
  if (x < 0 || y < 0) return null;
  let start = 0;
  for (let row = 0; row < y; row++) {
    const lineEnd = screenText.indexOf("\n", start);
    if (lineEnd < 0) return null;
    start = lineEnd + 1;
  }
  const end = screenText.indexOf("\n", start);
  const line = screenText.slice(start, end < 0 ? screenText.length : end);
  let col = 0;
  for (const char of line) {
    const wide = isWideChar(char.codePointAt(0) ?? 0);
    const width = wide ? 2 : 1;
    if (x < col + width) return { char, col, wide };
    col += width;
  }
  return null;
}
