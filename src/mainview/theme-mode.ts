// 背景色の明暗判定。appearanceのbackgroundからUI全体をライト扱いにするかダーク扱いにするかを決める。

/**
 * 背景色が明るいかどうか。
 * sRGBのガンマを戻さないBT.601の簡易輝度で判定する。閾値をまたぐかどうかしか見ないので、
 * 厳密な相対輝度まで求める必要はない
 */
export function isLightBackground(r: number, g: number, b: number): boolean {
  return (r * 299 + g * 587 + b * 114) / 1000 > 140;
}
