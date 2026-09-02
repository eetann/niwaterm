// 罫線・ブロック文字（セル矩形いっぱいに描かれることを前提とした文字）の判定と、
// 行の高さへ合わせるための相似変換の計算。
//
// weztermやGhosttyはこの手の文字をフォントのグリフではなくセル矩形へ直接描画するため、
// 行間（lineHeight > フォントのセル高）があっても上下に隙間ができない。niwatermは
// フォントのグリフをそのまま描くので、fontSize=13/lineHeight=18のような設定だと
// █ が縦に並んだとき行間の分だけ隙間が見える。
// そこで「フォントがセルとして想定している矩形」＝█のインク矩形が行ボックス全体を覆うような
// 縦方向の変換を求め、CSSのtransformで引き伸ばして隙間を無くす。
//
// 倍率は理論値では決められない。Windows(Chromium/DirectWrite)はグリフのラスタライズ解像度(ppem)を
// 整数へ丸めるため、たとえばfont-size 13pxに1.03倍のscaleYをかけてもppemは13のままで、
// 描かれるグリフの大きさは1ミリも変わらない（macOS/WebKitは小数のまま拡大されるので効く）。
// このため倍率は「実際にラスタライズして測る」以外に決めようがなく、インクの実測は呼び出し側
// (src/mainview/index.ts)がcanvasへ描いて走査する。ここはその実測値から変換を組み立てる係。
// ppemの丸めの詳細: docs/known-issues/windows-chromium-quantizes-glyph-raster-size.md

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
  /** 採用する拡大率（実測で行の高さを埋められると分かっている値） */
  scaleY: number;
  /** scaleYをかけたときに実際に描かれる、ベースラインから█のインク上端まで（px, 上向きが正） */
  inkAscent: number;
  /** scaleYをかけたときに実際に描かれる、ベースラインから█のインク下端まで（px, 下向きが正） */
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
 * scaleY倍したときのインク矩形が行ボックス [0, lineHeight] を覆うように、縦方向の平行移動量を求める。
 * インクが行の高さより大きい場合（ppemの丸めで1段階大きいグリフを使う場合など）は
 * はみ出す分を上下へ均等に振り、行の中心とインクの中心を合わせる。
 * 測定値が異常（0以下、極端な倍率）なら変換なしを返して素のグリフ描画へフォールバックする。
 */
export function computeCellGlyphTransform(m: CellGlyphMetrics): CellGlyphTransform {
  const inkHeight = m.inkAscent + m.inkDescent;
  if (!(inkHeight > 0) || !(m.lineHeight > 0) || !Number.isFinite(m.baseline)) {
    return identityCellGlyphTransform;
  }
  // フォント測定が壊れている場合の暴走よけ。等倍付近の妥当な範囲だけ受け付ける
  if (!(m.scaleY >= 0.5) || !(m.scaleY <= 2)) return identityCellGlyphTransform;
  // scaleYはtransform-origin: 0 0 で効くので、インクの位置もscaleY倍された座標で考える
  const inkTop = m.scaleY * m.baseline - m.inkAscent;
  const wantInkTop = -(inkHeight - m.lineHeight) / 2;
  return { scaleY: m.scaleY, shiftY: wantInkTop - inkTop };
}

/**
 * ラスタライズした█の行ごとのインク被覆率から、インク矩形の上下端を求める。
 *
 * measureTextのactualBoundingBoxAscent/Descentを使わないのは、Windows(Chromium/DirectWrite)だと
 * これがピクセルグリッドへ丸めた整数で返り、実際のインクより最大1pxほど大きく出るため。
 * インク高を過大評価すると拡大率が足りず、行の上端に隙間が残る（macOS/WebKitは小数で返るので
 * 顕在化しなかった）。端の行は部分被覆なので、被覆率から小数の端を復元する。
 *
 * @param coverage 各デバイスピクセル行のインク被覆率（0-1）
 * @param baselineY coverage内でのベースライン位置（デバイスピクセル）
 * @returns ベースライン基準のインク上下端（デバイスピクセル）。インクが無ければnull
 */
export function measureInkExtent(
  coverage: readonly number[],
  baselineY: number,
): { inkAscent: number; inkDescent: number } | null {
  // アンチエイリアスの裾やノイズを拾わない程度の下限
  const threshold = 0.03;
  let first = -1;
  let last = -1;
  for (let y = 0; y < coverage.length; y++) {
    if ((coverage[y] ?? 0) > threshold) {
      if (first < 0) first = y;
      last = y;
    }
  }
  if (first < 0) return null;
  // 端の行は内側から被覆率の分だけ埋まっているとみなす
  const top = first + (1 - Math.min(1, coverage[first] ?? 1));
  const bottom = last + Math.min(1, coverage[last] ?? 1);
  return { inkAscent: baselineY - top, inkDescent: bottom - baselineY };
}

/** 変換が実質恒等（＝DOMをラップする意味が無い）か */
export function isIdentityCellGlyphTransform(t: CellGlyphTransform): boolean {
  return Math.abs(t.scaleY - 1) < 0.001 && Math.abs(t.shiftY) < 0.05;
}
