// タブのドラッグ&ドロップでタイルのどこへ落とされたかの判定。端の帯へ落とすとその方向へ分割、
// 中央へ落とすと既存タイルへのタブ移動になる。bun側の分割APIの語彙へそのまま変換できる形で返す。
import type { SplitOrientation, SplitPlacement } from "../bun/tile-layout";

export type TileDropZone = "center" | "left" | "right" | "top" | "bottom";

/** 分割になる端の帯の太さ（タイルの辺に対する比率） */
const EDGE_RATIO = 0.25;

/**
 * タイル内のドロップ位置（タイル左上を原点とするローカル座標）からドロップゾーンを求める。
 * 端の帯が重なる四隅は、辺までの距離が近い方を優先する。
 */
export function resolveTileDropZone(
  x: number,
  y: number,
  size: { width: number; height: number },
): TileDropZone {
  if (size.width <= 0 || size.height <= 0) return "center";
  const edges = [
    { zone: "left", distance: x / size.width },
    { zone: "right", distance: 1 - x / size.width },
    { zone: "top", distance: y / size.height },
    { zone: "bottom", distance: 1 - y / size.height },
  ] as const;
  const nearest = edges.reduce((a, b) => (b.distance < a.distance ? b : a));
  return nearest.distance < EDGE_RATIO ? nearest.zone : "center";
}

/** ドロップゾーンに対応する分割の向きと新タイルを置く側。分割しないcenterはnullを返す */
export function splitForDropZone(
  zone: TileDropZone,
): { orientation: SplitOrientation; placement: SplitPlacement } | null {
  switch (zone) {
    case "left":
      return { orientation: "vertical", placement: "before" };
    case "right":
      return { orientation: "vertical", placement: "after" };
    case "top":
      return { orientation: "horizontal", placement: "before" };
    case "bottom":
      return { orientation: "horizontal", placement: "after" };
    case "center":
      return null;
  }
}
