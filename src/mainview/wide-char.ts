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

export function isWideChar(cp: number): boolean {
  if (cp < 0x1100) return false;
  for (const [lo, hi] of wideRanges) {
    if (cp >= lo && cp <= hi) return true;
  }
  return false;
}
