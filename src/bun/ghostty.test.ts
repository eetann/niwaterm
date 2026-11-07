import { describe, expect, test } from "bun:test";
import { createGhosttyTerminal, type SemanticPromptEvent } from "./ghostty";

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

describe("kittyGraphics", () => {
  /** Kitty graphics protocolのAPCシーケンス（ペイロードはbase64で埋め込む） */
  function apc(control: string, payload: Uint8Array): string {
    return `\x1b_G${control};${Buffer.from(payload).toString("base64")}\x1b\\`;
  }

  // 1x1の赤（不透明）のPNG
  const redPng = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==",
    "base64",
  );

  test("画像を受け取っていなければ空を返す", () => {
    const term = createGhosttyTerminal(20, 5);
    try {
      term.resize(20, 5, 10, 20);
      term.write(encoder.encode("hello"));
      expect(term.kittyGraphics()).toEqual({ placements: [], images: [] });
    } finally {
      term.free();
    }
  });

  test("生のRGBを送って表示すると、配置とRGBAの画素を返す", () => {
    const term = createGhosttyTerminal(20, 5);
    try {
      term.resize(20, 5, 10, 20);
      term.write(encoder.encode("\r\n  "));
      // 2x1のRGB（f=24）を、カーソル位置（2列目, 1行目）へ表示する
      term.write(
        encoder.encode(apc("a=T,f=24,s=2,v=1,q=2", new Uint8Array([255, 0, 0, 0, 0, 255]))),
      );
      const { placements, images } = term.kittyGraphics();
      expect(placements).toHaveLength(1);
      expect(placements[0]).toMatchObject({
        col: 2,
        row: 1,
        width: 2,
        height: 1,
        sourceWidth: 2,
        sourceHeight: 1,
        z: 0,
      });
      expect(images).toHaveLength(1);
      expect(images[0]?.key).toBe(placements[0]?.imageKey);
      expect([...Buffer.from(images[0]?.rgbaBase64 ?? "", "base64")]).toEqual([
        255, 0, 0, 255, 0, 0, 255, 255,
      ]);
    } finally {
      term.free();
    }
  });

  test("PNGはデコーダで展開され、列・行の指定でセル単位の大きさになる", () => {
    const term = createGhosttyTerminal(20, 5);
    try {
      term.resize(20, 5, 10, 20);
      term.write(encoder.encode(apc("a=T,f=100,c=3,r=2,q=2", redPng)));
      const { placements, images } = term.kittyGraphics();
      expect(placements[0]).toMatchObject({ col: 0, row: 0, width: 30, height: 40 });
      expect([...Buffer.from(images[0]?.rgbaBase64 ?? "", "base64")]).toEqual([255, 0, 0, 255]);
    } finally {
      term.free();
    }
  });

  test("画像を消すと配置も消える", () => {
    const term = createGhosttyTerminal(20, 5);
    try {
      term.resize(20, 5, 10, 20);
      term.write(encoder.encode(apc("a=T,f=100,q=2", redPng)));
      expect(term.kittyGraphics().placements).toHaveLength(1);
      term.write(encoder.encode("\x1b_Ga=d,d=A,q=2\x1b\\"));
      expect(term.kittyGraphics()).toEqual({ placements: [], images: [] });
    } finally {
      term.free();
    }
  });

  test("グリッドが同じままセル寸法だけ変わっても画像の大きさへ反映する", () => {
    const term = createGhosttyTerminal(20, 5);
    try {
      term.setCellSize(8, 16);
      term.write(encoder.encode(apc("a=T,f=100,c=2,r=1,q=2", redPng)));
      expect(term.kittyGraphics().placements[0]).toMatchObject({ width: 16, height: 16 });
      term.setCellSize(12, 24);
      expect(term.kittyGraphics().placements[0]).toMatchObject({ width: 24, height: 24 });
    } finally {
      term.free();
    }
  });
  test("XTWINOPSのセルサイズ問い合わせ（CSI 16 t）に応答する", () => {
    const term = createGhosttyTerminal(20, 5);
    try {
      const responses: string[] = [];
      term.onWritePty((data) => responses.push(new TextDecoder().decode(data)));
      term.resize(20, 5, 10, 20);
      term.write(encoder.encode("\x1b[16t"));
      expect(responses.join("")).toBe("\x1b[6;20;10t");
    } finally {
      term.free();
    }
  });
});

describe("onClipboardWrite", () => {
  test("OSC 52の書き込みでtext/plainのバイト列を受け取る", () => {
    const term = createGhosttyTerminal(20, 5);
    try {
      const copied: string[] = [];
      term.onClipboardWrite((data) => copied.push(new TextDecoder().decode(data)));
      term.write(encoder.encode("\x1b]52;c;R2hvc3R0eQ==\x1b\\")); // "Ghostty"
      expect(copied).toEqual(["Ghostty"]);
    } finally {
      term.free();
    }
  });
  test("OSC 5522の書き込みに成功（DONE）を返す", () => {
    const term = createGhosttyTerminal(20, 5);
    try {
      const copied: string[] = [];
      const responses: string[] = [];
      term.onWritePty((data) => responses.push(new TextDecoder().decode(data)));
      term.onClipboardWrite((data) => copied.push(new TextDecoder().decode(data)));
      term.write(encoder.encode("\x1b]5522;type=write:id=42\x1b\\"));
      term.write(encoder.encode("\x1b]5522;type=wdata:mime=dGV4dC9odG1s;PGI+aGk8L2I+\x1b\\")); // text/html
      term.write(encoder.encode("\x1b]5522;type=wdata:mime=dGV4dC9wbGFpbg==;R2hvc3R0eQ==\x1b\\")); // text/plain
      term.write(encoder.encode("\x1b]5522;type=wdata\x1b\\"));
      expect(copied).toEqual(["Ghostty"]);
      expect(responses.join("")).toBe("\x1b]5522;type=write:status=DONE:id=42\x1b\\");
    } finally {
      term.free();
    }
  });
});

describe("mouseShape", () => {
  test("OSC 22で指定された形をCSSのcursorの名前で返し、指定が無ければtextを返す", () => {
    const term = createGhosttyTerminal(20, 5);
    try {
      expect(term.mouseShape()).toBe("text");
      term.write(encoder.encode("\x1b]22;pointer\x07"));
      expect(term.mouseShape()).toBe("pointer");
      term.write(encoder.encode("\x1b]22;nwse-resize\x1b\\"));
      expect(term.mouseShape()).toBe("nwse-resize");
      term.write(encoder.encode("\x1b]22;default\x07"));
      expect(term.mouseShape()).toBe("default");
    } finally {
      term.free();
    }
  });
});

describe("onSemanticPrompt", () => {
  function collect(chunks: string[]) {
    const term = createGhosttyTerminal(40, 5);
    try {
      const events: SemanticPromptEvent[] = [];
      term.onSemanticPrompt((e) => events.push(e));
      for (const chunk of chunks) term.write(encoder.encode(chunk));
      return events;
    } finally {
      term.free();
    }
  }

  test("OSC 133の各段階を受け取る（BEL終端・ST終端とも）", () => {
    expect(
      collect(["\x1b]133;A\x07$ \x1b]133;B\x1b\\", "\x1b]133;C\x07out\r\n\x1b]133;D;1\x07"]),
    ).toEqual([
      { kind: "promptStart", command: "", exitCode: null },
      { kind: "inputStart", command: "", exitCode: null },
      { kind: "outputStart", command: "", exitCode: null },
      { kind: "commandEnd", command: "", exitCode: 1 },
    ]);
  });

  test("Cのcmdline_urlをデコードしたコマンド行で受け取る", () => {
    expect(collect(["\x1b]133;C;cmdline_url=nvim%20%E3%83%A1%E3%83%A2.md%3Bx\x07"])).toEqual([
      { kind: "outputStart", command: "nvim メモ.md;x", exitCode: null },
    ]);
  });

  test("チャンクの境目で切れたシーケンスも受け取る", () => {
    const seq = "\x1b]133;C;cmdline_url=claude%20--continue\x07";
    for (let cut = 1; cut < seq.length; cut++) {
      expect(collect([`x${seq.slice(0, cut)}`, `${seq.slice(cut)}y`])).toEqual([
        { kind: "outputStart", command: "claude --continue", exitCode: null },
      ]);
    }
  });
});

describe("scrollPrompt", () => {
  // 2行プロンプト＋10行の出力を3回繰り返し、最後に入力待ちのプロンプトを置く。
  // プロンプトの1行目は0・12・24・36行目で、5行の画面ならアクティブエリアの先頭は33行目
  const prompt = "\x1b]133;A\x07info\r\n$ \x1b]133;B\x07";
  const block = (n: number) =>
    `${prompt}cmd${n}\r\n\x1b]133;C\x07${Array.from({ length: 10 }, (_, i) => `out${n}-${i}`).join("\r\n")}\r\n\x1b]133;D;0\x07`;
  const input = `${block(0)}${block(1)}${block(2)}${prompt}`;

  /** scrollPromptを順に呼び、呼ぶたびのビューポート先頭の行を返す */
  function offsetsAfter(deltas: number[]): number[] {
    const term = createGhosttyTerminal(20, 5);
    try {
      term.write(encoder.encode(input));
      return deltas.map((delta) => {
        term.scrollPrompt(delta);
        return term.scrollbar().offset;
      });
    } finally {
      term.free();
    }
  }

  test("前のプロンプトの1行目へ1つずつ戻り、先頭より前へは動かない", () => {
    expect(offsetsAfter([-1, -1, -1, -1])).toEqual([24, 12, 0, 0]);
  });

  test("次のプロンプトへは継続行に止まらず進み、アクティブエリア内のプロンプトでは最下部に留まる", () => {
    expect(offsetsAfter([-3, 1, 1, 1, 1])).toEqual([0, 12, 24, 33, 33]);
  });

  test("プロンプトマークが無ければ動かない", () => {
    const term = createGhosttyTerminal(20, 5);
    try {
      term.write(encoder.encode(Array.from({ length: 30 }, (_, i) => `${i}`).join("\r\n")));
      term.scrollToRow(10);
      term.scrollPrompt(-1);
      expect(term.scrollbar().offset).toBe(10);
      term.scrollPrompt(1);
      expect(term.scrollbar().offset).toBe(10);
    } finally {
      term.free();
    }
  });
});

describe("searchMatches", () => {
  /** 端末を作ってinputを流し込み、fnに渡す */
  function withTerminal<T>(
    cols: number,
    rows: number,
    input: string,
    fn: (term: ReturnType<typeof createGhosttyTerminal>) => T,
  ): T {
    const term = createGhosttyTerminal(cols, rows);
    try {
      term.write(encoder.encode(input));
      return fn(term);
    } finally {
      term.free();
    }
  }

  const byStart = (
    a: { start: { y: number; x: number } },
    b: { start: { y: number; x: number } },
  ) => a.start.y - b.start.y || a.start.x - b.start.x;

  test("スクロールバックの一致も画面座標で返す", () => {
    const lines = Array.from({ length: 50 }, (_, i) =>
      i === 3 || i === 40 ? `x needle ${i}` : `${i}`,
    );
    const matches = withTerminal(20, 5, lines.join("\r\n"), (term) =>
      term.searchMatches("needle", "all"),
    );
    expect(matches.sort(byStart)).toEqual([
      { start: { x: 2, y: 3 }, end: { x: 7, y: 3 } },
      { start: { x: 2, y: 40 }, end: { x: 7, y: 40 } },
    ]);
  });

  test("ASCIIの英字は大文字小文字を区別せずに一致する", () => {
    const matches = withTerminal(20, 3, "Foo foo FOO", (term) => term.searchMatches("foo", "all"));
    expect(matches).toHaveLength(3);
  });

  test("折り返された行をまたぐ一致は開始と終了の行が分かれる", () => {
    const matches = withTerminal(10, 3, "0123456foobar", (term) =>
      term.searchMatches("foobar", "all"),
    );
    expect(matches).toEqual([{ start: { x: 7, y: 0 }, end: { x: 2, y: 1 } }]);
  });

  test("全角文字は1文字2桁の座標で返す", () => {
    const matches = withTerminal(20, 3, "あいbc", (term) => term.searchMatches("いb", "all"));
    expect(matches).toEqual([{ start: { x: 2, y: 0 }, end: { x: 4, y: 0 } }]);
  });

  test("viewportはスクロール先のビューポートに掛かる一致を含む", () => {
    const lines = Array.from({ length: 2000 }, (_, i) => (i === 1500 ? "here" : `${i}`));
    const matches = withTerminal(20, 5, lines.join("\r\n"), (term) => {
      term.scrollToRow(1498);
      return term.searchMatches("here", "viewport");
    });
    expect(matches).toContainEqual({ start: { x: 0, y: 1500 }, end: { x: 3, y: 1500 } });
  });

  test("書き込みで増えた一致も同じ検索文字列のまま拾う", () => {
    const counts = withTerminal(20, 3, "foo\r\n", (term) => {
      const before = term.searchMatches("foo", "all").length;
      term.write(encoder.encode("foo\r\n"));
      return [before, term.searchMatches("foo", "all").length];
    });
    expect(counts).toEqual([1, 2]);
  });

  test("空文字列やclearSearchの後は何も返さない", () => {
    withTerminal(20, 3, "foo", (term) => {
      expect(term.searchMatches("", "all")).toEqual([]);
      expect(term.searchMatches("foo", "all")).toHaveLength(1);
      term.clearSearch();
      expect(term.searchMatches("bar", "all")).toEqual([]);
    });
  });
});

describe("onRenderHold", () => {
  test("同期出力の開始・終了を通知し、開始時点では後続の書きかけを処理していない", () => {
    const term = createGhosttyTerminal(20, 3);
    try {
      const events: Array<{ held: boolean; text: string }> = [];
      term.onRenderHold((held) => events.push({ held, text: term.dumpText().trim() }));
      term.write(encoder.encode("frame1\x1b[?2026h\x1b[2J\x1b[Hhalf"));
      expect(events).toEqual([{ held: true, text: "frame1" }]);
      term.write(encoder.encode("\x1b[2J\x1b[Hframe2\x1b[?2026l"));
      expect(events).toEqual([
        { held: true, text: "frame1" },
        { held: false, text: "frame2" },
      ]);
    } finally {
      term.free();
    }
  });

  test("releaseSyncOutputで解除すると通知せず、次の同期出力の開始をまた通知する", () => {
    const term = createGhosttyTerminal(20, 3);
    try {
      const events: boolean[] = [];
      term.onRenderHold((held) => events.push(held));
      term.write(encoder.encode("\x1b[?2026h"));
      term.releaseSyncOutput();
      term.write(encoder.encode("\x1b[?2026h"));
      expect(events).toEqual([true, true]);
    } finally {
      term.free();
    }
  });
});
