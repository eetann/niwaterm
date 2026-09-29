// React外の素DOM要素（ステータスバー・ホバーボタン）のツールチップ。要素側は`data-tooltip`属性に
// 本文を書くだけにして、表示はreact/dom-tooltip.tsxの共有ツールチップ1つが受け持つ

/** 値がそのままツールチップの本文になる属性 */
export const DOM_TOOLTIP_ATTR = "data-tooltip";

export interface DomTooltipState {
  open: boolean;
  /** ホバー中の要素の矩形（ビューポート座標）。閉じるアニメーション中も直前の値を保つ */
  rect: DOMRect | null;
  text: string;
}

/**
 * `data-tooltip`を持つ要素へのホバーを文書全体で拾い、表示状態をrenderへ渡す。
 * 本文はホバーした時点の属性値を読むため、要素側は値が変わるたびに属性を書き換えるだけでよい
 */
export function installDomTooltip(render: (state: DomTooltipState) => void): void {
  let current: HTMLElement | null = null;
  let last: DomTooltipState = { open: false, rect: null, text: "" };

  const hide = () => {
    if (current === null) return;
    current = null;
    last = { ...last, open: false };
    render(last);
  };

  document.addEventListener("pointerover", (e) => {
    const target = (e.target as Element | null)?.closest<HTMLElement>(`[${DOM_TOOLTIP_ATTR}]`);
    const text = target?.getAttribute(DOM_TOOLTIP_ATTR) ?? "";
    if (!target || text === "") {
      hide();
      return;
    }
    if (target === current) return;
    current = target;
    last = { open: true, rect: target.getBoundingClientRect(), text };
    render(last);
  });
  // ネイティブのtitleと同じく、押したら消す（押した結果で要素の位置・中身が変わりうるため）
  document.addEventListener("pointerdown", hide, true);
  document.documentElement.addEventListener("pointerleave", hide);
}
