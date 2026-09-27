import { describe, expect, test } from "bun:test";
import {
  clampPopupGeometry,
  type PopupDragMode,
  type PopupRectPx,
  resolvePopupDrag,
  toPercentGeometry,
} from "./popup-geometry";

const CONTAINER = { width: 1000, height: 500 };
const MIN = { width: 120, height: 80 };
const START: PopupRectPx = { left: 100, top: 50, width: 800, height: 400 };

function drag(mode: PopupDragMode, dx: number, dy: number, start: PopupRectPx = START) {
  return resolvePopupDrag({ mode, start, dx, dy, container: CONTAINER, min: MIN });
}

describe("resolvePopupDrag", () => {
  test("moveは位置だけ動かしサイズを変えない", () => {
    expect(drag("move", 50, 25)).toEqual({ left: 150, top: 75, width: 800, height: 400 });
  });

  test("moveで左上へ出ようとすると0で止まる", () => {
    expect(drag("move", -500, -500)).toEqual({ left: 0, top: 0, width: 800, height: 400 });
  });

  test("moveで右下へ出ようとするとコンテナの端で止まる", () => {
    expect(drag("move", 500, 500)).toEqual({ left: 200, top: 100, width: 800, height: 400 });
  });

  test("枠がコンテナより大きいときのmoveは0へ寄せる（負の上限を0へ丸める）", () => {
    const oversized: PopupRectPx = { left: 0, top: 0, width: 1200, height: 600 };
    expect(drag("move", 100, 100, oversized)).toEqual({
      left: 0,
      top: 0,
      width: 1200,
      height: 600,
    });
  });

  test("eは幅だけ伸ばし左辺を動かさない", () => {
    expect(drag("e", 60, 0)).toEqual({ left: 100, top: 50, width: 860, height: 400 });
  });

  test("eを右へ引きすぎるとコンテナの右端で頭打ちになる", () => {
    expect(drag("e", 999, 0).width).toBe(CONTAINER.width - START.left);
  });

  test("eを左へ引きすぎると最小幅で止まり左辺は動かない", () => {
    expect(drag("e", -999, 0)).toEqual({ left: 100, top: 50, width: MIN.width, height: 400 });
  });

  test("wは左辺を動かし右辺を固定する", () => {
    const result = drag("w", -60, 0);
    expect(result).toEqual({ left: 40, top: 50, width: 860, height: 400 });
    expect(result.left + result.width).toBe(START.left + START.width);
  });

  test("wを左へ引きすぎると左端で止まり、右辺は固定のまま", () => {
    const result = drag("w", -999, 0);
    expect(result.left).toBe(0);
    expect(result.left + result.width).toBe(START.left + START.width);
  });

  test("wを右へ引きすぎると最小幅で止まり、右辺は固定のまま", () => {
    const result = drag("w", 999, 0);
    expect(result.width).toBe(MIN.width);
    expect(result.left).toBe(START.left + START.width - MIN.width);
  });

  test("nは上辺を動かし下辺を固定する", () => {
    const result = drag("n", 0, -30);
    expect(result).toEqual({ left: 100, top: 20, width: 800, height: 430 });
    expect(result.top + result.height).toBe(START.top + START.height);
  });

  test("nを下へ引きすぎると最小高さで止まり、下辺は固定のまま", () => {
    const result = drag("n", 0, 999);
    expect(result.height).toBe(MIN.height);
    expect(result.top).toBe(START.top + START.height - MIN.height);
  });

  test("sを下へ引きすぎるとコンテナの下端で頭打ちになる", () => {
    expect(drag("s", 0, 999).height).toBe(CONTAINER.height - START.top);
  });

  test("seは幅と高さを同時に伸ばし左上を固定する", () => {
    expect(drag("se", 40, 20)).toEqual({ left: 100, top: 50, width: 840, height: 420 });
  });

  test("nwは左上を動かし右下の角を固定する", () => {
    const result = drag("nw", -40, -20);
    expect(result).toEqual({ left: 60, top: 30, width: 840, height: 420 });
    expect(result.left + result.width).toBe(START.left + START.width);
    expect(result.top + result.height).toBe(START.top + START.height);
  });

  test("neは上辺と右辺が動き、左下の角を固定する", () => {
    const result = drag("ne", 40, -20);
    expect(result).toEqual({ left: 100, top: 30, width: 840, height: 420 });
    expect(result.top + result.height).toBe(START.top + START.height);
  });

  test("swは左辺と下辺が動き、右上の角を固定する", () => {
    const result = drag("sw", -40, 20);
    expect(result).toEqual({ left: 60, top: 50, width: 840, height: 420 });
    expect(result.left + result.width).toBe(START.left + START.width);
  });

  test("最小サイズがコンテナより大きければコンテナまで丸める", () => {
    const result = resolvePopupDrag({
      mode: "e",
      start: START,
      dx: -999,
      dy: 0,
      container: { width: 200, height: 200 },
      min: { width: 9999, height: 9999 },
    });
    expect(result.width).toBe(200);
  });

  test("最小サイズを満たすとはみ出す位置では、最小サイズを優先する（はみ出しはclampが解消する）", () => {
    // 左辺が右端近くにあり、コンテナの残り幅が最小幅に満たないケース
    const nearRightEdge: PopupRectPx = { left: 950, top: 50, width: 50, height: 400 };
    const result = drag("e", -999, 0, nearRightEdge);
    expect(result.width).toBe(MIN.width);
    expect(result.left + result.width).toBeGreaterThan(CONTAINER.width);
  });

  test.each<PopupDragMode>(["move", "n", "s", "e", "w", "ne", "nw", "se", "sw"])(
    "%s: 移動量0なら開始時の枠と同じ",
    (mode) => {
      expect(drag(mode, 0, 0)).toEqual(START);
    },
  );
});

describe("toPercentGeometry", () => {
  test("コンテナに対する比率へ変換する", () => {
    expect(toPercentGeometry(START, CONTAINER)).toEqual({ x: 10, y: 10, width: 80, height: 80 });
  });

  test("コンテナが0でもNaN・Infinityを返さない", () => {
    const result = toPercentGeometry(START, { width: 0, height: 0 });
    expect(result).toEqual({ x: 0, y: 0, width: 100, height: 100 });
  });
});

describe("clampPopupGeometry", () => {
  test("範囲内の値はそのまま返す（送信値とbunの保存値を一致させる前提）", () => {
    const g = { x: 12.5, y: 7.25, width: 60.125, height: 42.5 };
    expect(clampPopupGeometry(g)).toEqual(g);
  });

  test("負の位置は0へ寄せる", () => {
    expect(clampPopupGeometry({ x: -10, y: -5, width: 50, height: 50 })).toMatchObject({
      x: 0,
      y: 0,
    });
  });

  test("x + widthが100を超えるとxを詰める", () => {
    expect(clampPopupGeometry({ x: 80, y: 0, width: 50, height: 50 }).x).toBe(50);
  });

  test("y + heightが100を超えるとyを詰める", () => {
    expect(clampPopupGeometry({ x: 0, y: 90, width: 50, height: 40 }).y).toBe(60);
  });

  test("100を超えるサイズは100へ丸める", () => {
    expect(clampPopupGeometry({ x: 0, y: 0, width: 150, height: 200 })).toEqual({
      x: 0,
      y: 0,
      width: 100,
      height: 100,
    });
  });

  test("0以下のサイズは最小パーセントへ丸める", () => {
    expect(clampPopupGeometry({ x: 0, y: 0, width: 0, height: -5 })).toEqual({
      x: 0,
      y: 0,
      width: 1,
      height: 1,
    });
  });

  test.each([
    ["位置の押し戻し", { x: 80, y: 90, width: 50, height: 40 }],
    ["サイズの頭打ち", { x: 0, y: 0, width: 150, height: 200 }],
    ["サイズの下限", { x: 0, y: 0, width: 0, height: -5 }],
  ])("冪等: %s を2回通しても同じ値になる", (_name, input) => {
    const once = clampPopupGeometry(input);
    expect(clampPopupGeometry(once)).toEqual(once);
  });
});
