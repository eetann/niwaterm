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
// 異体字セレクタの直前に来ると絵文字/テキスト表示を切り替えられる文字の近似。
// libghostty-vtはemoji-variation-sequences.txtの基底文字だけを見るが、その集合はEmoji属性の内側にある
const emojiRe = /^\p{Emoji}$/u;

const ZWJ = 0x200d;
const VS15 = 0xfe0e;
const VS16 = 0xfe0f;

/** 国旗を2つで組む地域指示記号（🇯🇵 = 🇯 + 🇵） */
function isRegionalIndicator(cp: number): boolean {
  return cp >= 0x1f1e6 && cp <= 0x1f1ff;
}

/** 肌の色の修飾子（👍🏽の🏽） */
function isEmojiModifier(cp: number): boolean {
  return cp >= 0x1f3fb && cp <= 0x1f3ff;
}

/** サブディビジョン旗（🏴󠁧󠁢󠁥󠁮󠁧󠁿）を組むタグ文字 */
function isTagChar(cp: number): boolean {
  return cp >= 0xe0020 && cp <= 0xe007f;
}

/**
 * 直前の文字と同じセルに重なる幅0の文字か。
 * libghostty-vtはこれらを直前のセルのグラフェムとして持ち、フォーマッタも基底文字の直後へ
 * 続けて出力するので、桁を数えるときは幅0として扱う
 */
export function isZeroWidthChar(ch: string): boolean {
  const cp = ch.codePointAt(0) ?? 0;
  return cp === ZWJ || isTagChar(cp) || combiningMarkRe.test(ch);
}

export interface TextCell {
  /** 1つのセルに収まるグラフェム（基底文字と、それに連なる文字） */
  text: string;
  width: 1 | 2;
}

/**
 * テキストをセル単位のグラフェムに分ける。行頭に幅0の文字が来た場合は、それ単体を幅1のセルとして扱う。
 *
 * libghostty-vtのグラフェムクラスタモード（DEC 2027、src/bun/ghostty.tsで既定オン）のセル割り当てに
 * 合わせる。ZWJの後ろの文字・2つ目の地域指示記号は直前のセルへ連なって幅2にし、VS16は絵文字の
 * 直後なら幅2、VS15なら幅1にする。Intl.Segmenterを使わないのは、fixGlyphsが描画のたびに
 * 全テキストを通すためと、セルの幅をlibghostty-vtの規則で決めるには結局コードポイントを見るため
 */
export function splitCells(text: string): TextCell[] {
  const cells: TextCell[] = [];
  let prevCp = 0;
  // 直前がZWJで、次の文字を同じセルへ連ねる状態
  let joinNext = false;
  // 最後のセルが相方を待つ地域指示記号1つだけの状態
  let pendingRegional = false;
  for (const ch of text) {
    const cp = ch.codePointAt(0) ?? 0;
    const last = cells[cells.length - 1];
    if (last && joinNext) {
      last.text += ch;
      if (!isZeroWidthChar(ch)) last.width = 2;
      joinNext = false;
    } else if (last && (cp === VS16 || cp === VS15)) {
      last.text += ch;
      if (emojiRe.test(String.fromCodePoint(prevCp))) last.width = cp === VS16 ? 2 : 1;
    } else if (last && pendingRegional && isRegionalIndicator(cp)) {
      last.text += ch;
      last.width = 2;
      pendingRegional = false;
    } else if (last && (isEmojiModifier(cp) || isZeroWidthChar(ch))) {
      last.text += ch;
      joinNext = cp === ZWJ;
    } else {
      cells.push({ text: ch, width: isWideChar(cp) ? 2 : 1 });
      pendingRegional = isRegionalIndicator(cp);
    }
    prevCp = cp;
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

/**
 * 前後の文字と1つのセルへまとまり、セルの幅を変えうる文字か（ZWJ・異体字セレクタ・地域指示記号）。
 * 単体では幅を変える文字に見えないので、テキストを描き直す必要があるかの判定に使う
 */
export function isCellJoiner(cp: number): boolean {
  return cp === ZWJ || cp === VS15 || cp === VS16 || isRegionalIndicator(cp);
}
