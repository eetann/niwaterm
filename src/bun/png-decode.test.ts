import { describe, expect, test } from "bun:test";
import { deflateSync } from "node:zlib";
import { decodePng } from "./png-decode";

function chunk(type: string, body: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + body.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, body.length);
  out.set(new TextEncoder().encode(type), 4);
  out.set(body, 8);
  // デコーダはCRCを検証しないので0のままでよい
  return out;
}

function ihdr(
  width: number,
  height: number,
  bitDepth: number,
  colorType: number,
  interlace = 0,
): Uint8Array {
  const body = new Uint8Array(13);
  const view = new DataView(body.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  body[8] = bitDepth;
  body[9] = colorType;
  body[12] = interlace;
  return chunk("IHDR", body);
}

/** フィルタ種別のバイトを先頭に付けた行を連結したものをIDATとして詰めたPNGを作る */
function png(header: Uint8Array, scanlines: number[][], extra: Uint8Array[] = []): Uint8Array {
  const raw = new Uint8Array(scanlines.flat());
  const parts = [
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    header,
    ...extra,
    chunk("IDAT", new Uint8Array(deflateSync(raw))),
    chunk("IEND", new Uint8Array(0)),
  ];
  const out = new Uint8Array(parts.reduce((sum, p) => sum + p.length, 0));
  let pos = 0;
  for (const p of parts) {
    out.set(p, pos);
    pos += p.length;
  }
  return out;
}

describe("decodePng", () => {
  test("8bit RGBAをそのまま展開する", () => {
    const data = png(ihdr(2, 1, 8, 6), [[0, 255, 0, 0, 255, 0, 0, 255, 128]]);
    expect(decodePng(data)).toEqual({
      width: 2,
      height: 1,
      rgba: new Uint8Array([255, 0, 0, 255, 0, 0, 255, 128]),
    });
  });

  test("Sub/Up/Average/Paethフィルタを戻す", () => {
    // 2x4のRGB。各行を異なるフィルタで符号化する（元の画素は全行とも[10,20,30, 40,50,60]）
    const data = png(ihdr(2, 4, 8, 2), [
      [1, 10, 20, 30, 30, 30, 30],
      [2, 0, 0, 0, 0, 0, 0],
      [3, 5, 10, 15, 15, 15, 15],
      [4, 0, 0, 0, 0, 0, 0],
    ]);
    const decoded = decodePng(data);
    const row = [10, 20, 30, 255, 40, 50, 60, 255];
    expect(decoded?.rgba).toEqual(new Uint8Array([...row, ...row, ...row, ...row]));
  });

  test("4bitパレットとtRNSのアルファを反映する", () => {
    const palette = chunk("PLTE", new Uint8Array([0, 0, 0, 255, 255, 255]));
    const trns = chunk("tRNS", new Uint8Array([0]));
    // 1行3ピクセル: パレット番号 1, 0, 1 → 0x10, 0x10（下位ニブルの余りは捨てる）
    const data = png(ihdr(3, 1, 4, 3), [[0, 0x10, 0x10]], [palette, trns]);
    expect(decodePng(data)?.rgba).toEqual(
      new Uint8Array([255, 255, 255, 255, 0, 0, 0, 0, 255, 255, 255, 255]),
    );
  });

  test("16bitグレースケールは上位8bitを使う", () => {
    const data = png(ihdr(2, 1, 16, 0), [[0, 0x12, 0x34, 0xff, 0xff]]);
    expect(decodePng(data)?.rgba).toEqual(new Uint8Array([18, 18, 18, 255, 255, 255, 255, 255]));
  });

  test("1bitグレースケールを0/255へ伸ばす", () => {
    const data = png(ihdr(3, 1, 1, 0), [[0, 0b1010_0000]]);
    expect(decodePng(data)?.rgba).toEqual(
      new Uint8Array([255, 255, 255, 255, 0, 0, 0, 255, 255, 255, 255, 255]),
    );
  });

  test("Adam7インターレースを元の位置へ並べ直す", () => {
    // 2x2のグレースケール。パス1=(0,0) パス6=(1,0) パス7=(0,1),(1,1)。パス2〜5は空
    const data = png(ihdr(2, 2, 8, 0, 1), [
      [0, 1],
      [0, 2],
      [0, 3, 4],
    ]);
    const decoded = decodePng(data);
    expect([...(decoded?.rgba ?? [])].filter((_, i) => i % 4 === 0)).toEqual([1, 2, 3, 4]);
  });

  test("PNGでなければnullを返す", () => {
    expect(decodePng(new Uint8Array([1, 2, 3]))).toBeNull();
    expect(decodePng(png(ihdr(2, 1, 8, 6), [[0, 1]]))).toBeNull();
  });
});
