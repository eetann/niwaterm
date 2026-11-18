/**
 * Tab・Shift+Tabで次に移るフォーカス先を自前で選ぶ。
 *
 * macOSのWKWebViewは既定（システム設定の「キーボードナビゲーション」がオフ）だとTabが
 * テキスト入力欄だけを巡り、ボタンへは止まらない。ボタンにフォーカスがあるときに後ろへ
 * 入力欄が無いとTabが空振りするため、ボタンを含む欄を持つダイアログはTabの移動を引き受ける。
 */

const TAB_CANDIDATE_SELECTOR =
  'button, input, textarea, select, a[href], [tabindex]:not([tabindex="-1"])';

/**
 * 候補の並びから次のフォーカス先を選ぶ。端では反対の端へ回り込む（Radixのフォーカストラップと揃える）。
 * currentが候補に無いときは、進む向きの端を返す
 */
export function pickTabTarget<T>(
  candidates: readonly T[],
  current: T | null,
  backward: boolean,
): T | null {
  if (candidates.length === 0) return null;
  const index = current === null ? -1 : candidates.indexOf(current);
  if (index === -1) return (backward ? candidates.at(-1) : candidates[0]) ?? null;
  const next = (index + (backward ? -1 : 1) + candidates.length) % candidates.length;
  return candidates[next] ?? null;
}

/** container内でTab順に並ぶ要素（無効・非表示・tabindex=-1を除く） */
function tabCandidates(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(TAB_CANDIDATE_SELECTOR)).filter(
    (el) =>
      !(el as HTMLButtonElement).disabled && el.tabIndex >= 0 && el.getClientRects().length > 0,
  );
}

/** container内でフォーカスを次（backwardなら前）の要素へ移す。移せたらtrue */
export function moveTabFocus(container: HTMLElement, backward: boolean): boolean {
  const active = document.activeElement;
  const target = pickTabTarget(
    tabCandidates(container),
    active instanceof HTMLElement ? active : null,
    backward,
  );
  if (target === null) return false;
  target.focus();
  return true;
}
