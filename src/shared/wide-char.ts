// East Asian Wide / Fullwidth の主要範囲（libghostty-vtのwcwidth=2に合わせる）
const wideRanges: Array<[number, number]> = [
  [0x1100, 0x115f], // Hangul Jamo
  [0x2e80, 0x303e], // CJK部首・記号（〜IDEOGRAPHIC SPACE手前まで含む）
  [0x3041, 0x33ff], // ひらがな・カタカナ・CJK記号・囲み文字
  [0x3400, 0x4dbf], // CJK拡張A
  [0x4e00, 0x9fff], // CJK統合漢字
  [0xa000, 0xa4cf], // Yi
  [0xac00, 0xd7a3], // Hangul音節
  [0xf900, 0xfaff], // CJK互換漢字
  [0xfe30, 0xfe4f], // CJK互換形
  [0xff00, 0xff60], // 全角英数・記号
  [0xffe0, 0xffe6], // 全角記号
  [0x1f300, 0x1faff], // 絵文字
  [0x20000, 0x3fffd], // CJK拡張B〜
];

// 非スペーシング結合文字・囲み結合文字（結合用濁点U+3099、異体字セレクタ等）
const combiningMarkRe = /^[\p{Mn}\p{Me}]$/u;

/**
 * 直前の文字と同じセルに重なる幅0の文字か。
 * libghostty-vtはこれらを直前のセルのグラフェムとして持ち、フォーマッタも基底文字の直後へ
 * 続けて出力するので、桁を数えるときは幅0として扱う
 */
export function isZeroWidthChar(ch: string): boolean {
  return combiningMarkRe.test(ch);
}

/** 1文字（コードポイント単位）が占めるセル数 */
export function charWidth(ch: string): 0 | 1 | 2 {
  if (isZeroWidthChar(ch)) return 0;
  return isWideChar(ch.codePointAt(0) ?? 0) ? 2 : 1;
}

export interface TextCell {
  /** 基底文字と、それに続く幅0の文字 */
  text: string;
  width: 1 | 2;
}

/**
 * テキストをセル単位（基底文字＋後続の幅0の文字）に分ける。
 * 行頭に幅0の文字が来た場合は、それ単体を幅1のセルとして扱う
 */
export function splitCells(text: string): TextCell[] {
  const cells: TextCell[] = [];
  for (const ch of text) {
    const width = charWidth(ch);
    const last = cells[cells.length - 1];
    if (width === 0 && last) {
      last.text += ch;
    } else {
      cells.push({ text: ch, width: width === 2 ? 2 : 1 });
    }
  }
  return cells;
}

export function isWideChar(cp: number): boolean {
  if (cp < 0x1100) return false;
  // ひらがなブロック内の結合用濁点・半濁点は幅0
  if (cp === 0x3099 || cp === 0x309a) return false;
  for (const [lo, hi] of wideRanges) {
    if (cp >= lo && cp <= hi) return true;
  }
  return false;
}
