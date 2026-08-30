import { describe, expect, test } from "bun:test";
import {
  compileKeybindings,
  defaultKeybindings,
  defaultWindowsKeybindings,
} from "@niwaterm/config";
import { actionToTileCommand, createKeybindResolver, type KeydownResult } from "./tile-keybindings";

function key(
  k: string,
  opts: {
    metaKey?: boolean;
    ctrlKey?: boolean;
    altKey?: boolean;
    shiftKey?: boolean;
    code?: string;
  } = {},
): Parameters<ReturnType<typeof createKeybindResolver>["handleKeydown"]>[0] {
  return {
    key: k,
    code: "",
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    ...opts,
  };
}

const prefix = () => key("b", { ctrlKey: true });

describe("createKeybindResolver（デフォルトキーバインド・prefix方式）", () => {
  test("prefix(Ctrl+B)はconsumedを返し、2打目キー待ち状態に入る", () => {
    const resolver = createKeybindResolver(compileKeybindings(defaultKeybindings));
    expect(resolver.isAwaitingSecondKey()).toBe(false);
    const result = resolver.handleKeydown(prefix());
    expect(result).toEqual<KeydownResult>({ kind: "consumed" });
    expect(resolver.isAwaitingSecondKey()).toBe(true);
  });

  test("prefix -> d で垂直分割、待ち状態は解除される", () => {
    const resolver = createKeybindResolver(compileKeybindings(defaultKeybindings));
    resolver.handleKeydown(prefix());
    const result = resolver.handleKeydown(key("d"));
    expect(result).toEqual({
      kind: "command",
      command: { type: "split", orientation: "vertical" },
    });
    expect(resolver.isAwaitingSecondKey()).toBe(false);
  });

  test("prefix -> Shift+D で水平分割", () => {
    const resolver = createKeybindResolver(compileKeybindings(defaultKeybindings));
    resolver.handleKeydown(prefix());
    const result = resolver.handleKeydown(key("D", { shiftKey: true }));
    expect(result).toEqual({
      kind: "command",
      command: { type: "split", orientation: "horizontal" },
    });
  });

  test("prefix -> w でタイルを閉じる", () => {
    const resolver = createKeybindResolver(compileKeybindings(defaultKeybindings));
    resolver.handleKeydown(prefix());
    expect(resolver.handleKeydown(key("w"))).toEqual({
      kind: "command",
      command: { type: "close" },
    });
  });

  test("prefix -> z でタイルのズーム表示を切り替える（tmuxのbind-key z resize-pane -Zを踏襲）", () => {
    const resolver = createKeybindResolver(compileKeybindings(defaultKeybindings));
    resolver.handleKeydown(prefix());
    expect(resolver.handleKeydown(key("z"))).toEqual({
      kind: "command",
      command: { type: "toggleZoom" },
    });
  });

  test.each([
    ["ArrowUp", "up"],
    ["ArrowDown", "down"],
    ["ArrowLeft", "left"],
    ["ArrowRight", "right"],
  ] as const)("prefix -> %s でフォーカス移動(%s)", (arrow, direction) => {
    const resolver = createKeybindResolver(compileKeybindings(defaultKeybindings));
    resolver.handleKeydown(prefix());
    expect(resolver.handleKeydown(key(arrow))).toEqual({
      kind: "command",
      command: { type: "focus", direction },
    });
  });

  test("prefix -> c で新規タブ作成", () => {
    const resolver = createKeybindResolver(compileKeybindings(defaultKeybindings));
    resolver.handleKeydown(prefix());
    expect(resolver.handleKeydown(key("c"))).toEqual({
      kind: "command",
      command: { type: "newTab" },
    });
  });

  test("prefix -> Shift+T でブラウザタブ新規作成", () => {
    const resolver = createKeybindResolver(compileKeybindings(defaultKeybindings));
    resolver.handleKeydown(prefix());
    expect(resolver.handleKeydown(key("T", { shiftKey: true }))).toEqual({
      kind: "command",
      command: { type: "newBrowserTab" },
    });
  });

  test("prefix -> n / p でタブ切替", () => {
    const nextResolver = createKeybindResolver(compileKeybindings(defaultKeybindings));
    nextResolver.handleKeydown(prefix());
    expect(nextResolver.handleKeydown(key("n"))).toEqual({
      kind: "command",
      command: { type: "cycleTab", delta: 1 },
    });

    const prevResolver = createKeybindResolver(compileKeybindings(defaultKeybindings));
    prevResolver.handleKeydown(prefix());
    expect(prevResolver.handleKeydown(key("p"))).toEqual({
      kind: "command",
      command: { type: "cycleTab", delta: -1 },
    });
  });

  test("prefix -> Shift+N でワークスペース新規作成", () => {
    const resolver = createKeybindResolver(compileKeybindings(defaultKeybindings));
    resolver.handleKeydown(prefix());
    expect(resolver.handleKeydown(key("N", { shiftKey: true }))).toEqual({
      kind: "command",
      command: { type: "newWorkspace" },
    });
  });

  test("prefix -> ] / [ でワークスペース切替", () => {
    const nextResolver = createKeybindResolver(compileKeybindings(defaultKeybindings));
    nextResolver.handleKeydown(prefix());
    expect(nextResolver.handleKeydown(key("]", { code: "BracketRight" }))).toEqual({
      kind: "command",
      command: { type: "switchWorkspace", delta: 1 },
    });

    const prevResolver = createKeybindResolver(compileKeybindings(defaultKeybindings));
    prevResolver.handleKeydown(prefix());
    expect(prevResolver.handleKeydown(key("[", { code: "BracketLeft" }))).toEqual({
      kind: "command",
      command: { type: "switchWorkspace", delta: -1 },
    });
  });

  test("next-board / prev-board はBoard切替コマンドへ変換される", () => {
    expect(actionToTileCommand("next-board")).toEqual({ type: "switchBoard", delta: 1 });
    expect(actionToTileCommand("prev-board")).toEqual({ type: "switchBoard", delta: -1 });
  });

  test("prefix -> b でサイドバートグル", () => {
    const resolver = createKeybindResolver(compileKeybindings(defaultKeybindings));
    resolver.handleKeydown(prefix());
    expect(resolver.handleKeydown(key("b"))).toEqual({
      kind: "command",
      command: { type: "toggleSidebar" },
    });
  });

  test("prefix -> ` でポップアップトグル", () => {
    const resolver = createKeybindResolver(compileKeybindings(defaultKeybindings));
    resolver.handleKeydown(prefix());
    expect(resolver.handleKeydown(key("`", { code: "Backquote" }))).toEqual({
      kind: "command",
      command: { type: "togglePopup" },
    });
  });

  test("prefix -> PageUp/PageDown でページ単位スクロール", () => {
    const upResolver = createKeybindResolver(compileKeybindings(defaultKeybindings));
    upResolver.handleKeydown(prefix());
    expect(upResolver.handleKeydown(key("PageUp"))).toEqual({
      kind: "command",
      command: { type: "scrollPage", direction: "up" },
    });

    const downResolver = createKeybindResolver(compileKeybindings(defaultKeybindings));
    downResolver.handleKeydown(prefix());
    expect(downResolver.handleKeydown(key("PageDown"))).toEqual({
      kind: "command",
      command: { type: "scrollPage", direction: "down" },
    });
  });

  test("prefix -> Home/End でスクロールバック先頭/最新行へ", () => {
    const homeResolver = createKeybindResolver(compileKeybindings(defaultKeybindings));
    homeResolver.handleKeydown(prefix());
    expect(homeResolver.handleKeydown(key("Home"))).toEqual({
      kind: "command",
      command: { type: "scrollToEdge", edge: "top" },
    });

    const endResolver = createKeybindResolver(compileKeybindings(defaultKeybindings));
    endResolver.handleKeydown(prefix());
    expect(endResolver.handleKeydown(key("End"))).toEqual({
      kind: "command",
      command: { type: "scrollToEdge", edge: "bottom" },
    });
  });

  test("prefix -> =/-/0 でフォントサイズ拡大/縮小/リセット", () => {
    const increaseResolver = createKeybindResolver(compileKeybindings(defaultKeybindings));
    increaseResolver.handleKeydown(prefix());
    expect(increaseResolver.handleKeydown(key("="))).toEqual({
      kind: "command",
      command: { type: "increaseFontSize" },
    });

    const decreaseResolver = createKeybindResolver(compileKeybindings(defaultKeybindings));
    decreaseResolver.handleKeydown(prefix());
    expect(decreaseResolver.handleKeydown(key("-"))).toEqual({
      kind: "command",
      command: { type: "decreaseFontSize" },
    });

    const resetResolver = createKeybindResolver(compileKeybindings(defaultKeybindings));
    resetResolver.handleKeydown(prefix());
    expect(resetResolver.handleKeydown(key("0"))).toEqual({
      kind: "command",
      command: { type: "resetFontSize" },
    });
  });

  test("prefix -> 未割り当てキーはconsumedでキャンセルされる（PTYには送らない）", () => {
    const resolver = createKeybindResolver(compileKeybindings(defaultKeybindings));
    resolver.handleKeydown(prefix());
    expect(resolver.handleKeydown(key("q"))).toEqual({ kind: "consumed" });
    expect(resolver.isAwaitingSecondKey()).toBe(false);
  });

  test("prefix -> Escape でキャンセルされる", () => {
    const resolver = createKeybindResolver(compileKeybindings(defaultKeybindings));
    resolver.handleKeydown(prefix());
    expect(resolver.handleKeydown(key("Escape"))).toEqual({ kind: "consumed" });
    expect(resolver.isAwaitingSecondKey()).toBe(false);
  });

  test("prefix待ち中の修飾キー単体（Shift等）は無視され、待ち状態が維持される", () => {
    const resolver = createKeybindResolver(compileKeybindings(defaultKeybindings));
    resolver.handleKeydown(prefix());
    expect(resolver.handleKeydown(key("Shift", { shiftKey: true }))).toEqual({ kind: "consumed" });
    expect(resolver.isAwaitingSecondKey()).toBe(true);
    // Shift単体の後にDが来て初めてShift+Dのシーケンスとして解決される
    expect(resolver.handleKeydown(key("D", { shiftKey: true }))).toEqual({
      kind: "command",
      command: { type: "split", orientation: "horizontal" },
    });
  });

  test("prefixキーを押していない通常のキーはpassthrough（ターミナル入力に委ねる）", () => {
    const resolver = createKeybindResolver(compileKeybindings(defaultKeybindings));
    expect(resolver.handleKeydown(key("d"))).toEqual({ kind: "passthrough" });
    expect(resolver.handleKeydown(key("d", { metaKey: true }))).toEqual({ kind: "passthrough" });
    expect(resolver.handleKeydown(key("ArrowUp"))).toEqual({ kind: "passthrough" });
  });

  test("reset()で2打目キー待ち状態を強制解除できる", () => {
    const resolver = createKeybindResolver(compileKeybindings(defaultKeybindings));
    resolver.handleKeydown(prefix());
    expect(resolver.isAwaitingSecondKey()).toBe(true);
    resolver.reset();
    expect(resolver.isAwaitingSecondKey()).toBe(false);
    // リセット後のdは2打目キーとしてではなく通常入力として扱われる
    expect(resolver.handleKeydown(key("d"))).toEqual({ kind: "passthrough" });
  });

  test("new-custom-view-tabはデフォルトでは何もキーに割り当てられていない（customView未設定時は無意味なため）", () => {
    const customCompiled = compileKeybindings({
      prefix: "ctrl+b",
      bindings: { "shift+u": "new-custom-view-tab" },
    });
    const resolver = createKeybindResolver(customCompiled);
    resolver.handleKeydown(prefix());
    expect(resolver.handleKeydown(key("U", { shiftKey: true }))).toEqual({
      kind: "command",
      command: { type: "newCustomViewTab" },
    });
  });
});

describe("createKeybindResolver（direct: 即時発火ショートカット）", () => {
  test("Windows既定: Ctrl+Shift+C -> 選択テキストをコピー（prefix不要で即時発火）", () => {
    const resolver = createKeybindResolver(compileKeybindings(defaultWindowsKeybindings));
    expect(resolver.handleKeydown(key("C", { ctrlKey: true, shiftKey: true }))).toEqual({
      kind: "command",
      command: { type: "copySelection" },
    });
  });

  test("Windows既定: Ctrl+Shift+V -> クリップボードから貼り付け", () => {
    const resolver = createKeybindResolver(compileKeybindings(defaultWindowsKeybindings));
    expect(resolver.handleKeydown(key("V", { ctrlKey: true, shiftKey: true }))).toEqual({
      kind: "command",
      command: { type: "pasteClipboard" },
    });
  });

  test("macOS既定にはdirectショートカットが無い（ApplicationMenu経由でCmd+C/Vが機能するため）", () => {
    const resolver = createKeybindResolver(compileKeybindings(defaultKeybindings));
    expect(resolver.handleKeydown(key("c", { ctrlKey: true, shiftKey: true }))).toEqual({
      kind: "passthrough",
    });
  });

  test("Ctrl+C単体はターミナルの制御文字なのでpassthrough", () => {
    const resolver = createKeybindResolver(compileKeybindings(defaultWindowsKeybindings));
    expect(resolver.handleKeydown(key("c", { ctrlKey: true }))).toEqual({ kind: "passthrough" });
  });

  test("altキー単独のdirectも即時発火する（tmuxのbind-key -n M-key相当）", () => {
    const custom = compileKeybindings({ direct: { "alt+h": "focus-left" } });
    const resolver = createKeybindResolver(custom);
    expect(resolver.handleKeydown(key("h", { altKey: true }))).toEqual({
      kind: "command",
      command: { type: "focus", direction: "left" },
    });
  });
});

describe("createKeybindResolver（カスタムprefix・カスタムbindings）", () => {
  test("prefixキーを変更できる", () => {
    const custom = compileKeybindings({ prefix: "cmd+j", bindings: { d: "close-tile" } });
    const resolver = createKeybindResolver(custom);
    expect(resolver.handleKeydown(key("j", { metaKey: true }))).toEqual({ kind: "consumed" });
    expect(resolver.handleKeydown(key("d"))).toEqual({
      kind: "command",
      command: { type: "close" },
    });
  });

  test("設定で上書きした2打目キーは新しいアクションに切り替わる", () => {
    const custom = compileKeybindings({ prefix: "ctrl+b", bindings: { d: "close-tile" } });
    const resolver = createKeybindResolver(custom);
    resolver.handleKeydown(prefix());
    expect(resolver.handleKeydown(key("d"))).toEqual({
      kind: "command",
      command: { type: "close" },
    });
  });

  test("マージされていない単独テーブルでは他のキーはconsumed（未割当）になる", () => {
    const custom = compileKeybindings({ prefix: "ctrl+b", bindings: { d: "close-tile" } });
    const resolver = createKeybindResolver(custom);
    resolver.handleKeydown(prefix());
    expect(resolver.handleKeydown(key("w"))).toEqual({ kind: "consumed" });
  });

  test("restart-tabはデフォルトバインド無しのため、ユーザー設定で割り当てて初めて発火する", () => {
    const custom = compileKeybindings({ prefix: "ctrl+b", bindings: { r: "restart-tab" } });
    const resolver = createKeybindResolver(custom);
    resolver.handleKeydown(prefix());
    expect(resolver.handleKeydown(key("r"))).toEqual({
      kind: "command",
      command: { type: "restartTab" },
    });
  });

  test("reload-configはデフォルトバインド無しのため、ユーザー設定で割り当てて初めて発火する", () => {
    const custom = compileKeybindings({ prefix: "ctrl+b", bindings: { r: "reload-config" } });
    const resolver = createKeybindResolver(custom);
    resolver.handleKeydown(prefix());
    expect(resolver.handleKeydown(key("r"))).toEqual({
      kind: "command",
      command: { type: "reloadConfig" },
    });
  });
});

describe("createKeybindResolver（niwa.keybindの関数ハンドラ = custom BindingTarget）", () => {
  test("bindingsのcustom BindingTargetはcustom TileCommandになる", () => {
    const custom = compileKeybindings({
      prefix: "ctrl+b",
      bindings: { m: { kind: "custom", id: "handler-0" } },
    });
    const resolver = createKeybindResolver(custom);
    resolver.handleKeydown(prefix());
    expect(resolver.handleKeydown(key("m"))).toEqual({
      kind: "command",
      command: { type: "custom", handlerId: "handler-0" },
    });
  });

  test("directのcustom BindingTargetもcustom TileCommandになる", () => {
    const custom = compileKeybindings({
      direct: { "cmd+shift+g": { kind: "custom", id: "handler-1" } },
    });
    const resolver = createKeybindResolver(custom);
    expect(resolver.handleKeydown(key("g", { metaKey: true, shiftKey: true }))).toEqual({
      kind: "command",
      command: { type: "custom", handlerId: "handler-1" },
    });
  });
});

describe("createKeybindResolver（repeat機構: tmuxのbind-key -r相当）", () => {
  function createClock(start = 0) {
    let t = start;
    return { now: () => t, advance: (ms: number) => (t += ms) };
  }

  test("prefix -> h（repeat:true）発火後、窓内ならprefix無しで連打できる", () => {
    const clock = createClock();
    const compiled = compileKeybindings({
      prefix: "ctrl+b",
      bindings: { h: { target: "resize-left", repeat: true } },
      repeatTimeoutMs: 500,
    });
    const resolver = createKeybindResolver(compiled, { now: clock.now });

    resolver.handleKeydown(prefix());
    expect(resolver.handleKeydown(key("h"))).toEqual({
      kind: "command",
      command: { type: "resize", direction: "left" },
    });
    expect(resolver.isRepeating()).toBe(true);

    // prefix無しでhを連打できる
    clock.advance(100);
    expect(resolver.handleKeydown(key("h"))).toEqual({
      kind: "command",
      command: { type: "resize", direction: "left" },
    });
  });

  test("repeatTimeoutMsを超えるとprefix無しの入力はpassthroughに戻る", () => {
    const clock = createClock();
    const compiled = compileKeybindings({
      prefix: "ctrl+b",
      bindings: { h: { target: "resize-left", repeat: true } },
      repeatTimeoutMs: 500,
    });
    const resolver = createKeybindResolver(compiled, { now: clock.now });

    resolver.handleKeydown(prefix());
    resolver.handleKeydown(key("h"));

    clock.advance(501);
    expect(resolver.handleKeydown(key("h"))).toEqual({ kind: "passthrough" });
    expect(resolver.isRepeating()).toBe(false);
  });

  test("repeat:trueでないバインドは1回発火したらリピート窓に入らない", () => {
    const clock = createClock();
    const compiled = compileKeybindings(defaultKeybindings);
    const resolver = createKeybindResolver(compiled, { now: clock.now });

    resolver.handleKeydown(prefix());
    resolver.handleKeydown(key("d")); // split-vertical（repeat未指定）
    expect(resolver.isRepeating()).toBe(false);

    // prefix無しでdを押しても通常のターミナル入力として扱われる
    expect(resolver.handleKeydown(key("d"))).toEqual({ kind: "passthrough" });
  });

  test("リピート窓中に別のrepeatableキーへ切り替えても発火し続ける（tmuxのH/J/K/L相当）", () => {
    const clock = createClock();
    const compiled = compileKeybindings({
      prefix: "ctrl+b",
      bindings: {
        h: { target: "resize-left", repeat: true },
        l: { target: "resize-right", repeat: true },
      },
      repeatTimeoutMs: 500,
    });
    const resolver = createKeybindResolver(compiled, { now: clock.now });

    resolver.handleKeydown(prefix());
    resolver.handleKeydown(key("h"));
    clock.advance(100);
    expect(resolver.handleKeydown(key("l"))).toEqual({
      kind: "command",
      command: { type: "resize", direction: "right" },
    });
  });

  test("リピート窓中に未割当キーを押すと窓がキャンセルされる", () => {
    const clock = createClock();
    const compiled = compileKeybindings({
      prefix: "ctrl+b",
      bindings: { h: { target: "resize-left", repeat: true } },
      repeatTimeoutMs: 500,
    });
    const resolver = createKeybindResolver(compiled, { now: clock.now });

    resolver.handleKeydown(prefix());
    resolver.handleKeydown(key("h"));
    expect(resolver.handleKeydown(key("z"))).toEqual({ kind: "passthrough" });
    expect(resolver.isRepeating()).toBe(false);

    // 窓が閉じた後はhもprefixが再度必要
    expect(resolver.handleKeydown(key("h"))).toEqual({ kind: "passthrough" });
  });

  test("リピート窓中に新規prefix入力があれば、リピートではなく2打目キー待ちとして扱われる", () => {
    const clock = createClock();
    const compiled = compileKeybindings({
      prefix: "ctrl+b",
      bindings: { h: { target: "resize-left", repeat: true } },
      repeatTimeoutMs: 500,
    });
    const resolver = createKeybindResolver(compiled, { now: clock.now });

    resolver.handleKeydown(prefix());
    resolver.handleKeydown(key("h"));
    expect(resolver.isRepeating()).toBe(true);

    expect(resolver.handleKeydown(prefix())).toEqual({ kind: "consumed" });
    expect(resolver.isAwaitingSecondKey()).toBe(true);
    expect(resolver.isRepeating()).toBe(false);
  });

  test("修飾キー単体（Shift等）はリピート窓を破棄しない", () => {
    const clock = createClock();
    const compiled = compileKeybindings({
      prefix: "ctrl+b",
      bindings: { h: { target: "resize-left", repeat: true } },
      repeatTimeoutMs: 500,
    });
    const resolver = createKeybindResolver(compiled, { now: clock.now });

    resolver.handleKeydown(prefix());
    resolver.handleKeydown(key("h"));
    resolver.handleKeydown(key("Shift", { shiftKey: true }));
    expect(resolver.isRepeating()).toBe(true);
  });

  test("reset()でリピート窓も強制解除される", () => {
    const clock = createClock();
    const compiled = compileKeybindings({
      prefix: "ctrl+b",
      bindings: { h: { target: "resize-left", repeat: true } },
      repeatTimeoutMs: 500,
    });
    const resolver = createKeybindResolver(compiled, { now: clock.now });

    resolver.handleKeydown(prefix());
    resolver.handleKeydown(key("h"));
    expect(resolver.isRepeating()).toBe(true);

    resolver.reset();
    expect(resolver.isRepeating()).toBe(false);
    expect(resolver.handleKeydown(key("h"))).toEqual({ kind: "passthrough" });
  });

  test("isRepeatingはリピート窓が開いていない間は常にfalse", () => {
    const resolver = createKeybindResolver(compileKeybindings(defaultKeybindings));
    expect(resolver.isRepeating()).toBe(false);
    resolver.handleKeydown(prefix());
    expect(resolver.isRepeating()).toBe(false);
  });
});
