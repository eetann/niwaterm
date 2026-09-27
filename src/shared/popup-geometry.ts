// ポップアップ枠（#popup-box）のD&Dによる移動・リサイズの幾何計算。
// bun側（状態の保存前のクランプ）とmainview側（ドラッグ中の追従）の両方から使う。
// 同じclampPopupGeometryを通すことで「webviewが送った値＝bunが保存する値」になり、
// ドラッグ確定後のエコー待ち（pendingPopupGeometry）の一致判定が外れない。

/** ウィンドウ（#popupの枠）に対するパーセントで表したポップアップ枠。x/yは左上角 */
export interface PopupGeometry {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** コンテナ左上を原点としたpx矩形 */
export interface PopupRectPx {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** 掴んだハンドル。方角はOSのウィンドウと同じで「その辺・角だけが動き、反対側は固定」 */
export type PopupDragMode = "move" | "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

export interface PopupDragInput {
  mode: PopupDragMode;
  /** pointerdown時点の枠 */
  start: PopupRectPx;
  /** pointerdownからのポインタ移動量 */
  dx: number;
  dy: number;
  /** コンテナ（ウィンドウ）の内寸 */
  container: { width: number; height: number };
  /** 最小サイズ。コンテナより大きい値を渡した場合はコンテナまで縮めて扱う */
  min: { width: number; height: number };
}

type HorizontalEdge = "none" | "west" | "east";
type VerticalEdge = "none" | "north" | "south";

// modeからどの辺が動くかのテーブル。mode.includes("e")のような文字列判定だと
// "e"（東）と"ne"/"se"の判定は通るが"w"を含む文字列には反応しない、といった
// 取り違えが起きやすいので明示的に持つ
const EDGES: Record<PopupDragMode, { h: HorizontalEdge; v: VerticalEdge }> = {
  move: { h: "none", v: "none" },
  n: { h: "none", v: "north" },
  s: { h: "none", v: "south" },
  w: { h: "west", v: "none" },
  e: { h: "east", v: "none" },
  nw: { h: "west", v: "north" },
  ne: { h: "east", v: "north" },
  sw: { h: "west", v: "south" },
  se: { h: "east", v: "south" },
};

function clamp(value: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, value));
}

/** 1軸ぶんの計算。horizontal/verticalで式が同型なので共通化する */
function resolveAxis(
  edge: HorizontalEdge | VerticalEdge,
  startOffset: number,
  startSize: number,
  delta: number,
  containerSize: number,
  minSize: number,
): { offset: number; size: number } {
  // コンテナより大きい最小サイズは満たしようがないのでコンテナまで丸める
  const min = Math.max(0, Math.min(minSize, containerSize));
  if (edge === "none") {
    // 移動。サイズは変えず、コンテナ内へ収める（枠がコンテナより大きい場合は0へ寄せる）
    const max = Math.max(0, containerSize - startSize);
    return { offset: clamp(startOffset + delta, 0, max), size: startSize };
  }
  if (edge === "east" || edge === "south") {
    // 手前側の辺は固定。伸ばせる上限はコンテナの端まで
    const max = Math.max(min, containerSize - startOffset);
    return { offset: startOffset, size: clamp(startSize + delta, min, max) };
  }
  // west/north。奥側の辺（right/bottom）を固定したまま手前の辺を動かす
  const far = startOffset + startSize;
  const offset = clamp(startOffset + delta, 0, Math.max(0, far - min));
  return { offset, size: Math.max(min, far - offset) };
}

/**
 * ドラッグ後の枠をpxで求める。最小サイズはここで効かせる（ウィンドウ実寸を知っているのは
 * webview側だけなので、px域のクランプはこの関数の責務）。
 * 「最小サイズを満たすとコンテナからはみ出す」という両立しない状況では最小サイズを優先し、
 * はみ出しの解消はclampPopupGeometry側に任せる
 */
export function resolvePopupDrag(input: PopupDragInput): PopupRectPx {
  const edges = EDGES[input.mode];
  const horizontal = resolveAxis(
    edges.h,
    input.start.left,
    input.start.width,
    input.dx,
    input.container.width,
    input.min.width,
  );
  const vertical = resolveAxis(
    edges.v,
    input.start.top,
    input.start.height,
    input.dy,
    input.container.height,
    input.min.height,
  );
  return {
    left: horizontal.offset,
    top: vertical.offset,
    width: horizontal.size,
    height: vertical.size,
  };
}

/** px矩形をコンテナに対するパーセントへ変換する。コンテナが0でもNaNを外へ出さない */
export function toPercentGeometry(
  rect: PopupRectPx,
  container: { width: number; height: number },
): PopupGeometry {
  const toPercent = (value: number, total: number, fallback: number): number =>
    total > 0 ? (value / total) * 100 : fallback;
  return {
    x: toPercent(rect.left, container.width, 0),
    y: toPercent(rect.top, container.height, 0),
    width: toPercent(rect.width, container.width, 100),
    height: toPercent(rect.height, container.height, 100),
  };
}

/** パーセント域の最小サイズ。これを下回ると枠が見えなくなる */
const MIN_PERCENT = 1;

/**
 * パーセント域のクランプ。0〜100に収め、x + width <= 100（縦も同様）を保証する。
 * この不変条件さえ守っておけば、ウィンドウをどうリサイズしても枠が画面外へ出ない。
 * 冪等（clamp(clamp(g))とclamp(g)が一致する）であることがエコー待ちの一致判定の前提
 */
export function clampPopupGeometry(g: PopupGeometry): PopupGeometry {
  // サイズを先に確定させてから位置をその残り幅へ収める。この順序だと冪等になる
  const width = clamp(g.width, MIN_PERCENT, 100);
  const height = clamp(g.height, MIN_PERCENT, 100);
  return {
    x: clamp(g.x, 0, 100 - width),
    y: clamp(g.y, 0, 100 - height),
    width,
    height,
  };
}
