// Kitty graphics protocolの画像を.termの上下に重ねたレイヤへ描く。
// 画像の解釈・保持・配置計算はbun側（libghostty-vt）で済んでおり、ここは届いた配置どおりに置くだけ
import type { KittyPlacement } from "../bun/ghostty";
import type { TerminalRenderState } from "../bun/terminal-session";

type KittyImageMessage = TerminalRenderState["kittyImages"][number];

/** 画像の世代番号 → 全体を描いたcanvas。配置ごとのcanvasはここから切り出して描く */
const imageCanvasByKey = new Map<string, HTMLCanvasElement>();
/** 今回の描画で参照された画像。pruneKittyImages()でこれ以外をキャッシュから捨てる */
const referencedKeys = new Set<string>();

interface KittyLayers {
  /** 文字より奥（z < 0）。.termより前に置き、.termをposition:relativeにして文字の下へ潜らせる */
  below: HTMLDivElement;
  /** 文字より手前（z >= 0） */
  above: HTMLDivElement;
}

const layersByTermEl = new WeakMap<HTMLElement, KittyLayers>();

function decodeBase64(base64: string): Uint8Array {
  const fromBase64 = (Uint8Array as unknown as { fromBase64?: (s: string) => Uint8Array })
    .fromBase64;
  if (fromBase64) return fromBase64(base64);
  const binary = atob(base64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

function storeImage(image: KittyImageMessage): void {
  if (image.rgbaBase64 === null || imageCanvasByKey.has(image.key)) return;
  if (image.width <= 0 || image.height <= 0) return;
  const canvas = document.createElement("canvas");
  canvas.width = image.width;
  canvas.height = image.height;
  const pixels = decodeBase64(image.rgbaBase64);
  if (pixels.length !== image.width * image.height * 4) return;
  canvas
    .getContext("2d")
    ?.putImageData(
      new ImageData(new Uint8ClampedArray(pixels.buffer as ArrayBuffer), image.width, image.height),
      0,
      0,
    );
  imageCanvasByKey.set(image.key, canvas);
}

/** 配置の描画矩形（.termの左上基準のCSSピクセル） */
export interface PlacementRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * bun側の配置をwebview上の矩形へ直す。libghostty-vtへ渡すセル寸法は整数へ丸めているため、
 * 寸法・オフセットは実測のセル寸法との比で伸縮させ、文字のグリッドと揃える
 */
export function placementRect(
  placement: KittyPlacement,
  cellWidth: number,
  cellHeight: number,
): PlacementRect {
  const scaleX = cellWidth / Math.max(1, Math.round(cellWidth));
  const scaleY = cellHeight / Math.max(1, Math.round(cellHeight));
  return {
    left: placement.col * cellWidth + placement.xOffset * scaleX,
    top: placement.row * cellHeight + placement.yOffset * scaleY,
    width: placement.width * scaleX,
    height: placement.height * scaleY,
  };
}

function ensureLayers(termEl: HTMLElement): KittyLayers | null {
  const existing = layersByTermEl.get(termEl);
  if (existing) return existing;
  const parent = termEl.parentElement;
  if (!parent) return null;
  const below = document.createElement("div");
  below.className = "kitty-layer";
  const above = document.createElement("div");
  above.className = "kitty-layer";
  parent.insertBefore(below, termEl);
  termEl.after(above);
  const layers = { below, above };
  layersByTermEl.set(termEl, layers);
  return layers;
}

/** 配置1件ぶんのcanvas。同じ画像・同じ切り出し範囲なら描き直さず位置だけ動かす */
function placementSignature(p: KittyPlacement): string {
  return `${p.imageKey}:${p.sourceX},${p.sourceY},${p.sourceWidth},${p.sourceHeight}`;
}

function syncLayer(
  layer: HTMLDivElement,
  placements: KittyPlacement[],
  cellWidth: number,
  cellHeight: number,
): void {
  const reusable = new Map<string, HTMLCanvasElement[]>();
  for (const child of Array.from(layer.children) as HTMLCanvasElement[]) {
    const sig = child.dataset["sig"] ?? "";
    reusable.set(sig, [...(reusable.get(sig) ?? []), child]);
  }
  const next: HTMLCanvasElement[] = [];
  // 同じレイヤ内はzの小さい順に重ねる（後に置いた要素が手前に描かれる）
  for (const placement of [...placements].sort((a, b) => a.z - b.z)) {
    const source = imageCanvasByKey.get(placement.imageKey);
    if (!source || placement.sourceWidth <= 0 || placement.sourceHeight <= 0) continue;
    const sig = placementSignature(placement);
    let canvas = reusable.get(sig)?.shift();
    if (!canvas) {
      canvas = document.createElement("canvas");
      canvas.dataset["sig"] = sig;
      canvas.width = placement.sourceWidth;
      canvas.height = placement.sourceHeight;
      canvas
        .getContext("2d")
        ?.drawImage(
          source,
          placement.sourceX,
          placement.sourceY,
          placement.sourceWidth,
          placement.sourceHeight,
          0,
          0,
          placement.sourceWidth,
          placement.sourceHeight,
        );
    }
    const rect = placementRect(placement, cellWidth, cellHeight);
    canvas.style.left = `${rect.left}px`;
    canvas.style.top = `${rect.top}px`;
    canvas.style.width = `${rect.width}px`;
    canvas.style.height = `${rect.height}px`;
    next.push(canvas);
  }
  layer.replaceChildren(...next);
}

/** 1タブぶんの画像を受け取り、今回の描画で参照された画像として記録する */
export function storeKittyImages(images: KittyImageMessage[]): void {
  for (const image of images) {
    storeImage(image);
    referencedKeys.add(image.key);
  }
}

/**
 * 1タブぶんの配置を描く。先にstoreKittyImagesで画像を受け取っておくこと。
 * 配置が無く、レイヤもまだ無いタブ（大半のタブ）では何もしない
 */
export function applyKittyGraphics(
  termEl: HTMLElement,
  placements: KittyPlacement[],
  cellWidth: number,
  cellHeight: number,
): void {
  if (placements.length === 0 && !layersByTermEl.has(termEl)) return;
  const layers = ensureLayers(termEl);
  if (!layers) return;
  syncLayer(
    layers.below,
    placements.filter((p) => p.z < 0),
    cellWidth,
    cellHeight,
  );
  syncLayer(
    layers.above,
    placements.filter((p) => p.z >= 0),
    cellWidth,
    cellHeight,
  );
}

/** ポップアップのように.termを別のタブへ使い回すとき、前のタブの画像を消す */
export function clearKittyGraphics(termEl: HTMLElement): void {
  const layers = layersByTermEl.get(termEl);
  if (!layers) return;
  layers.below.replaceChildren();
  layers.above.replaceChildren();
}

/**
 * 1回の描画（全タブぶんのapplyKittyGraphics）の後に呼び、参照されなくなった画像を捨てる。
 * bun側（index.tsのdropSentKittyImages）も同じ範囲だけを送信済みとみなすので、
 * 捨てた画像は再び映るときに画素付きで届く
 */
export function pruneKittyImages(): void {
  for (const key of imageCanvasByKey.keys()) {
    if (!referencedKeys.has(key)) imageCanvasByKey.delete(key);
  }
  referencedKeys.clear();
}
