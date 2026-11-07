import { describe, expect, test } from "bun:test";
import { compileCopyModeKeymap, defaultKeybindings } from "@niwaterm/config";
import { copyModeTextFromEvent, keyboardEventToCopyModeKeys } from "../mainview/tile-keybindings";
import {
  applyCopyModeKey,
  cellStarts,
  clampCopyModeCursor,
  copyModeRange,
  copyModeSelectionRows,
  createCopyModeState,
  copyModeMatchRows,
  isCaseSensitiveQuery,
  firstNonBlankColumn,
  pickCopyModeMatch,
  selectCopyModeRange,
  type CopyModeMatch,
  type CopyModeContext,
  type CopyModeKey,
  type CopyModeState,
  viewportOffsetForCursor,
} from "./copy-mode";

/** ビューポート＝画面全体（スクロールバック無し）の単純なコンテキストを作る */
function ctxOf(lines: string[], cols = 20, viewportRows = lines.length): CopyModeContext {
  return {
    cols,
    viewportRows,
    viewportOffset: 0,
    totalRows: lines.length,
    firstLineRow: 0,
    lines,
  };
}

const keymap = compileCopyModeKeymap(defaultKeybindings);

const SHIFTED_SYMBOLS = '~!@#$%^&*()_+{}|:"<>?';

/** webviewと同じ正規化を通して、vi表記のキー（"G"・"$"・"Escape"）をコピーモードへ渡す形にする */
function key(k: string, ctrl = false): CopyModeKey {
  const shiftKey = k.length === 1 && (k !== k.toLowerCase() || SHIFTED_SYMBOLS.includes(k));
  const e = { key: k, code: "", metaKey: false, ctrlKey: ctrl, altKey: false, shiftKey };
  return { keys: keyboardEventToCopyModeKeys(e), text: copyModeTextFromEvent(e) };
}

/** キー列をまとめて適用する（テストの見通しを良くするためのヘルパー） */
function press(state: CopyModeState, ctx: CopyModeContext, ...keys: string[]): CopyModeState {
  let current = state;
  for (const k of keys) {
    current = applyCopyModeKey(current, key(k), ctx, keymap).state;
  }
  return current;
}

describe("cellStarts", () => {
  test("半角のみの行は1桁ずつ並ぶ", () => {
    expect(cellStarts("ab", 5)).toEqual([0, 1]);
  });

  test("全角文字は2桁を占めるため開始桁が1つ飛ぶ", () => {
    expect(cellStarts("あb", 6)).toEqual([0, 2]);
  });

  test("結合用濁点は直前の文字と同じセルなので開始桁を増やさない", () => {
    expect(cellStarts("テ\u3099ィb", 10)).toEqual([0, 2, 4]);
  });

  test("行末の空白は含めない（中身が無い行でも0桁だけは残す）", () => {
    expect(cellStarts("ab   ", 10)).toEqual([0, 1]);
    expect(cellStarts("    ", 10)).toEqual([0]);
  });

  test("行テキストが桁数を超える場合はcolsで打ち切る", () => {
    expect(cellStarts("abcdef", 3)).toEqual([0, 1, 2]);
  });
});

describe("水平移動", () => {
  test("l/hでセル境界を1つずつ進む・戻る", () => {
    const ctx = ctxOf(["abc"]);
    const state = createCopyModeState({ x: 0, y: 0 });
    expect(press(state, ctx, "l", "l").cursor).toEqual({ x: 2, y: 0 });
    expect(press(state, ctx, "l", "l", "h").cursor).toEqual({ x: 1, y: 0 });
  });

  test("全角文字の上ではlが2桁進む（文字の途中の桁には乗らない）", () => {
    const ctx = ctxOf(["あいう"]);
    const state = createCopyModeState({ x: 0, y: 0 });
    expect(press(state, ctx, "l").cursor).toEqual({ x: 2, y: 0 });
    expect(press(state, ctx, "l", "l").cursor).toEqual({ x: 4, y: 0 });
    expect(press(state, ctx, "l", "h").cursor).toEqual({ x: 0, y: 0 });
  });

  test("行頭より左・行の中身より右へは出ない", () => {
    const ctx = ctxOf(["ab"], 10);
    const state = createCopyModeState({ x: 0, y: 0 });
    expect(press(state, ctx, "h").cursor).toEqual({ x: 0, y: 0 });
    expect(press(state, ctx, "l", "l", "l", "l").cursor).toEqual({ x: 1, y: 0 });
  });

  test("矢印キーはh/lと同じ扱い", () => {
    const ctx = ctxOf(["abc"]);
    const state = createCopyModeState({ x: 0, y: 0 });
    expect(press(state, ctx, "ArrowRight").cursor).toEqual({ x: 1, y: 0 });
  });
});

describe("垂直移動", () => {
  test("j/kで行を移動し、短い行を通過しても元の桁へ戻る", () => {
    const ctx = ctxOf(["abcdef", "ab", "abcdef"]);
    const state = { ...createCopyModeState({ x: 4, y: 0 }), desiredX: 4 };
    // 短い行では行末へ寄せるが、desiredXは4のまま保つ
    expect(press(state, ctx, "j").cursor).toEqual({ x: 1, y: 1 });
    expect(press(state, ctx, "j", "j").cursor).toEqual({ x: 4, y: 2 });
  });

  test("画面の上端・下端を超えない", () => {
    const ctx = ctxOf(["a", "b"]);
    const state = createCopyModeState({ x: 0, y: 0 });
    expect(press(state, ctx, "k").cursor).toEqual({ x: 0, y: 0 });
    expect(press(state, ctx, "j", "j", "j").cursor).toEqual({ x: 0, y: 1 });
  });

  test("Ctrl+d/Ctrl+uは半画面、Ctrl+f/Ctrl+bは1画面分動く", () => {
    const lines = Array.from({ length: 20 }, (_, i) => `line${i}`);
    const ctx = { ...ctxOf(lines, 20, 10), viewportRows: 10 };
    const state = createCopyModeState({ x: 0, y: 0 });
    expect(applyCopyModeKey(state, key("d", true), ctx, keymap).state.cursor.y).toBe(5);
    expect(applyCopyModeKey(state, key("f", true), ctx, keymap).state.cursor.y).toBe(9);
  });

  test("gg/Gで画面全体（スクロールバック込み）の先頭・末尾へ飛ぶ", () => {
    const lines = Array.from({ length: 5 }, (_, i) => `line${i}`);
    const ctx = ctxOf(lines);
    const state = createCopyModeState({ x: 3, y: 2 });
    expect(press(state, ctx, "G").cursor).toEqual({ x: 0, y: 4 });
    expect(press(state, ctx, "g", "g").cursor).toEqual({ x: 0, y: 0 });
  });

  test("gの後に無関係なキーが来たらgg待ちを解除してそのキーを解釈する", () => {
    const ctx = ctxOf(["abc", "def"]);
    const state = createCopyModeState({ x: 0, y: 0 });
    const after = press(state, ctx, "g", "j");
    expect(after.pendingKeys).toEqual([]);
    expect(after.cursor).toEqual({ x: 0, y: 1 });
  });

  test("H/M/Lでビューポートの上端・中央・下端へ移動する", () => {
    const lines = Array.from({ length: 12 }, (_, i) => `line${i}`);
    const ctx: CopyModeContext = {
      cols: 20,
      viewportRows: 5,
      viewportOffset: 4,
      totalRows: 12,
      firstLineRow: 0,
      lines,
    };
    const state = createCopyModeState({ x: 0, y: 6 });
    expect(press(state, ctx, "H").cursor.y).toBe(4);
    expect(press(state, ctx, "M").cursor.y).toBe(6);
    expect(press(state, ctx, "L").cursor.y).toBe(8);
  });
});

describe("行内移動", () => {
  test("0は行頭、^は最初の非空白、$は最後の非空白へ移動する", () => {
    const ctx = ctxOf(["  hello  "], 12);
    const state = createCopyModeState({ x: 5, y: 0 });
    expect(press(state, ctx, "0").cursor.x).toBe(0);
    expect(press(state, ctx, "^").cursor.x).toBe(2);
    expect(press(state, ctx, "$").cursor.x).toBe(6);
  });

  test("空行での$は行頭に留まる", () => {
    const ctx = ctxOf(["   "], 5);
    const state = createCopyModeState({ x: 2, y: 0 });
    expect(press(state, ctx, "$").cursor.x).toBe(0);
  });
});

describe("単語移動", () => {
  test("wは次の単語の先頭、bは前の単語の先頭へ移動する", () => {
    const ctx = ctxOf(["foo bar baz"], 20);
    const state = createCopyModeState({ x: 0, y: 0 });
    expect(press(state, ctx, "w").cursor.x).toBe(4);
    expect(press(state, ctx, "w", "w").cursor.x).toBe(8);
    expect(press(state, ctx, "w", "w", "b").cursor.x).toBe(4);
  });

  test("記号は単語とは別のまとまりとして扱う", () => {
    const ctx = ctxOf(["foo.bar"], 20);
    const state = createCopyModeState({ x: 0, y: 0 });
    expect(press(state, ctx, "w").cursor.x).toBe(3);
    expect(press(state, ctx, "w", "w").cursor.x).toBe(4);
  });

  test("eは単語の末尾へ移動する", () => {
    const ctx = ctxOf(["foo bar"], 20);
    const state = createCopyModeState({ x: 0, y: 0 });
    expect(press(state, ctx, "e").cursor.x).toBe(2);
    expect(press(state, ctx, "e", "e").cursor.x).toBe(6);
  });

  test("行末まで単語が無ければ次の行の最初の単語へ送る", () => {
    const ctx = ctxOf(["foo", "  bar"], 20);
    const state = createCopyModeState({ x: 0, y: 0 });
    expect(press(state, ctx, "w").cursor).toEqual({ x: 2, y: 1 });
  });

  test("行頭でのbは前の行の最後の単語へ戻る", () => {
    const ctx = ctxOf(["foo bar", "baz"], 20);
    const state = createCopyModeState({ x: 0, y: 1 });
    expect(press(state, ctx, "b").cursor).toEqual({ x: 4, y: 0 });
  });

  test("全角文字の単語も桁単位で正しく移動する", () => {
    const ctx = ctxOf(["あい うえ"], 20);
    const state = createCopyModeState({ x: 0, y: 0 });
    expect(press(state, ctx, "w").cursor.x).toBe(5);
  });
});

describe("選択", () => {
  test("vで文字選択を開始し、移動すると範囲が広がる", () => {
    const ctx = ctxOf(["abcdef"], 10);
    const state = press(createCopyModeState({ x: 1, y: 0 }), ctx, "v", "l", "l");
    expect(state.selectionMode).toBe("char");
    expect(copyModeRange(state, ctx.cols)).toEqual({
      start: { x: 1, y: 0 },
      end: { x: 3, y: 0 },
      mode: "char",
    });
  });

  test("カーソルがアンカーより手前にあっても範囲は昇順に正規化される", () => {
    const ctx = ctxOf(["abcdef"], 10);
    const state = press(createCopyModeState({ x: 4, y: 0 }), ctx, "v", "h", "h");
    expect(copyModeRange(state, ctx.cols)).toEqual({
      start: { x: 2, y: 0 },
      end: { x: 4, y: 0 },
      mode: "char",
    });
  });

  test("Vの行選択は行全体（0桁〜最終桁）になる", () => {
    const ctx = ctxOf(["abc", "def"], 10);
    const state = press(createCopyModeState({ x: 1, y: 0 }), ctx, "V", "j");
    expect(copyModeRange(state, ctx.cols)).toEqual({
      start: { x: 0, y: 0 },
      end: { x: 9, y: 1 },
      mode: "line",
    });
  });

  test("同じモードのv/Vをもう一度押すと選択解除になる", () => {
    const ctx = ctxOf(["abc"], 10);
    const state = press(createCopyModeState({ x: 0, y: 0 }), ctx, "v", "v");
    expect(state.selectionMode).toBe("none");
    expect(copyModeRange(state, ctx.cols)).toBeNull();
  });

  test("選択中のVは行選択へ切り替える（アンカーは維持する）", () => {
    const ctx = ctxOf(["abc", "def"], 10);
    const state = press(createCopyModeState({ x: 1, y: 0 }), ctx, "v", "j", "V");
    expect(state.selectionMode).toBe("line");
    expect(state.anchor).toEqual({ x: 1, y: 0 });
  });

  test("selectCopyModeRangeは与えた範囲の文字選択にし、カーソルを終点へ置く", () => {
    const ctx = ctxOf(["abcdef", "ghijkl"], 10);
    const state = selectCopyModeRange(createCopyModeState({ x: 0, y: 0 }), {
      anchor: { x: 4, y: 1 },
      cursor: { x: 1, y: 0 },
    });
    expect(state.cursor).toEqual({ x: 1, y: 0 });
    expect(copyModeRange(state, ctx.cols)).toEqual({
      start: { x: 1, y: 0 },
      end: { x: 4, y: 1 },
      mode: "char",
    });
    // 引き継いだ後もキーで端を動かせる
    const moved = press(state, ctx, "h");
    expect(copyModeRange(moved, ctx.cols)?.start).toEqual({ x: 0, y: 0 });
  });

  test("selectCopyModeRangeは検索入力を捨て、直前の検索は残す", () => {
    const ctx = ctxOf(["abc"], 10);
    const searching = press(createCopyModeState({ x: 0, y: 0 }), ctx, "/", "b", "Enter", "/");
    expect(searching.searchInput).not.toBeNull();
    const state = selectCopyModeRange(searching, {
      anchor: { x: 0, y: 0 },
      cursor: { x: 2, y: 0 },
    });
    expect(state.searchInput).toBeNull();
    expect(state.lastSearch).toEqual(searching.lastSearch);
  });
});

describe("ヤンク・終了", () => {
  test("yは選択範囲のヤンクを要求する", () => {
    const ctx = ctxOf(["abcdef"], 10);
    const state = press(createCopyModeState({ x: 1, y: 0 }), ctx, "v", "l");
    const result = applyCopyModeKey(state, key("y"), ctx, keymap);
    expect(result.effect).toEqual({
      type: "yank",
      range: { start: { x: 1, y: 0 }, end: { x: 2, y: 0 }, mode: "char" },
    });
  });

  test("選択していない状態のyはカーソル行をヤンクする", () => {
    const ctx = ctxOf(["abc", "def"], 10);
    const state = createCopyModeState({ x: 1, y: 1 });
    const result = applyCopyModeKey(state, key("y"), ctx, keymap);
    expect(result.effect).toEqual({
      type: "yank",
      range: { start: { x: 0, y: 1 }, end: { x: 9, y: 1 }, mode: "line" },
    });
  });

  test("選択中のEscapeは選択解除、選択していなければコピーモードを抜ける", () => {
    const ctx = ctxOf(["abc"], 10);
    const selecting = press(createCopyModeState({ x: 0, y: 0 }), ctx, "v");
    const cleared = applyCopyModeKey(selecting, key("Escape"), ctx, keymap);
    expect(cleared.effect).toEqual({ type: "none" });
    expect(cleared.state.selectionMode).toBe("none");
    expect(applyCopyModeKey(cleared.state, key("Escape"), ctx, keymap).effect).toEqual({
      type: "exit",
    });
  });

  test("q・Ctrl+cはいつでもコピーモードを抜ける", () => {
    const ctx = ctxOf(["abc"], 10);
    const selecting = press(createCopyModeState({ x: 0, y: 0 }), ctx, "v");
    expect(applyCopyModeKey(selecting, key("q"), ctx, keymap).effect).toEqual({ type: "exit" });
    expect(applyCopyModeKey(selecting, key("c", true), ctx, keymap).effect).toEqual({
      type: "exit",
    });
  });

  test("未割当キーはhandled=falseで何も起きない", () => {
    const ctx = ctxOf(["abc"], 10);
    const state = createCopyModeState({ x: 0, y: 0 });
    const result = applyCopyModeKey(state, key("Z"), ctx, keymap);
    expect(result.handled).toBe(false);
    expect(result.state.cursor).toEqual({ x: 0, y: 0 });
  });
});

describe("ビューポート追従", () => {
  test("カーソルがビューポートより上・下にある場合だけ先頭行を動かす", () => {
    const base: CopyModeContext = {
      cols: 20,
      viewportRows: 5,
      viewportOffset: 10,
      totalRows: 100,
      firstLineRow: 10,
      lines: [],
    };
    const inside = createCopyModeState({ x: 0, y: 12 });
    expect(viewportOffsetForCursor(inside, base)).toBe(10);
    const above = createCopyModeState({ x: 0, y: 3 });
    expect(viewportOffsetForCursor(above, base)).toBe(3);
    const below = createCopyModeState({ x: 0, y: 20 });
    expect(viewportOffsetForCursor(below, base)).toBe(16);
  });

  test("先頭行は0〜（総行数 - ビューポート行数）にクランプされる", () => {
    const ctx: CopyModeContext = {
      cols: 20,
      viewportRows: 5,
      viewportOffset: 0,
      totalRows: 7,
      firstLineRow: 0,
      lines: [],
    };
    expect(viewportOffsetForCursor(createCopyModeState({ x: 0, y: 6 }), ctx)).toBe(2);
  });

  test("clampCopyModeCursorはスクロール後の行テキストで桁をセル境界へ揃える", () => {
    const ctx = ctxOf(["あい"], 10);
    const state = { ...createCopyModeState({ x: 3, y: 0 }), desiredX: 3 };
    expect(clampCopyModeCursor(state, ctx).cursor).toEqual({ x: 2, y: 0 });
  });
});

describe("copyModeSelectionRows", () => {
  test("複数行の選択をビューポート座標の行区間へ落とす", () => {
    const rows = copyModeSelectionRows(
      { start: { x: 3, y: 11 }, end: { x: 5, y: 13 }, mode: "char" },
      { cols: 10, viewportRows: 5, viewportOffset: 10 },
    );
    expect(rows).toEqual([
      { y: 1, startX: 3, endX: 9 },
      { y: 2, startX: 0, endX: 9 },
      { y: 3, startX: 0, endX: 5 },
    ]);
  });

  test("ビューポート外の行は捨てる", () => {
    const rows = copyModeSelectionRows(
      { start: { x: 0, y: 0 }, end: { x: 4, y: 100 }, mode: "line" },
      { cols: 10, viewportRows: 3, viewportOffset: 10 },
    );
    expect(rows).toEqual([
      { y: 0, startX: 0, endX: 9 },
      { y: 1, startX: 0, endX: 9 },
      { y: 2, startX: 0, endX: 9 },
    ]);
  });
});

/** 1行に収まる一致を作る */
function matchAt(y: number, startX: number, endX: number): CopyModeMatch {
  return { start: { x: startX, y }, end: { x: endX, y } };
}

describe("pickCopyModeMatch", () => {
  // libghostty-vtは新しい順（下から上）で返すので、並び順に頼らないことも併せて確かめる
  const matches = [matchAt(2, 0, 2), matchAt(1, 4, 6), matchAt(0, 0, 2)];

  test("前方検索は起点より後の最初の一致を返す（起点そのものは含まない）", () => {
    expect(pickCopyModeMatch({ matches, from: { x: 0, y: 0 }, direction: "forward" })).toEqual(
      matchAt(1, 4, 6),
    );
  });

  test("後方検索は起点より前の最も近い一致を返す", () => {
    expect(pickCopyModeMatch({ matches, from: { x: 0, y: 2 }, direction: "backward" })).toEqual(
      matchAt(1, 4, 6),
    );
  });

  test("同じ行の中でも起点の桁より後・前で絞り込む", () => {
    const same = [matchAt(0, 8, 10), matchAt(0, 4, 6), matchAt(0, 0, 2)];
    expect(
      pickCopyModeMatch({ matches: same, from: { x: 4, y: 0 }, direction: "forward" }),
    ).toEqual(matchAt(0, 8, 10));
    expect(
      pickCopyModeMatch({ matches: same, from: { x: 4, y: 0 }, direction: "backward" }),
    ).toEqual(matchAt(0, 0, 2));
  });

  test("端まで行ったら反対の端から折り返す", () => {
    expect(pickCopyModeMatch({ matches, from: { x: 0, y: 2 }, direction: "forward" })).toEqual(
      matchAt(0, 0, 2),
    );
    expect(pickCopyModeMatch({ matches, from: { x: 0, y: 0 }, direction: "backward" })).toEqual(
      matchAt(2, 0, 2),
    );
  });

  test("一致が起点の1つしか無ければそれを返す", () => {
    const only = [matchAt(1, 4, 6)];
    expect(
      pickCopyModeMatch({ matches: only, from: { x: 4, y: 1 }, direction: "forward" }),
    ).toEqual(matchAt(1, 4, 6));
  });

  test("acceptが偽を返す一致は飛ばす", () => {
    expect(
      pickCopyModeMatch({
        matches,
        from: { x: 0, y: 0 },
        direction: "forward",
        accept: (m) => m.start.y !== 1,
      }),
    ).toEqual(matchAt(2, 0, 2));
  });

  test("一致が無ければnull", () => {
    expect(
      pickCopyModeMatch({ matches: [], from: { x: 0, y: 0 }, direction: "forward" }),
    ).toBeNull();
  });
});

describe("copyModeMatchRows", () => {
  test("ビューポート座標の行ごとの桁区間にする", () => {
    const ctx = { cols: 10, viewportRows: 3, viewportOffset: 5 };
    expect(copyModeMatchRows([matchAt(6, 2, 4)], ctx)).toEqual([{ y: 1, startX: 2, endX: 4 }]);
  });

  test("折り返し行をまたぐ一致は行ごとに分け、ビューポート外の行は落とす", () => {
    const ctx = { cols: 10, viewportRows: 3, viewportOffset: 5 };
    const wrapped: CopyModeMatch = { start: { x: 7, y: 4 }, end: { x: 2, y: 5 } };
    const inside: CopyModeMatch = { start: { x: 8, y: 6 }, end: { x: 1, y: 7 } };
    expect(copyModeMatchRows([wrapped, inside], ctx)).toEqual([
      { y: 0, startX: 0, endX: 2 },
      { y: 1, startX: 8, endX: 9 },
      { y: 2, startX: 0, endX: 1 },
    ]);
  });
});

describe("isCaseSensitiveQuery", () => {
  test("大文字を含むクエリだけ大文字小文字を区別する（smartcase）", () => {
    expect(isCaseSensitiveQuery("foo")).toBe(false);
    expect(isCaseSensitiveQuery("Foo")).toBe(true);
    expect(isCaseSensitiveQuery("あいう")).toBe(false);
  });
});

describe("検索キー（/ ? n N）", () => {
  const ctx = ctxOf(["foo one", "bar foo", "foo two"]);

  test("/で入力状態に入り、打った文字が検索文字列へ溜まる", () => {
    const state = press(createCopyModeState({ x: 0, y: 0 }), ctx, "/", "f", "o", "o");
    expect(state.searchInput).toEqual({ direction: "forward", query: "foo" });
  });

  test("入力中は移動キーとして解釈しない（jでカーソルが動かない）", () => {
    const state = press(createCopyModeState({ x: 0, y: 0 }), ctx, "/", "j");
    expect(state.cursor).toEqual({ x: 0, y: 0 });
    expect(state.searchInput?.query).toBe("j");
  });

  test("Backspaceで1文字消し、空でのBackspaceは入力自体を取りやめる", () => {
    const typed = press(createCopyModeState({ x: 0, y: 0 }), ctx, "/", "f", "o");
    expect(press(typed, ctx, "Backspace").searchInput?.query).toBe("f");
    expect(press(typed, ctx, "Backspace", "Backspace", "Backspace").searchInput).toBeNull();
  });

  test("Escapeで入力を取りやめてもコピーモードは抜けない", () => {
    const typed = press(createCopyModeState({ x: 0, y: 0 }), ctx, "/", "f");
    const result = applyCopyModeKey(typed, key("Escape"), ctx, keymap);
    expect(result.effect).toEqual({ type: "none" });
    expect(result.state.searchInput).toBeNull();
  });

  test("Ctrl+uで入力中の文字列を全部消す・Ctrl+cで取りやめる", () => {
    const typed = press(createCopyModeState({ x: 0, y: 0 }), ctx, "/", "f", "o");
    expect(applyCopyModeKey(typed, key("u", true), ctx, keymap).state.searchInput?.query).toBe("");
    expect(applyCopyModeKey(typed, key("c", true), ctx, keymap).state.searchInput).toBeNull();
  });

  test("Enterで検索エフェクトを返し、直前の検索として覚える", () => {
    const typed = press(createCopyModeState({ x: 0, y: 0 }), ctx, "?", "f", "o", "o");
    const result = applyCopyModeKey(typed, key("Enter"), ctx, keymap);
    expect(result.effect).toEqual({
      type: "search",
      search: { direction: "backward", query: "foo" },
    });
    expect(result.state.searchInput).toBeNull();
    expect(result.state.lastSearch).toEqual({ direction: "backward", query: "foo" });
  });

  test("空のままEnterは直前の検索文字列を使い回す", () => {
    const searched = press(createCopyModeState({ x: 0, y: 0 }), ctx, "/", "f", "o", "o", "Enter");
    const result = applyCopyModeKey(press(searched, ctx, "/"), key("Enter"), ctx, keymap);
    expect(result.effect).toEqual({
      type: "search",
      search: { direction: "forward", query: "foo" },
    });
  });

  test("検索していない状態でのEnterは入力を取りやめるだけ", () => {
    const result = applyCopyModeKey(
      press(createCopyModeState({ x: 0, y: 0 }), ctx, "/"),
      key("Enter"),
      ctx,
      keymap,
    );
    expect(result.effect).toEqual({ type: "none" });
    expect(result.state.searchInput).toBeNull();
  });

  test("nは直前の検索と同じ向き、Nは逆向きで検索する", () => {
    const searched = press(createCopyModeState({ x: 0, y: 0 }), ctx, "/", "f", "o", "o", "Enter");
    expect(applyCopyModeKey(searched, key("n"), ctx, keymap).effect).toEqual({
      type: "search",
      search: { direction: "forward", query: "foo" },
    });
    const reversed = applyCopyModeKey(searched, key("N"), ctx, keymap);
    expect(reversed.effect).toEqual({
      type: "search",
      search: { direction: "backward", query: "foo" },
    });
    // Nを打っても「直前の検索」の向き自体は変わらない
    expect(reversed.state.lastSearch).toEqual({ direction: "forward", query: "foo" });
  });

  test("まだ検索していない状態のn/Nは何もしない", () => {
    const result = applyCopyModeKey(createCopyModeState({ x: 0, y: 0 }), key("n"), ctx, keymap);
    expect(result.handled).toBe(true);
    expect(result.effect).toEqual({ type: "none" });
  });

  test("yankと違い検索ではコピーモードを抜けない（選択は保ったまま）", () => {
    const selecting = press(createCopyModeState({ x: 0, y: 0 }), ctx, "v", "/", "f", "o", "o");
    const result = applyCopyModeKey(selecting, key("Enter"), ctx, keymap);
    expect(result.state.selectionMode).toBe("char");
    expect(result.state.anchor).toEqual({ x: 0, y: 0 });
  });
});

describe("プロンプトジャンプ（{ }）", () => {
  const ctx = ctxOf(["$ one", "out", "$ two", "out"]);

  test("{で上方向・}で下方向のジャンプを依頼する", () => {
    const up = applyCopyModeKey(createCopyModeState({ x: 0, y: 2 }), key("{"), ctx, keymap);
    expect(up.effect).toEqual({ type: "jumpPrompt", direction: "up" });
    const down = applyCopyModeKey(createCopyModeState({ x: 0, y: 0 }), key("}"), ctx, keymap);
    expect(down.effect).toEqual({ type: "jumpPrompt", direction: "down" });
  });

  test("行のマークは呼び出し側しか知らないため、カーソルはこの場では動かさない", () => {
    const result = applyCopyModeKey(createCopyModeState({ x: 3, y: 2 }), key("{"), ctx, keymap);
    expect(result.state.cursor).toEqual({ x: 3, y: 2 });
  });

  test("選択中でも選択は解除しない（V + }でコマンド1つぶんを選べる）", () => {
    const selecting = press(createCopyModeState({ x: 0, y: 0 }), ctx, "V");
    const result = applyCopyModeKey(selecting, key("}"), ctx, keymap);
    expect(result.state.selectionMode).toBe("line");
    expect(result.state.anchor).toEqual({ x: 0, y: 0 });
  });

  test("gの2打目待ちは解除する", () => {
    const pending = press(createCopyModeState({ x: 0, y: 0 }), ctx, "g");
    expect(applyCopyModeKey(pending, key("}"), ctx, keymap).state.pendingKeys).toEqual([]);
  });
});

describe("firstNonBlankColumn", () => {
  test("先頭の空白を飛ばした桁を返す", () => {
    expect(firstNonBlankColumn("  abc")).toBe(2);
    expect(firstNonBlankColumn("> echo foo")).toBe(0);
  });

  test("全角文字は2桁を占める", () => {
    expect(firstNonBlankColumn(" あab")).toBe(1);
    expect(firstNonBlankColumn("あ い")).toBe(0);
  });

  test("空行・空白だけの行は0", () => {
    expect(firstNonBlankColumn("")).toBe(0);
    expect(firstNonBlankColumn("    ")).toBe(0);
  });
});

describe("キーの割り当て替え", () => {
  const ctx = ctxOf(["abc def", "ghi"]);

  test("表に書いたキーで、そのアクションが動く", () => {
    const custom = compileCopyModeKeymap({ copyMode: { "ctrl+n": "copy-cursor-down" } });
    const result = applyCopyModeKey(
      createCopyModeState({ x: 0, y: 0 }),
      key("n", true),
      ctx,
      custom,
    );
    expect(result.handled).toBe(true);
    expect(result.state.cursor).toEqual({ x: 0, y: 1 });
  });

  test("表から外したキーは未割当になる", () => {
    const custom = compileCopyModeKeymap({ copyMode: { k: "copy-cursor-up" } });
    const result = applyCopyModeKey(createCopyModeState({ x: 0, y: 0 }), key("j"), ctx, custom);
    expect(result.handled).toBe(false);
  });

  test("空白区切りの連続キーは途中まで打つと続きを待ち、打ち切ると発火する", () => {
    const custom = compileCopyModeKeymap({ copyMode: { "space l": "copy-line-end" } });
    const waiting = applyCopyModeKey(createCopyModeState({ x: 0, y: 0 }), key(" "), ctx, custom);
    expect(waiting.handled).toBe(true);
    expect(waiting.state.pendingKeys).toEqual(["0000:space"]);
    const fired = applyCopyModeKey(waiting.state, key("l"), ctx, custom);
    expect(fired.state.cursor).toEqual({ x: 6, y: 0 });
    expect(fired.state.pendingKeys).toEqual([]);
  });

  test("単独のキーと連続キーの両方があれば、単独のキーが即座に発火する", () => {
    const custom = compileCopyModeKeymap({
      copyMode: { g: "copy-bottom", "g g": "copy-top" },
    });
    const result = applyCopyModeKey(createCopyModeState({ x: 0, y: 0 }), key("g"), ctx, custom);
    expect(result.state.cursor).toEqual({ x: 0, y: 1 });
    expect(result.state.pendingKeys).toEqual([]);
  });

  test("関数ハンドラを割り当てたキーはcustomの効果を返す", () => {
    const custom = compileCopyModeKeymap({ copyMode: { x: { kind: "custom", id: "handler-0" } } });
    const result = applyCopyModeKey(createCopyModeState({ x: 0, y: 0 }), key("x"), ctx, custom);
    expect(result.effect).toEqual({ type: "custom", handlerId: "handler-0" });
  });

  test("検索入力中の表も差し替えられ、表に無い1文字は検索文字列へ足す", () => {
    const custom = compileCopyModeKeymap({
      copyMode: { "/": "copy-search-forward" },
      copyModeSearch: { tab: "copy-search-confirm" },
    });
    let state = applyCopyModeKey(createCopyModeState({ x: 0, y: 0 }), key("/"), ctx, custom).state;
    state = applyCopyModeKey(state, key("d"), ctx, custom).state;
    state = applyCopyModeKey(state, key("Enter"), ctx, custom).state;
    expect(state.searchInput?.query).toBe("d");
    const confirmed = applyCopyModeKey(state, key("Tab"), ctx, custom);
    expect(confirmed.effect).toEqual({
      type: "search",
      search: { direction: "forward", query: "d" },
    });
  });

  test("検索入力中の関数ハンドラはcustomの効果を返し、入力中のまま残る", () => {
    const custom = compileCopyModeKeymap({
      copyMode: { "/": "copy-search-forward" },
      copyModeSearch: { "ctrl+r": { kind: "custom", id: "handler-1" } },
    });
    const searching = applyCopyModeKey(createCopyModeState({ x: 0, y: 0 }), key("/"), ctx, custom);
    const result = applyCopyModeKey(searching.state, key("r", true), ctx, custom);
    expect(result.effect).toEqual({ type: "custom", handlerId: "handler-1" });
    expect(result.state.searchInput).not.toBeNull();
  });

  test("IME確定・ペーストのように文字だけを送る入力は、表を引かずに検索文字列へ足す", () => {
    const searching = press(createCopyModeState({ x: 0, y: 0 }), ctx, "/");
    const result = applyCopyModeKey(searching, { keys: [], text: "あ" }, ctx, keymap);
    expect(result.state.searchInput?.query).toBe("あ");
  });
});
