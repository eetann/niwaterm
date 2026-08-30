import { describe, expect, test } from "bun:test";
import {
  domMouseButton,
  MAX_WHEEL_REPORTS_PER_EVENT,
  mouseModsFromEvent,
  wheelReport,
} from "./mouse";

describe("domMouseButton", () => {
  test("左・中・右を対応付ける", () => {
    expect(domMouseButton(0)).toBe("left");
    expect(domMouseButton(1)).toBe("middle");
    expect(domMouseButton(2)).toBe("right");
  });

  test("割り当ての無いボタン（戻る/進む等）はnull", () => {
    expect(domMouseButton(3)).toBeNull();
    expect(domMouseButton(4)).toBeNull();
  });
});

describe("mouseModsFromEvent", () => {
  test("metaKeyはsuperへ写す", () => {
    expect(
      mouseModsFromEvent({ shiftKey: true, ctrlKey: false, altKey: true, metaKey: true }),
    ).toEqual({ shift: true, ctrl: false, alt: true, super: true });
  });
});

describe("wheelReport", () => {
  test("下・上スクロールをホイールボタンへ写す", () => {
    expect(wheelReport(3, "vertical")).toEqual({ button: "wheelDown", count: 3 });
    expect(wheelReport(-2, "vertical")).toEqual({ button: "wheelUp", count: 2 });
  });

  test("横スクロールも同様に扱う", () => {
    expect(wheelReport(1, "horizontal")).toEqual({ button: "wheelRight", count: 1 });
    expect(wheelReport(-1, "horizontal")).toEqual({ button: "wheelLeft", count: 1 });
  });

  test("0や非数はnull", () => {
    expect(wheelReport(0, "vertical")).toBeNull();
    expect(wheelReport(Number.NaN, "vertical")).toBeNull();
  });

  test("慣性スクロールの大きなdeltaは上限で頭打ちにする", () => {
    expect(wheelReport(999, "vertical")).toEqual({
      button: "wheelDown",
      count: MAX_WHEEL_REPORTS_PER_EVENT,
    });
  });
});
