// タブの表示領域の端に置くボタン（設定のhoverButtons）の表示。
// 「どのタブにどの枠を出すか」「押されたら何をするか」はbun側（ユーザー設定の関数）が持ち、
// このモジュールは取っ手・帯の判定・パネルの組み立て・後片付けだけを担う（hint-mode.tsと同じ分け方）。
//
// 枠の開き方は2通りある。取っ手（handleを持つ枠）は常に出しておく要素で、押すと開き、
// もう一度押す・外を押す・Escで閉じる。取っ手を持たない枠（handle: false）は端の帯へ
// マウスを寄せた間だけ開く。同じ位置に両方が混ざっていても、それぞれの開き方で開いた時は
// その開き方の枠だけを並べる。
//
// 呼び出しの帯は要素にせず、mousemoveの座標とタブの表示領域の矩形で判定する。帯を
// pointer-events有りの要素で作ると、出ていない間もターミナルのクリック・選択・マウスレポートを
// その太さぶん奪ってしまうため（オーバーレイ表示のタブバーが同じ理由で矩形判定を採っている）。
//
// パネルは1枚だけ作り、出すタブの.tab-contentへ差し替えながら使い回す。同時に出るのは
// 高々1枚（マウスは1つ）で、.tab-content配下に置けばタブの表示/非表示・タイルのクリッピングに
// そのまま乗るため。

import type {
  HoverButtonPosition,
  ResolvedHoverButtonConfig,
  ResolvedHoverButtonHandle,
} from "@niwaterm/config";

/** bun側のHoverButtonEntryと同じ形。RPCで運ばれてくる項目1件 */
export interface HoverButtonItemView {
  id: string;
  label: string;
  html: string;
  tooltip: string;
}

/** 上下の辺を左端・中央・右端の3つへ分ける比率 */
const EDGE_SEGMENT_RATIO = 1 / 3;

/** 左右の辺が反応しない上下の余白の比率。四隅を持つ上下の辺と食い合わないために空ける */
const SIDE_EDGE_MARGIN_RATIO = 1 / 4;

/**
 * マウスを離してからパネルをしまうまでの猶予(ms)。帯とパネルの間には隙間があり、
 * 即座にしまうと手を伸ばした瞬間に消える
 */
const HIDE_DELAY_MS = 180;

/**
 * タブの表示領域内のローカル座標から、太さtriggerPxの帯のどれに入っているかを求める。
 * 四隅は上下の辺が持つ（位置の語彙がtop-left/bottom-rightのように上下側で名前を持つため）。
 * 左右の辺は縦方向の中央半分でだけ反応させ、角の判定と食い合わないようにする
 */
export function hoverPositionAt(
  x: number,
  y: number,
  size: { width: number; height: number },
  triggerPx: number,
): HoverButtonPosition | null {
  if (size.width <= 0 || size.height <= 0) return null;
  if (x < 0 || x > size.width || y < 0 || y > size.height) return null;
  const inTop = y <= triggerPx;
  const inBottom = y >= size.height - triggerPx;
  if (inTop || inBottom) {
    const side = inTop ? "top" : "bottom";
    const ratio = x / size.width;
    if (ratio < EDGE_SEGMENT_RATIO) return `${side}-left`;
    if (ratio > 1 - EDGE_SEGMENT_RATIO) return `${side}-right`;
    return side;
  }
  const inVerticalMiddle =
    y > size.height * SIDE_EDGE_MARGIN_RATIO && y < size.height * (1 - SIDE_EDGE_MARGIN_RATIO);
  if (!inVerticalMiddle) return null;
  if (x <= triggerPx) return "left";
  if (x >= size.width - triggerPx) return "right";
  return null;
}

export interface HoverButtonsOptions {
  /** 枠を開いた時に並べる項目をbunへ問い合わせる */
  fetchItems(tabId: string, buttonId: string): Promise<HoverButtonItemView[]>;
  /** 押された項目をbunへ伝える */
  runItem(tabId: string, buttonId: string, itemId: string): void;
  /** 項目を押した後にキーボードフォーカスをターミナルへ戻す */
  refocusTerminal(): void;
  /**
   * タブの.tab-content。documentから引かないのは、タブの要素を作った直後はタイルごと
   * まだdocumentへ入っていないことがあるため
   */
  tabContentOf(tabId: string): HTMLElement | undefined;
}

export interface HoverButtons {
  /** 設定（configメッセージ）の反映。ユーザーCSSの差し替えもここで行う */
  setConfig(buttons: ResolvedHoverButtonConfig[]): void;
  /** どのタブにどのボタンの帯を張るか（hoverButtonTabsメッセージ） */
  setActiveButtons(byTabId: Record<string, string[]>): void;
  /** mousemoveのたびに呼ぶ */
  handleMouseMove(e: MouseEvent): void;
  /** 出ているパネルをしまう */
  hide(): void;
  /** ウィンドウの外へマウスが抜けた時に呼ぶ。取っ手・CLIで開いたパネルは残す */
  handleMouseLeave(): void;
  /**
   * 取っ手を置き直す。タブの.tab-contentが後から作られた場合に備え、タブの要素を作った後にも呼ぶ
   */
  syncHandles(): void;
  /**
   * CLI（`tab hover reveal`・`hide`）からの強制表示。出している間はマウスの出入りで
   * 引っ込まない。positionがnullなら解除する
   */
  pin(tabId: string, position: HoverButtonPosition | null): void;
}

/**
 * 開いた経路。どの枠を並べるかがこれで決まる（hover: 取っ手なしの枠、handle: 取っ手ありの枠、
 * cli: 両方）
 */
type RevealSource = "hover" | "handle" | "cli";

/** 今どの枠を出しているか。出していなければnull */
interface RevealedState {
  tabId: string;
  position: HoverButtonPosition;
  source: RevealSource;
}

function matchesSource(button: ResolvedHoverButtonConfig, source: RevealSource): boolean {
  if (source === "cli") return true;
  return (button.handle !== null) === (source === "handle");
}

export function createHoverButtons(opts: HoverButtonsOptions): HoverButtons {
  const panelEl = document.createElement("div");
  panelEl.className = "hover-panel";
  const styleEl = document.createElement("style");
  document.head.appendChild(styleEl);
  /** tabId → 位置 → 取っ手の要素 */
  const handlesByTab = new Map<string, Map<HoverButtonPosition, HTMLElement>>();

  let buttons: ResolvedHoverButtonConfig[] = [];
  let activeByTabId: Record<string, string[]> = {};
  let revealed: RevealedState | null = null;
  let hideTimer: ReturnType<typeof setTimeout> | null = null;
  // 問い合わせ中に別の枠へ移った・しまわれた場合に、遅れて届いた項目で開かないための世代番号
  let revealToken = 0;
  /** 項目の問い合わせ中か。この間はパネルがまだDOMに入っていない */
  let fetching = false;
  /** 取っ手・CLIから開いているか。マウスの出入りを一切見なくする */
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
    if (revealed !== null) {
      handlesByTab.get(revealed.tabId)?.get(revealed.position)?.removeAttribute("data-open");
    }
    pinned = false;
    fetching = false;
    cancelHideTimer();
    revealToken++;
    revealed = null;
    panelEl.replaceChildren();
    panelEl.remove();
    panelEl.style.removeProperty("--hover-handle-gap");
  }

  function scheduleHide(): void {
    if (revealed === null || hideTimer !== null) return;
    hideTimer = setTimeout(hide, HIDE_DELAY_MS);
  }

  /**
   * そのタブで有効な枠のうち、今マウスが帯に入っているものの位置。帯の太さは枠ごとに
   * 違いうるので、太い枠から順に見る（細い枠の帯は太い枠の帯に含まれる）
   */
  function hoverPositionFor(
    tabId: string,
    x: number,
    y: number,
    size: { width: number; height: number },
  ): HoverButtonPosition | null {
    const active = activeByTabId[tabId];
    if (active === undefined) return null;
    const candidates = buttons
      .filter((button) => button.handle === null && active.includes(button.id))
      .sort((a, b) => b.trigger - a.trigger);
    for (const button of candidates) {
      if (hoverPositionAt(x, y, size, button.trigger) === button.position) return button.position;
    }
    return null;
  }

  /** そのタブでその位置に、その経路で開いた時に出すボタン。設定に並べた順を保つ */
  function buttonsAt(
    tabId: string,
    position: HoverButtonPosition,
    source: RevealSource,
  ): ResolvedHoverButtonConfig[] {
    const active = activeByTabId[tabId];
    if (active === undefined) return [];
    return buttons.filter(
      (button) =>
        button.position === position && active.includes(button.id) && matchesSource(button, source),
    );
  }

  /**
   * 取っ手のある位置でパネルを開く時に、取っ手と重ならないよう端からずらす量をCSS変数で渡す。
   * ユーザーCSSで取っ手の大きさ・位置を変えても追従できるよう、実際の矩形から測る
   */
  function applyHandleGap(tabContentEl: HTMLElement, tabId: string, position: HoverButtonPosition) {
    const handleEl = handlesByTab.get(tabId)?.get(position);
    if (!handleEl?.isConnected) return;
    const tabRect = tabContentEl.getBoundingClientRect();
    const handleRect = handleEl.getBoundingClientRect();
    let gap: number;
    if (position === "left") gap = handleRect.right - tabRect.left;
    else if (position === "right") gap = tabRect.right - handleRect.left;
    else if (position.startsWith("top")) gap = handleRect.bottom - tabRect.top;
    else gap = tabRect.bottom - handleRect.top;
    panelEl.style.setProperty("--hover-handle-gap", `${Math.max(0, Math.round(gap))}px`);
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

  async function reveal(
    tabContentEl: HTMLElement,
    tabId: string,
    position: HoverButtonPosition,
    source: RevealSource,
  ) {
    const buttonIds = buttonsAt(tabId, position, source).map((button) => button.id);
    if (buttonIds.length === 0) return;
    const token = ++revealToken;
    revealed = { tabId, position, source };
    fetching = true;
    handlesByTab.get(tabId)?.get(position)?.setAttribute("data-open", "");
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
      hide();
      return;
    }
    panelEl.dataset["position"] = position;
    panelEl.replaceChildren(...itemEls);
    tabContentEl.appendChild(panelEl);
    applyHandleGap(tabContentEl, tabId, position);
  }

  function toggleFromHandle(tabId: string, position: HoverButtonPosition): void {
    const isOpenHere =
      revealed?.tabId === tabId && revealed.position === position && revealed.source === "handle";
    hide();
    if (isOpenHere) {
      opts.refocusTerminal();
      return;
    }
    const tabContentEl = opts.tabContentOf(tabId);
    if (!tabContentEl) return;
    pinned = true;
    void reveal(tabContentEl, tabId, position, "handle");
  }

  function buildHandleEl(tabId: string, position: HoverButtonPosition): HTMLElement {
    const handleEl = document.createElement("div");
    handleEl.className = "hover-handle";
    handleEl.setAttribute("role", "button");
    handleEl.dataset["position"] = position;
    // 押した瞬間にターミナルからフォーカスを奪わない（閉じた後にそのまま打ち続けられるように）
    handleEl.addEventListener("mousedown", (e) => {
      e.preventDefault();
      e.stopPropagation();
    });
    handleEl.addEventListener("click", (e) => {
      e.stopPropagation();
      toggleFromHandle(tabId, position);
    });
    return handleEl;
  }

  /**
   * 取っ手の見た目を設定から写す。同じ位置に取っ手ありの枠が複数あれば、設定で先に並べた枠の
   * 取っ手を代表にする（開けば全部が並ぶので、取っ手は位置ごとに1つで足りる）
   */
  function applyHandleLook(
    handleEl: HTMLElement,
    owner: ResolvedHoverButtonConfig,
    handle: ResolvedHoverButtonHandle,
  ): void {
    handleEl.dataset["buttonId"] = owner.id;
    handleEl.dataset["style"] = handle.style;
    handleEl.dataset["shape"] = handle.shape;
    if (handleEl.dataset["icon"] !== handle.icon) {
      handleEl.dataset["icon"] = handle.icon;
      const iconEl = document.createElement("span");
      iconEl.className = "hover-handle-icon";
      // itemsのhtmlと同じく、ユーザー設定がそのまま書いたものを入れる
      iconEl.innerHTML = handle.icon;
      handleEl.replaceChildren(iconEl);
    }
  }

  function syncHandles(): void {
    for (const [tabId, handles] of handlesByTab) {
      if (activeByTabId[tabId] !== undefined) continue;
      for (const handleEl of handles.values()) handleEl.remove();
      handlesByTab.delete(tabId);
    }
    for (const tabId of Object.keys(activeByTabId)) {
      const tabContentEl = opts.tabContentOf(tabId);
      const handles = handlesByTab.get(tabId) ?? new Map<HoverButtonPosition, HTMLElement>();
      handlesByTab.set(tabId, handles);
      const owners = new Map<HoverButtonPosition, ResolvedHoverButtonConfig>();
      for (const button of buttons) {
        if (button.handle === null || owners.has(button.position)) continue;
        if (buttonsAt(tabId, button.position, "handle").length > 0) {
          owners.set(button.position, button);
        }
      }
      for (const [position, handleEl] of handles) {
        if (owners.has(position) && tabContentEl !== undefined) continue;
        handleEl.remove();
        handles.delete(position);
      }
      if (tabContentEl === undefined) continue;
      for (const [position, owner] of owners) {
        let handleEl = handles.get(position);
        if (!handleEl) {
          handleEl = buildHandleEl(tabId, position);
          handles.set(position, handleEl);
        }
        if (owner.handle) applyHandleLook(handleEl, owner, owner.handle);
        // パネルより前に置き、同じz-indexでもパネルが手前に重なるようにする
        if (handleEl.parentElement !== tabContentEl) {
          tabContentEl.insertBefore(
            handleEl,
            panelEl.parentElement === tabContentEl ? panelEl : null,
          );
        }
      }
    }
  }

  // 取っ手で開いたパネルの外を押したら閉じる。押した先のクリック・選択はそのまま通す
  document.addEventListener(
    "mousedown",
    (e) => {
      if (revealed === null || !pinned) return;
      const target = e.target instanceof Element ? e.target : null;
      if (target?.closest(".hover-panel, .hover-handle")) return;
      hide();
    },
    true,
  );

  // Escはターミナルへ送らずパネルを閉じるだけにする
  document.addEventListener(
    "keydown",
    (e) => {
      if (revealed === null || e.key !== "Escape" || e.isComposing) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      hide();
      opts.refocusTerminal();
    },
    true,
  );

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
    const position = hoverPositionFor(tabId, e.clientX - rect.left, e.clientY - rect.top, rect);
    if (position === null) {
      scheduleHide();
      return;
    }
    cancelHideTimer();
    if (revealed?.tabId === tabId && revealed.position === position) return;
    // 別の枠へ移ったときは、新しい項目が届くまで前の枠を出したままにしない
    if (revealed !== null) hide();
    void reveal(tabContentEl, tabId, position, "hover");
  }

  return {
    setConfig(next) {
      buttons = next;
      styleEl.textContent = next
        .filter((button) => button.css !== "")
        .map((button) => button.css)
        .join("\n");
      hide();
      syncHandles();
    },
    setActiveButtons(byTabId) {
      activeByTabId = byTabId;
      // 出している枠が無効になった（showがfalseへ変わった）場合はしまう
      if (
        revealed !== null &&
        buttonsAt(revealed.tabId, revealed.position, revealed.source).length === 0
      ) {
        hide();
      }
      syncHandles();
    },
    handleMouseMove,
    hide,
    handleMouseLeave() {
      if (!pinned) hide();
    },
    syncHandles,
    pin(tabId, position) {
      hide();
      if (position === null) return;
      const tabContentEl = opts.tabContentOf(tabId);
      if (!tabContentEl) return;
      pinned = true;
      void reveal(tabContentEl, tabId, position, "cli");
    },
  };
}
