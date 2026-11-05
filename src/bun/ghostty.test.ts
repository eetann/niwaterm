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
