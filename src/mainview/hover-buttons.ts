// タブの表示領域の端へマウスを寄せた間だけ出すボタン（設定のhoverButtons）の表示。
// 「どのタブにどの枠を出すか」「押されたら何をするか」はbun側（ユーザー設定の関数）が持ち、
// このモジュールは帯の判定・パネルの組み立て・後片付けだけを担う（hint-mode.tsと同じ分け方）。
//
// 呼び出しの帯は要素にせず、mousemoveの座標とタブの表示領域の矩形で判定する。帯を
// pointer-events有りの要素で作ると、出ていない間もターミナルのクリック・選択・マウスレポートを
// その太さぶん奪ってしまうため（オーバーレイ表示のタブバーが同じ理由で矩形判定を採っている）。
//
// パネルは1枚だけ作り、出すタブの.tab-contentへ差し替えながら使い回す。同時に出るのは
// 高々1枚（マウスは1つ）で、.tab-content配下に置けばタブの表示/非表示・タイルのクリッピングに
// そのまま乗るため。

import type { HoverButtonPosition, ResolvedHoverButtonConfig } from "@niwaterm/config";

/** bun側のHoverButtonEntryと同じ形。RPCで運ばれてくる項目1件 */
export interface HoverButtonItemView {
  id: string;
  label: string;
  html: string;
  tooltip: string;
}

/**
 * 呼び出しの帯の太さ(px)。タブバーの呼び出し帯(4px)より気持ち太いのは、左右の辺が
 * ウィンドウ端ではなくタイル境界にあり、行き過ぎても隣のタイルへ抜けてしまうため
 */
export const HOVER_TRIGGER_PX = 6;

/** 上下の辺を左端・中央・右端の3つへ分ける比率と、左右の辺で反応させる縦方向の範囲 */
const EDGE_SEGMENT_RATIO = 1 / 3;

/**
 * マウスを離してからパネルをしまうまでの猶予(ms)。帯とパネルの間には隙間があり、
 * 即座にしまうと手を伸ばした瞬間に消える
 */
const HIDE_DELAY_MS = 180;

/**
 * タブの表示領域内のローカル座標から、どの位置の帯に入っているかを求める。
 * 四隅は上下の辺が持つ（位置の語彙がtop-left/bottom-rightのように上下側で名前を持つため）。
 * 左右の辺は縦方向の中央3分の1でだけ反応させ、角の判定と食い合わないようにする
 */
export function hoverPositionAt(
  x: number,
  y: number,
  size: { width: number; height: number },
): HoverButtonPosition | null {
  if (size.width <= 0 || size.height <= 0) return null;
  if (x < 0 || x > size.width || y < 0 || y > size.height) return null;
  const inTop = y <= HOVER_TRIGGER_PX;
  const inBottom = y >= size.height - HOVER_TRIGGER_PX;
  if (inTop || inBottom) {
    const side = inTop ? "top" : "bottom";
    const ratio = x / size.width;
    if (ratio < EDGE_SEGMENT_RATIO) return `${side}-left`;
    if (ratio > 1 - EDGE_SEGMENT_RATIO) return `${side}-right`;
    return side;
  }
  const inVerticalMiddle =
    y > size.height * EDGE_SEGMENT_RATIO && y < size.height * (1 - EDGE_SEGMENT_RATIO);
  if (!inVerticalMiddle) return null;
  if (x <= HOVER_TRIGGER_PX) return "left";
  if (x >= size.width - HOVER_TRIGGER_PX) return "right";
  return null;
}

export interface HoverButtonsOptions {
  /** 枠を開いた時に並べる項目をbunへ問い合わせる */
  fetchItems(tabId: string, buttonId: string): Promise<HoverButtonItemView[]>;
  /** 押された項目をbunへ伝える */
  runItem(tabId: string, buttonId: string, itemId: string): void;
  /** 項目を押した後にキーボードフォーカスをターミナルへ戻す */
  refocusTerminal(): void;
}

export interface HoverButtons {
  /** 設定（configメッセージ）の反映。ユーザーCSSの差し替えもここで行う */
  setConfig(buttons: ResolvedHoverButtonConfig[]): void;
  /** どのタブにどのボタンの帯を張るか（hoverButtonTabsメッセージ） */
  setActiveButtons(byTabId: Record<string, string[]>): void;
  /** mousemoveのたびに呼ぶ */
  handleMouseMove(e: MouseEvent): void;
  /** 出ているパネルをしまう（ウィンドウ外へ抜けた時・タブ切替時） */
  hide(): void;
  /**
   * CLI（`tab hover reveal`・`hide`）からの強制表示。出している間はマウスの出入りで
   * 引っ込まない。positionがnullなら解除する
   */
  pin(tabId: string, position: HoverButtonPosition | null): void;
}

/** 今どの枠を出しているか。出していなければnull */
interface RevealedState {
  tabId: string;
  position: HoverButtonPosition;
}

export function createHoverButtons(opts: HoverButtonsOptions): HoverButtons {
  const panelEl = document.createElement("div");
  panelEl.className = "hover-panel";
  const styleEl = document.createElement("style");
  document.head.appendChild(styleEl);

  let buttons: ResolvedHoverButtonConfig[] = [];
  let activeByTabId: Record<string, string[]> = {};
  let revealed: RevealedState | null = null;
  let hideTimer: ReturnType<typeof setTimeout> | null = null;
  // 問い合わせ中に別の枠へ移った・しまわれた場合に、遅れて届いた項目で開かないための世代番号
  let revealToken = 0;
  /** 項目の問い合わせ中か。この間はパネルがまだDOMに入っていない */
  let fetching = false;
  /** CLIから強制表示中か。マウスの出入りを一切見なくする */
  let pinned = false;

  panelEl.addEventListener("click", (e) => {
    const target = e.target instanceof Element ? e.target : null;
    const itemEl = target?.closest<HTMLElement>(".hover-item");
    if (!itemEl || revealed === null) return;
    const buttonId = itemEl.dataset["buttonId"];
    const itemId = itemEl.dataset["itemId"];
    if (buttonId === undefined || itemId === undefined) return;
    opts.runItem(revealed.tabId, buttonId, itemId);
    hide();
    opts.refocusTerminal();
  });

  function cancelHideTimer(): void {
    if (hideTimer === null) return;
    clearTimeout(hideTimer);
    hideTimer = null;
  }

  function hide(): void {
    pinned = false;
    fetching = false;
    cancelHideTimer();
    revealToken++;
    revealed = null;
    panelEl.replaceChildren();
    panelEl.remove();
  }

  function scheduleHide(): void {
    if (revealed === null || hideTimer !== null) return;
    hideTimer = setTimeout(hide, HIDE_DELAY_MS);
  }

  /** そのタブでその位置に出すボタン。設定に並べた順を保つ */
  function buttonsAt(tabId: string, position: HoverButtonPosition): string[] {
    const active = activeByTabId[tabId];
    if (active === undefined) return [];
    return buttons
      .filter((button) => button.position === position && active.includes(button.id))
      .map((button) => button.id);
  }

  function buildItemEl(buttonId: string, item: HoverButtonItemView): HTMLElement {
    const itemEl = document.createElement("div");
    itemEl.className = "hover-item";
    itemEl.setAttribute("role", "button");
    itemEl.dataset["buttonId"] = buttonId;
    itemEl.dataset["itemId"] = item.id;
    const tooltip = item.tooltip || item.label;
    if (tooltip) itemEl.title = tooltip;
    // htmlはユーザー設定がそのまま書いたもの。エスケープはユーザー側の責務で、
    // ここで再エスケープすると意図した装飾が出せなくなる（labelは常にテキストとして入れる）
    if (item.html) itemEl.innerHTML = item.html;
    else itemEl.textContent = item.label;
    return itemEl;
  }

  async function reveal(tabContentEl: HTMLElement, tabId: string, position: HoverButtonPosition) {
    const buttonIds = buttonsAt(tabId, position);
    if (buttonIds.length === 0) return;
    const token = ++revealToken;
    revealed = { tabId, position };
    fetching = true;
    const results = await Promise.all(
      buttonIds.map(async (buttonId) => ({
        buttonId,
        items: await opts.fetchItems(tabId, buttonId),
      })),
    );
    if (token !== revealToken) return;
    fetching = false;
    const itemEls = results.flatMap(({ buttonId, items }) =>
      items.map((item) => buildItemEl(buttonId, item)),
    );
    // 1つも項目が無いなら何も出さない。空のパネルだけが浮くとターミナルを隠すだけになる
    if (itemEls.length === 0) {
      revealed = null;
      return;
    }
    panelEl.dataset["position"] = position;
    panelEl.replaceChildren(...itemEls);
    tabContentEl.appendChild(panelEl);
  }

  function handleMouseMove(e: MouseEvent): void {
    if (pinned) return;
    const target = e.target instanceof Element ? e.target : null;
    // タブが閉じられる・レイアウトが組み直されるとパネルごとDOMから消えるため、状態も戻す。
    // 問い合わせ中はまだパネルを入れていないだけなので対象外（外すと開き直しを繰り返す）
    if (revealed !== null && !fetching && !panelEl.isConnected) revealed = null;
    if (target?.closest(".hover-panel") === panelEl && revealed !== null) {
      cancelHideTimer();
      return;
    }
    const tabContentEl = target?.closest<HTMLElement>(".tab-content");
    const tabId = tabContentEl?.dataset["tabId"];
    if (!tabContentEl || tabId === undefined || activeByTabId[tabId] === undefined) {
      scheduleHide();
      return;
    }
    // getBoundingClientRectはレイアウトを強制するため、帯を張るタブの上でだけ読む
    const rect = tabContentEl.getBoundingClientRect();
    const position = hoverPositionAt(e.clientX - rect.left, e.clientY - rect.top, rect);
    if (position === null) {
      scheduleHide();
      return;
    }
    cancelHideTimer();
    if (revealed?.tabId === tabId && revealed.position === position) return;
    // 別の枠へ移ったときは、新しい項目が届くまで前の枠を出したままにしない
    if (revealed !== null) hide();
    void reveal(tabContentEl, tabId, position);
  }

  return {
    setConfig(next) {
      buttons = next;
      styleEl.textContent = next
        .filter((button) => button.css !== "")
        .map((button) => button.css)
        .join("\n");
      hide();
    },
    setActiveButtons(byTabId) {
      activeByTabId = byTabId;
      // 出している枠が無効になった（showがfalseへ変わった）場合はしまう
      if (revealed !== null && buttonsAt(revealed.tabId, revealed.position).length === 0) hide();
    },
    handleMouseMove,
    hide,
    pin(tabId, position) {
      hide();
      if (position === null) return;
      const tabContentEl = document.querySelector<HTMLElement>(
        `.tab-content[data-tab-id="${CSS.escape(tabId)}"]`,
      );
      if (!tabContentEl) return;
      pinned = true;
      void reveal(tabContentEl, tabId, position);
    },
  };
}
