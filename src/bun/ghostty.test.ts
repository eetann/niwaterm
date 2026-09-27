import { describe, expect, test } from "bun:test";
import { createGhosttyTerminal } from "./ghostty";

const encoder = new TextEncoder();

/** 画面を流し込んでdumpHtmlし、背景色を持つ<div>の中身（エスケープ済みHTML）を並べて返す */
function backgroundRuns(input: string): string[] {
  const term = createGhosttyTerminal(40, 3);
  try {
    term.write(encoder.encode(input));
    const html = term.dumpHtml();
    return [...html.matchAll(/<div style="[^"]*background-color:[^"]*">([^<]*)<\/div>/g)].map(
      (m) => m[1] ?? "",
    );
  } finally {
    term.free();
  }
}

// vendorのlibghostty-vtがscripts/patch-ghostty-formatter.ts適用済みでビルドされているかの確認を兼ねる。
// 落ちたら `mise run build:vendor:mac` / `mise run build:vendor:win` でビルドし直す。
// 詳細: docs/known-issues/libghostty-vt-formatter-bleeds-bg-into-skipped-cells.md
describe("dumpHtmlの背景色", () => {
  test("背景色を設定したままカーソル移動で飛ばした空セルは背景色で塗らない", () => {
    // Claude Codeの起動バナーと同じ形: 背景色付きのロゴを描いたあと、背景色を戻さずCHAで12列目へ飛ぶ
    const runs = backgroundRuns(
      "\x1b[38;5;174m ▐\x1b[48;5;16m▛███▛█\x1b[12G\x1b[39m\x1b[49m\x1b[1mClaude Code\x1b[0m",
    );
    expect(runs).toEqual(["&#9627;&#9608;&#9608;&#9608;&#9627;&#9608;"]);
  });

  test("背景色を設定して書いた空白は背景色で塗る", () => {
    const runs = backgroundRuns("a\x1b[48;5;16m   \x1b[49mb");
    expect(runs).toEqual(["   "]);
  });
});
