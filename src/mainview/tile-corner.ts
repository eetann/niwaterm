/** 角丸でなくても確保する、タイルの枠と中身の間の余白(px) */
const MIN_TILE_INSET_PX = 2;

/**
 * 角の丸みがradius(px)のタイルで、中身（タブバー・ターミナル・ブラウザのwebview）を
 * 枠の内周からどれだけ離せば角が枠に食い込まないかを返す。
 *
 * ブラウザタブのwebviewはネイティブのオーバーレイでborder-radiusのクリップが効かず、
 * 四角いまま枠の上に描かれる。そのため中身の矩形の角が、幅1pxの枠（outline）の内側の弧
 * （中心(r, r)・半径r-1）に収まるまで内側へ寄せる。
 * 角の点(p, p)と弧の中心の距離√2(r-p)がr-1以下になる最小のpを整数pxへ切り上げる
 * （小数pxの余白はセル幅の計測をにじませるため）
 */
export function tileContentInset(radius: number): number {
  const needed = Math.ceil(radius - (radius - 1) / Math.SQRT2);
  return Math.max(MIN_TILE_INSET_PX, needed);
}
