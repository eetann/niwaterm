// Kitty graphics protocolのPNGペイロード（f=100）をRGBAへ展開する。
// libghostty-vtはPNGの展開を組み込み側のコールバック（GHOSTTY_SYS_OPT_DECODE_PNG）に任せるため、
// 依存を増やさずzlibの展開だけnode:zlibへ頼って自前で解く
import { inflateSync } from "node:zlib";

export interface DecodedPng {
  width: number;
  height: number;
  /** 1ピクセル4バイトのRGBA（ストレートアルファ） */
  rgba: Uint8Array;
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** カラータイプごとの1ピクセルあたりのチャンネル数 */
const CHANNELS: Record<number, number> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };

/** Adam7インターレースの各パス: [開始x, 開始y, x間隔, y間隔] */
const ADAM7 = [
  [0, 0, 8, 8],
  [4, 0, 8, 8],
  [0, 4, 4, 8],
  [2, 0, 4, 4],
  [0, 2, 2, 4],
  [1, 0, 2, 2],
  [0, 1, 1, 2],
] as const;

/**
 * 画像1枚あたりの画素数の上限。IHDRの幅・高さは任意の値を書けるため、展開前に弾かないと
 * 悪意ある入力で巨大なバッファを確保させられる（libghostty-vt側の保存上限より先に効く）
 */
const MAX_PIXELS = 100_000_000;

/** PNGとして解釈できなければnullを返す（libghostty-vtへは失敗として伝える） */
export function decodePng(data: Uint8Array): DecodedPng | null {
  try {
    return decodePngOrThrow(data);
  } catch {
    return null;
  }
}

function decodePngOrThrow(data: Uint8Array): DecodedPng | null {
  if (data.length < 8 || PNG_SIGNATURE.some((b, i) => data[i] !== b)) return null;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);

  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  let interlace = 0;
  let palette: Uint8Array | null = null;
  let transparency: Uint8Array | null = null;
  const idat: Uint8Array[] = [];

  let pos = 8;
  while (pos + 8 <= data.length) {
    const length = view.getUint32(pos);
    const type = String.fromCharCode(...data.subarray(pos + 4, pos + 8));
    const bodyStart = pos + 8;
    const body = data.subarray(bodyStart, bodyStart + length);
    if (body.length !== length) return null;
    pos += 12 + length;
    if (type === "IHDR") {
      width = view.getUint32(bodyStart);
      height = view.getUint32(bodyStart + 4);
      bitDepth = body[8] ?? 0;
      colorType = body[9] ?? 0;
      interlace = body[12] ?? 0;
    } else if (type === "PLTE") {
      palette = body;
    } else if (type === "tRNS") {
      transparency = body;
    } else if (type === "IDAT") {
      idat.push(body);
    } else if (type === "IEND") {
      break;
    }
  }

  const channels = CHANNELS[colorType];
  if (!channels || width === 0 || height === 0 || width * height > MAX_PIXELS) return null;
  if (![1, 2, 4, 8, 16].includes(bitDepth)) return null;
  if (colorType === 3 && !palette) return null;

  const raw = new Uint8Array(inflateSync(concat(idat)));
  const bitsPerPixel = channels * bitDepth;
  // フィルタで参照する「左隣のピクセル」までのバイト距離。1バイト未満のピクセルは1とみなす
  const bpp = Math.max(1, bitsPerPixel >> 3);
  const rgba = new Uint8Array(width * height * 4);
  const ctx: PixelContext = { bitDepth, colorType, palette, transparency };

  let offset = 0;
  const passes = interlace === 1 ? ADAM7 : ([[0, 0, 1, 1]] as const);
  for (const [x0, y0, dx, dy] of passes) {
    const passWidth = Math.ceil((width - x0) / dx);
    const passHeight = Math.ceil((height - y0) / dy);
    if (passWidth <= 0 || passHeight <= 0) continue;
    const stride = Math.ceil((passWidth * bitsPerPixel) / 8);
    let prev = new Uint8Array(stride);
    for (let row = 0; row < passHeight; row++) {
      const filter = raw[offset];
      const line = raw.slice(offset + 1, offset + 1 + stride);
      if (filter === undefined || line.length !== stride) return null;
      offset += 1 + stride;
      unfilter(filter, line, prev, bpp);
      const y = y0 + row * dy;
      for (let col = 0; col < passWidth; col++) {
        writePixel(ctx, line, col, rgba, (y * width + x0 + col * dx) * 4);
      }
      prev = line;
    }
  }
  return { width, height, rgba };
}

function concat(chunks: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(chunks.reduce((sum, c) => sum + c.length, 0));
  let pos = 0;
  for (const c of chunks) {
    out.set(c, pos);
    pos += c.length;
  }
  return out;
}

function unfilter(filter: number, line: Uint8Array, prev: Uint8Array, bpp: number): void {
  for (let i = 0; i < line.length; i++) {
    const a = i >= bpp ? (line[i - bpp] ?? 0) : 0;
    const b = prev[i] ?? 0;
    const c = i >= bpp ? (prev[i - bpp] ?? 0) : 0;
    const x = line[i] ?? 0;
    switch (filter) {
      case 0:
        break;
      case 1:
        line[i] = x + a;
        break;
      case 2:
        line[i] = x + b;
        break;
      case 3:
        line[i] = x + ((a + b) >> 1);
        break;
      case 4:
        line[i] = x + paeth(a, b, c);
        break;
      default:
        throw new Error(`unknown PNG filter: ${filter}`);
    }
  }
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

interface PixelContext {
  bitDepth: number;
  colorType: number;
  palette: Uint8Array | null;
  transparency: Uint8Array | null;
}

/** 行内のn番目のサンプル値を読む。16bitは上位8bitへ、8bit未満は0-255へ伸ばす（パレット番号は除く） */
function sample(line: Uint8Array, index: number, bitDepth: number, scale: boolean): number {
  if (bitDepth === 8) return line[index] ?? 0;
  if (bitDepth === 16) return line[index * 2] ?? 0;
  const bitPos = index * bitDepth;
  const byte = line[bitPos >> 3] ?? 0;
  const value = (byte >> (8 - bitDepth - (bitPos & 7))) & ((1 << bitDepth) - 1);
  return scale ? Math.round((value * 255) / ((1 << bitDepth) - 1)) : value;
}

/** tRNSの透過色判定用に、サンプルを元のビット深度のまま読む */
function rawSample(line: Uint8Array, index: number, bitDepth: number): number {
  if (bitDepth === 16) return ((line[index * 2] ?? 0) << 8) | (line[index * 2 + 1] ?? 0);
  return sample(line, index, bitDepth, false);
}

function writePixel(
  ctx: PixelContext,
  line: Uint8Array,
  col: number,
  out: Uint8Array,
  at: number,
): void {
  const { bitDepth, colorType, palette, transparency } = ctx;
  let r: number;
  let g: number;
  let b: number;
  let a = 255;
  switch (colorType) {
    case 0: {
      r = g = b = sample(line, col, bitDepth, true);
      if (transparency && transparency.length >= 2) {
        const key = ((transparency[0] ?? 0) << 8) | (transparency[1] ?? 0);
        if (rawSample(line, col, bitDepth) === key) a = 0;
      }
      break;
    }
    case 2: {
      r = sample(line, col * 3, bitDepth, true);
      g = sample(line, col * 3 + 1, bitDepth, true);
      b = sample(line, col * 3 + 2, bitDepth, true);
      if (transparency && transparency.length >= 6) {
        const tv = new DataView(transparency.buffer, transparency.byteOffset, 6);
        if (
          rawSample(line, col * 3, bitDepth) === tv.getUint16(0) &&
          rawSample(line, col * 3 + 1, bitDepth) === tv.getUint16(2) &&
          rawSample(line, col * 3 + 2, bitDepth) === tv.getUint16(4)
        ) {
          a = 0;
        }
      }
      break;
    }
    case 3: {
      const index = sample(line, col, bitDepth, false);
      r = palette?.[index * 3] ?? 0;
      g = palette?.[index * 3 + 1] ?? 0;
      b = palette?.[index * 3 + 2] ?? 0;
      a = transparency?.[index] ?? 255;
      break;
    }
    case 4: {
      r = g = b = sample(line, col * 2, bitDepth, true);
      a = sample(line, col * 2 + 1, bitDepth, true);
      break;
    }
    default: {
      r = sample(line, col * 4, bitDepth, true);
      g = sample(line, col * 4 + 1, bitDepth, true);
      b = sample(line, col * 4 + 2, bitDepth, true);
      a = sample(line, col * 4 + 3, bitDepth, true);
    }
  }
  out[at] = r;
  out[at + 1] = g;
  out[at + 2] = b;
  out[at + 3] = a;
}
