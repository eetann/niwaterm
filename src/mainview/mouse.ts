// DOMのマウスイベントを、bun側のマウスレポート（TUIアプリへの転送）用の値へ写す純粋関数群。
// 実際の送信・状態管理はindex.ts側が持つ。
import type { MouseButton, MouseMods } from "../bun/ghostty";

/**
 * 1回のホイールイベントで送るマウスレポートの上限。
 * トラックパッドの慣性スクロールで大量のdeltaが一度に届いた場合に、
 * アプリ側へ数十行分のホイール押下を投げ込まないよう頭打ちにする
 */
export const MAX_WHEEL_REPORTS_PER_EVENT = 10;

/**
 * DOMのMouseEvent.buttonをlibghostty-vtのボタン名へ対応付ける。
 * 3以降（戻る/進む等）はターミナルのマウスレポートに割り当てが無いためnullを返す
 */
export function domMouseButton(button: number): MouseButton | null {
  switch (button) {
    case 0:
      return "left";
    case 1:
      return "middle";
    case 2:
      return "right";
    default:
      return null;
  }
}

export function mouseModsFromEvent(e: {
  shiftKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  metaKey: boolean;
}): MouseMods {
  return { shift: e.shiftKey, ctrl: e.ctrlKey, alt: e.altKey, super: e.metaKey };
}

/**
 * ホイールの移動量（セル数。下・右が正）から、送るべきホイールボタンと回数を求める。
 * ホイールはX11由来の割り当て（上=4, 下=5, 左=6, 右=7）でボタン押下として報告する
 */
export function wheelReport(
  cells: number,
  axis: "vertical" | "horizontal",
): { button: MouseButton; count: number } | null {
  if (!Number.isFinite(cells) || cells === 0) return null;
  const count = Math.min(Math.abs(Math.trunc(cells)), MAX_WHEEL_REPORTS_PER_EVENT);
  if (count === 0) return null;
  const button: MouseButton =
    axis === "vertical"
      ? cells < 0
        ? "wheelUp"
        : "wheelDown"
      : cells < 0
        ? "wheelLeft"
        : "wheelRight";
  return { button, count };
}
