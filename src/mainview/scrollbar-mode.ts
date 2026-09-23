/** 常時表示のスクロールバーを疑似要素で細く描き直すときに<html>へ付けるクラス（index.cssと対応） */
const CLASSIC_SCROLLBAR_CLASS = "classic-scrollbar";
/** 全要素のoverflowを一時的にhiddenへ落とし、スクロールバーを作り直させるクラス（index.cssと対応） */
const REBUILD_CLASS = "scrollbar-rebuild";

/**
 * スクロールバーがレイアウトを占有する常時表示型かを実測する。オーバーレイ型は幅0になる。
 * probeをthinにするのは、判定後に当てる::-webkit-scrollbarの影響を受けないようにするため
 * （scrollbar-widthがauto以外だと疑似要素は無視される）。
 * macOSは「スクロールバーを表示: 常に／自動」の設定やマウス接続の有無で型が切り替わるため、
 * プラットフォームから決め打ちせず実測する
 */
function hasClassicScrollbar(): boolean {
  const probe = document.createElement("div");
  probe.style.cssText =
    "position:absolute;top:-9999px;width:100px;height:100px;overflow:scroll;scrollbar-width:thin";
  document.body.appendChild(probe);
  const width = probe.offsetWidth - probe.clientWidth;
  probe.remove();
  return width > 0;
}

/**
 * macOSで常時表示型のスクロールバーのときだけ、index.cssの::-webkit-scrollbar系の細い描画へ切り替える。
 * WKWebViewのscrollbar-width: thinは常時表示型だと13px程度までしか細くならない。
 * オーバーレイ型で疑似要素を当てると常時表示に変わってしまうため、そちらはthinのまま残す。
 * WindowsはWebView2のthinで十分細いため対象外
 */
export function syncScrollbarMode(): void {
  if (!navigator.userAgent.includes("Mac")) return;
  const html = document.documentElement;
  const classic = hasClassicScrollbar();
  if (html.classList.contains(CLASSIC_SCROLLBAR_CLASS) === classic) return;
  html.classList.toggle(CLASSIC_SCROLLBAR_CLASS, classic);
  // WebKitは表示済みのスクロールバーへ後から疑似要素のスタイルを当てても作り直さず、
  // 元の太さのまま残る。overflowを一度外して再計算させると新しいスタイルで作り直される
  html.classList.add(REBUILD_CLASS);
  void html.offsetWidth;
  html.classList.remove(REBUILD_CLASS);
}
