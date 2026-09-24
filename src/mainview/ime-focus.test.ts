import { describe, expect, test } from "bun:test";
import {
  FOCUS_HOLDER_SELECTOR,
  type FocusHolderCandidate,
  shouldRecoverImeFocus,
} from "./ime-focus";

/** closestだけを備えたダミー要素。insideHolderはセレクタに合致する祖先を持つかどうか */
function element(insideHolder: boolean): FocusHolderCandidate {
  return {
    closest: (selector: string) => (insideHolder && selector === FOCUS_HOLDER_SELECTOR ? {} : null),
  };
}

const focused = { hasSelection: false, documentFocused: true };

describe("shouldRecoverImeFocus", () => {
  test("フォーカスがどこにも無ければ戻す", () => {
    expect(shouldRecoverImeFocus({ active: null, ...focused })).toBe(true);
  });

  test("bodyやボタンのようにフォーカスを持つべきでない要素なら戻す", () => {
    expect(shouldRecoverImeFocus({ active: element(false), ...focused })).toBe(true);
  });

  test("入力欄・ダイアログ・メニューの中にフォーカスがあるなら戻さない", () => {
    expect(shouldRecoverImeFocus({ active: element(true), ...focused })).toBe(false);
  });

  test("選択が残っている間は戻さない", () => {
    expect(
      shouldRecoverImeFocus({ active: element(false), hasSelection: true, documentFocused: true }),
    ).toBe(false);
  });

  test("webviewがキーボードフォーカスを持っていない間は戻さない", () => {
    expect(
      shouldRecoverImeFocus({ active: null, hasSelection: false, documentFocused: false }),
    ).toBe(false);
  });
});
