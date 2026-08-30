// 罫線・ブロック文字（セル矩形いっぱいに描かれることを前提とした文字）の判定と、
// 行の高さへ合わせるための相似変換の計算。
//
// weztermやGhosttyはこの手の文字をフォントのグリフではなくセル矩形へ直接描画するため、
// 行間（lineHeight > フォントのセル高）があっても上下に隙間ができない。niwatermは
// フォントのグリフをそのまま描くので、fontSize=13/lineHeight=18のような設定だと
// █ が縦に並んだとき行間の分だけ隙間が見える。
// そこで「フォントがセルとして想定している矩形」＝█のインク矩形を行ボックス全体へ写す
// 相似変換（縦方向のみ）を求め、CSSのtransformで引き伸ばして隙間を無くす。

/**
 * セル矩形いっぱいに描かれる前提の文字かどうか。
 * - U+2500-257F 罫線素片（Box Drawing）
 * - U+2580-259F ブロック要素（Block Elements）
 * - U+1FB00-1FBFF レガシーコンピューティング記号（六分割・八分割ブロック等）
 *
 * PowerlineのセパレータもNerd Fontの私用領域に同じ思想で入っているが、
 * フォントによって収録範囲・デザインがまちまちで、█と同じ矩形を前提にできるとは
 * 限らないため対象に含めない。
 */
export function isCellGlyphChar(cp: number): boolean {
  if (cp >= 0x2500 && cp <= 0x259f) return true;
  if (cp >= 0x1fb00 && cp <= 0x1fbff) return true;
  return false;
}

export interface CellGlyphMetrics {
  /** 行ボックスの高さ（＝lineHeight, px） */
  lineHeight: number;
  /** 行ボックス上端からベースラインまでの距離（px） */
  baseline: number;
  /** ベースラインから█のインク上端まで（px, 上向きが正） */
  inkAscent: number;
  /** ベースラインから█のインク下端まで（px, 下向きが正） */
  inkDescent: number;
}

/** transform-origin: 0 0 で `translateY(shiftY) scaleY(scaleY)` に渡す値 */
export interface CellGlyphTransform {
  scaleY: number;
  shiftY: number;
}

/** 変換不要（測定失敗や、既に行高とインク高が一致している場合）を表す値 */
export const identityCellGlyphTransform: CellGlyphTransform = { scaleY: 1, shiftY: 0 };

/**
 * █のインク矩形 [baseline-inkAscent, baseline+inkDescent] を
 * 行ボックス [0, lineHeight] へ写す縦方向の変換を求める。
 * 測定値が異常（0以下、極端な倍率）なら変換なしを返して素のグリフ描画へフォールバックする。
 */
export function computeCellGlyphTransform(m: CellGlyphMetrics): CellGlyphTransform {
  const inkHeight = m.inkAscent + m.inkDescent;
  if (!(inkHeight > 0) || !(m.lineHeight > 0) || !Number.isFinite(m.baseline)) {
    return identityCellGlyphTransform;
  }
  const scaleY = m.lineHeight / inkHeight;
  // フォント測定が壊れている場合の暴走よけ。等倍付近の妥当な範囲だけ受け付ける
  if (scaleY < 0.5 || scaleY > 2) return identityCellGlyphTransform;
  const inkTop = m.baseline - m.inkAscent;
  return { scaleY, shiftY: -scaleY * inkTop };
}

/** 変換が実質恒等（＝DOMをラップする意味が無い）か */
export function isIdentityCellGlyphTransform(t: CellGlyphTransform): boolean {
  return Math.abs(t.scaleY - 1) < 0.001 && Math.abs(t.shiftY) < 0.05;
}
