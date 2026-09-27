/**
 * フォーカスを持っていてよい要素のセレクタ。この内側にフォーカスがある間は、キー入力の
 * 受け口（IME用のtextarea）へ奪い返さない。
 * input・textarea・contenteditableは文字を打つ場所そのもの、role=dialog・role=menuは
 * Radixのダイアログ・メニューが開いている間のフォーカストラップ先。
 */
export const FOCUS_HOLDER_SELECTOR =
  'input, textarea, [contenteditable="true"], [role="dialog"], [role="menu"]';

/** closestしか使わないため、テストからDOMを用意せずに渡せる最小の形で受け取る */
export interface FocusHolderCandidate {
  closest(selector: string): unknown;
}

export interface ImeFocusState {
  /** document.activeElement。フォーカスがどこにも無ければnull */
  active: FocusHolderCandidate | null;
  /** テキスト選択が残っているか */
  hasSelection: boolean;
  /** ターミナル上でドラッグ選択を始めてからボタンを離すまでの間か */
  selectionDragging: boolean;
  /** このwebviewがOSキーボードフォーカスを持っているか（document.hasFocus()） */
  documentFocused: boolean;
}

/**
 * キー入力の受け口（IME用のtextarea）へフォーカスを戻すべきか。
 *
 * Chromiumは編集可能要素にフォーカスが無いとOSのIMEを無効にするため、bodyやボタンへ
 * フォーカスが移ったままだと、documentレベルのkeydownで拾うASCIIは打てるのに日本語入力だけが
 * できない状態になる。詳細: docs/known-issues/chromium-disables-ime-when-focus-leaves-textarea.md
 */
export function shouldRecoverImeFocus(state: ImeFocusState): boolean {
  // 他アプリやブラウザタブ（HTMLの外に重なるネイティブwebview）がキーボードフォーカスを
  // 持っている間は触らない。戻ってきたときはwindowのfocusイベント側が拾う
  if (!state.documentFocused) return false;
  // textareaへフォーカスを移すと選択は解除されるため、選択が残っている間は戻さない
  // （コピー前の選択を消さないようにする。選択はクリックで解けるのでその時に戻せる）
  if (state.hasSelection) return false;
  // ドラッグ開始直後はまだ選択が空なのでhasSelectionでは弾けない。押下の既定動作でフォーカスが
  // bodyへ落ちたのを拾ってtextareaへ移すと、始まったばかりのドラッグ選択が打ち切られる。
  // ボタンを離した時点でtileTreeElのmouseupリスナーが戻すので、ここでは触らない
  if (state.selectionDragging) return false;
  if (!state.active) return true;
  return state.active.closest(FOCUS_HOLDER_SELECTOR) === null;
}
