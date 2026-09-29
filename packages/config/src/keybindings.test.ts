import { describe, expect, test } from "bun:test";
import {
  canonicalizeParsed,
  canonicalizeSecondKey,
  compileKeybindings,
  DEFAULT_REPEAT_TIMEOUT_MS,
  defaultKeybindings,
  defaultWindowsKeybindings,
  isBindingTarget,
  isCustomBindingRef,
  isDetailedBinding,
  isKeybindAction,
  KEYBIND_ACTIONS,
  parseKeyBindingString,
  parseSecondKeyString,
  parseShowSidebarViewAction,
  platformDefaultKeybindings,
  resolveBindingEntry,
} from "./keybindings";

describe("parseKeyBindingString", () => {
  test("cmd+key を解析できる", () => {
    expect(parseKeyBindingString("cmd+d")).toEqual({
      cmd: true,
      ctrl: false,
      shift: false,
      alt: false,
      key: "d",
    });
  });

  test("cmd+shift+key を解析できる", () => {
    expect(parseKeyBindingString("cmd+shift+d")).toEqual({
      cmd: true,
      ctrl: false,
      shift: true,
      alt: false,
      key: "d",
    });
  });

  test("cmd+alt+key を解析できる", () => {
    expect(parseKeyBindingString("cmd+alt+up")).toEqual({
      cmd: true,
      ctrl: false,
      shift: false,
      alt: true,
      key: "up",
    });
  });

  test("ctrl+key を解析できる（prefixキーの既定形）", () => {
    expect(parseKeyBindingString("ctrl+b")).toEqual({
      cmd: false,
      ctrl: true,
      shift: false,
      alt: false,
      key: "b",
    });
  });

  test("修飾子4つの組み合わせも解析できる", () => {
    expect(parseKeyBindingString("ctrl+shift+alt+t")).toEqual({
      cmd: false,
      ctrl: true,
      shift: true,
      alt: true,
      key: "t",
    });
  });

  test("大文字混じりも許容する", () => {
    expect(parseKeyBindingString("Cmd+Shift+D")).toEqual({
      cmd: true,
      ctrl: false,
      shift: true,
      alt: false,
      key: "d",
    });
  });

  test("alt+key を解析できる（noPrefix用、tmuxの-n M-key相当）", () => {
    expect(parseKeyBindingString("alt+d")).toEqual({
      cmd: false,
      ctrl: false,
      shift: false,
      alt: true,
      key: "d",
    });
  });

  test("cmd/ctrl/altのいずれも含まない場合はnull", () => {
    expect(parseKeyBindingString("shift+d")).toBeNull();
  });

  test("未知の修飾子を含む場合はnull", () => {
    expect(parseKeyBindingString("hyper+d")).toBeNull();
  });

  test("キー本体が無い場合はnull", () => {
    expect(parseKeyBindingString("cmd+")).toBeNull();
  });

  test("修飾子が無い単独キーはnull（cmd/ctrl/altのいずれか必須のため）", () => {
    expect(parseKeyBindingString("d")).toBeNull();
  });
});

describe("canonicalizeParsed", () => {
  test("修飾子の有無とkeyから一意な文字列を生成する", () => {
    const base = { cmd: false, ctrl: false, shift: false, alt: false };
    expect(canonicalizeParsed({ ...base, cmd: true, key: "d" })).toBe("1000:d");
    expect(canonicalizeParsed({ ...base, cmd: true, shift: true, key: "d" })).toBe("1010:d");
    expect(canonicalizeParsed({ ...base, cmd: true, alt: true, key: "up" })).toBe("1001:up");
    expect(canonicalizeParsed({ ...base, ctrl: true, shift: true, key: "d" })).toBe("0110:d");
  });

  test("cmdとctrlは区別される", () => {
    const base = { shift: false, alt: false, key: "d" };
    expect(canonicalizeParsed({ ...base, cmd: true, ctrl: false })).not.toBe(
      canonicalizeParsed({ ...base, cmd: false, ctrl: true }),
    );
  });
});

describe("parseSecondKeyString", () => {
  test("修飾子なしの単一キーを解析できる", () => {
    expect(parseSecondKeyString("d")).toEqual({ shift: false, alt: false, key: "d" });
  });

  test("shift+key を解析できる", () => {
    expect(parseSecondKeyString("shift+d")).toEqual({ shift: true, alt: false, key: "d" });
  });

  test("alt+key を解析できる", () => {
    expect(parseSecondKeyString("alt+d")).toEqual({ shift: false, alt: true, key: "d" });
  });

  test("shift+alt+key を解析できる", () => {
    expect(parseSecondKeyString("shift+alt+d")).toEqual({ shift: true, alt: true, key: "d" });
  });

  test("矢印キー・記号キーも解析できる", () => {
    expect(parseSecondKeyString("up")).toEqual({ shift: false, alt: false, key: "up" });
    expect(parseSecondKeyString("[")).toEqual({ shift: false, alt: false, key: "[" });
  });

  test("大文字混じりも許容する", () => {
    expect(parseSecondKeyString("Shift+D")).toEqual({ shift: true, alt: false, key: "d" });
  });

  test("cmd/ctrlを含む場合はnull（2打目はshift/altのみ許容）", () => {
    expect(parseSecondKeyString("cmd+d")).toBeNull();
    expect(parseSecondKeyString("ctrl+d")).toBeNull();
  });

  test("未知の修飾子を含む場合はnull", () => {
    expect(parseSecondKeyString("hyper+d")).toBeNull();
  });

  test("キー本体が無い場合はnull", () => {
    expect(parseSecondKeyString("shift+")).toBeNull();
  });
});

describe("canonicalizeSecondKey", () => {
  test("修飾子の有無とkeyから一意な文字列を生成する", () => {
    expect(canonicalizeSecondKey({ shift: false, alt: false, key: "d" })).toBe("00:d");
    expect(canonicalizeSecondKey({ shift: true, alt: false, key: "d" })).toBe("10:d");
    expect(canonicalizeSecondKey({ shift: false, alt: true, key: "d" })).toBe("01:d");
    expect(canonicalizeSecondKey({ shift: true, alt: true, key: "d" })).toBe("11:d");
  });
});

describe("isKeybindAction", () => {
  test("KEYBIND_ACTIONSに含まれる文字列はtrue", () => {
    for (const action of KEYBIND_ACTIONS) {
      expect(isKeybindAction(action)).toBe(true);
    }
  });

  test("show-sidebar-view:<id>は対象idが付いていればtrue", () => {
    expect(isKeybindAction("show-sidebar-view:notes")).toBe(true);
    expect(isKeybindAction("show-sidebar-view:workspaces")).toBe(true);
  });

  test("未知の文字列や非文字列はfalse", () => {
    expect(isKeybindAction("unknown-action")).toBe(false);
    expect(isKeybindAction(123)).toBe(false);
    expect(isKeybindAction(null)).toBe(false);
  });

  test("対象idの無いshow-sidebar-view:はfalse", () => {
    expect(isKeybindAction("show-sidebar-view:")).toBe(false);
    expect(isKeybindAction("show-sidebar-view")).toBe(false);
  });
});

describe("parseShowSidebarViewAction", () => {
  test("show-sidebar-view:<id>から対象idを取り出す", () => {
    expect(parseShowSidebarViewAction("show-sidebar-view:notes")).toBe("notes");
  });

  test("他のアクション・id部分が空ならnull", () => {
    expect(parseShowSidebarViewAction("toggle-sidebar")).toBeNull();
    expect(parseShowSidebarViewAction("show-sidebar-view:")).toBeNull();
  });
});

// bindingsに既定キーを持たないアクション。理由はケースごとに異なる（下記テスト参照）
const UNASSIGNED_BINDING_ACTIONS = [
  "new-custom-view-tab",
  "copy-selection",
  "paste-clipboard",
  // resize-up/down/left/rightは既定キーを持たない（ユーザーがconfigで任意に、必要ならrepeat:true付きで割り当てる想定）
  "resize-up",
  "resize-down",
  "resize-left",
  "resize-right",
  // restart-tabも同様に既定キーを持たない（respawn-pane相当の破壊的操作のため、tmux文化を踏襲し
  // ユーザーが明示的に割り当てる想定。実行前にy/n確認ダイアログを挟む）
  "restart-tab",
  // reload-configも同様に既定キーを持たない（設定ファイルの手動リロードは使う人・使わない人が
  // 分かれる操作のため、ユーザーが明示的に割り当てる想定）
  "reload-config",
  // next-board/prev-boardも既定キーを持たない（2打目キーのn/pはタブ切替、]/[はワークスペース切替に
  // 埋まっており、Board切替に自然に割り当てられる空きキーが無いため。tmuxのM-n/M-p風に
  // directで割り当てる等、ユーザーの好みに委ねる）
  "next-board",
  "prev-board",
  // move-workspace-up/down・move-board-up/downも既定キーを持たない（並び替えはサイドバーのD&D・
  // コマンドパレット・CLIから行える操作で、キーを常用する人だけがconfigで割り当てる想定）
  "move-workspace-up",
  "move-workspace-down",
  "move-board-up",
  "move-board-down",
  // move-board-to-workspaceも同様（移動先ワークスペースを選ぶピッカーが開く操作で、
  // 並び替え系と同じくキーを常用する人だけがconfigで割り当てる想定）
  "move-board-to-workspace",
  // set-board-worktreeも既定キーを持たない（一度紐づければ張り替える機会は少なく、
  // サイドバーの右クリック・コマンドパレット・CLIから行える操作のため）
  "set-board-worktree",
  // set-board-phase（候補を選ぶピッカー）・clear-board-phaseも既定キーを持たない
  // （フェーズの付け外しはサイドバーの右クリック・コマンドパレット・CLIから行える操作で、
  // board.phasesを定義した人だけが使う機能のため）
  "set-board-phase",
  "clear-board-phase",

  // clear-board-startupも既定キーを持たない（起動時レイアウトの付け外しはサイドバーの右クリック・
  // コマンドパレット・CLIから行える操作で、付ける側のプリセット選択がキーで完結しないため）
  "clear-board-startup",
  // prev-sidebar-viewも既定キーを持たない（customViewが1つだけならnext-sidebar-viewの往復で足りるため）
  "prev-sidebar-view",
  // toggle-status-bar・refresh-status-barも既定キーを持たない（バーを隠すのは画面を広く使いたい人の
  // 好みで、再描画は外部の状態を読むrenderを書いた人だけが要る操作のため）
  "toggle-status-bar",
  "refresh-status-bar",
  // close-boardは既定キーを持たない（Boardを中のタブごと消す破壊的操作で、tmuxにもbind-key &（確認付きの
  // kill-window）に相当するキーしか無いため。ユーザーの好みに委ねる）
  "close-board",
  // rename-workspace/close-workspaceも既定キーを持たない（ワークスペース側の2打目キーは
  // shift+n（新規）・]/[（切替）で埋まっており、rename-board（,）に対応する空きも無いため）
  "rename-workspace",
  "close-workspace",
  // close-windowも既定キーを持たない（OSのクローズボタン・Cmd+W等のOS標準操作で閉じられるうえ、
  // ウィンドウ内のプロセスがまとめて落ちる破壊的操作のため、restart-tabと同じくユーザーが
  // 明示的に割り当てる想定）
  "close-window",
  // promote-popupも既定キーを持たない（ポップアップのツールバーにボタンがあり、
  // 開閉のtoggle-popup（`）ほど頻度が高くないため）
  "promote-popup",
  // quit-appも既定キーを持たない（全ウィンドウのプロセスがまとめて落ちる最も破壊的な操作で、
  // OSのCmd+Q・×ボタンで代替できるため。実行前にy/n確認ダイアログを挟む）
  "quit-app",
];

describe("defaultKeybindings", () => {
  test("prefixはCtrl+B（tmux標準）", () => {
    expect(defaultKeybindings.prefix).toBe("ctrl+b");
  });

  test("UNASSIGNED_BINDING_ACTIONS以外の36個のアクションに1つずつ割り当てられている", () => {
    const actions = Object.values(defaultKeybindings.bindings ?? {});
    expect(actions.length).toBe(36);
    expect(new Set(actions).size).toBe(36);
    for (const action of KEYBIND_ACTIONS) {
      if (UNASSIGNED_BINDING_ACTIONS.includes(action)) continue;
      expect(actions).toContain(action);
    }
  });

  test("new-custom-view-tabはcustomView未設定時に無意味なため既定キーを持たない（ユーザー設定での割り当てを想定）", () => {
    expect(Object.values(defaultKeybindings.bindings ?? {})).not.toContain("new-custom-view-tab");
  });

  test("new-boardはprefix + c（tmuxのbind-key c new-windowを踏襲する）", () => {
    expect(defaultKeybindings.bindings?.["c"]).toBe("new-board");
  });

  test("new-tabはprefix + t（new-browser-tabのshift+tと対で覚えられる）", () => {
    expect(defaultKeybindings.bindings?.["t"]).toBe("new-tab");
  });

  test("rename-boardはprefix + ,（tmuxのbind-key , rename-windowを踏襲する）", () => {
    expect(defaultKeybindings.bindings?.[","]).toBe("rename-board");
  });

  test("copy-modeはprefix + v（[はワークスペース切替に使っているため、viのvisualモードを連想させるv）", () => {
    expect(defaultKeybindings.bindings?.["v"]).toBe("copy-mode");
  });

  test("focus-url-barはprefix + u（lはhjklのタイル移動に使われがちなためURLの頭文字を充てる）", () => {
    expect(defaultKeybindings.bindings?.["u"]).toBe("focus-url-bar");
  });

  test("next-sidebar-viewはprefix + shift+b（サイドバートグルのbと同系列で覚えられる）", () => {
    expect(defaultKeybindings.bindings?.["shift+b"]).toBe("next-sidebar-view");
  });

  test("copy-selection/paste-clipboardはCmd+C/VがApplicationMenu経由で既に機能するため既定キーを持たない", () => {
    expect(Object.values(defaultKeybindings.bindings ?? {})).not.toContain("copy-selection");
    expect(Object.values(defaultKeybindings.bindings ?? {})).not.toContain("paste-clipboard");
    expect(defaultKeybindings.direct ?? {}).toEqual({});
  });
});

describe("defaultWindowsKeybindings", () => {
  test("prefix・2打目キーの割り当てはmacOS版と共通（Ctrl+B）", () => {
    expect(defaultWindowsKeybindings.prefix).toBe("ctrl+b");
    expect(defaultWindowsKeybindings.bindings).toEqual(defaultKeybindings.bindings);
  });

  test("directにCtrl+Shift+C/Vでコピー・ペーストが割り当てられている", () => {
    expect(defaultWindowsKeybindings.direct).toEqual({
      "ctrl+shift+c": "copy-selection",
      "ctrl+shift+v": "paste-clipboard",
    });
  });

  test("directの全エントリがctrl始まりで、ターミナルの制御文字と衝突しないようshiftを伴う", () => {
    for (const binding of Object.keys(defaultWindowsKeybindings.direct ?? {})) {
      const parsed = parseKeyBindingString(binding);
      expect(parsed).not.toBeNull();
      expect(parsed?.ctrl).toBe(true);
      expect(parsed?.cmd).toBe(false);
      expect(parsed?.shift === true || parsed?.alt === true).toBe(true);
    }
  });
});

describe("platformDefaultKeybindings", () => {
  test("win32ではWindows用、それ以外はmacOS用を返す", () => {
    expect(platformDefaultKeybindings("win32")).toBe(defaultWindowsKeybindings);
    expect(platformDefaultKeybindings("darwin")).toBe(defaultKeybindings);
  });
});

describe("compileKeybindings", () => {
  test("prefixはparseKeyBindingStringでパースされる", () => {
    const compiled = compileKeybindings({ prefix: "ctrl+b" });
    expect(compiled.prefix).toEqual({ cmd: false, ctrl: true, shift: false, alt: false, key: "b" });
  });

  test("prefix未指定はnull", () => {
    const compiled = compileKeybindings({});
    expect(compiled.prefix).toBeNull();
  });

  test("不正なprefix文字列はnull", () => {
    const compiled = compileKeybindings({ prefix: "hyper+b" as never });
    expect(compiled.prefix).toBeNull();
  });

  test("bindingsの正常なエントリはcanonicalizeSecondKeyされたキーでMapに入る（repeatは既定false）", () => {
    const compiled = compileKeybindings({ bindings: { d: "split-vertical" } });
    expect(compiled.bindings.get("00:d")).toEqual({ target: "split-vertical", repeat: false });
    expect(compiled.bindings.size).toBe(1);
  });

  test("bindingsのrepeat:true付きエントリはrepeat:trueのままMapに入る", () => {
    const compiled = compileKeybindings({
      bindings: { h: { target: "resize-left", repeat: true } },
    });
    expect(compiled.bindings.get("00:h")).toEqual({ target: "resize-left", repeat: true });
  });

  test("repeat:trueラップ内の不正なアクション名は黙ってスキップされる", () => {
    const compiled = compileKeybindings({
      bindings: { h: { target: "not-a-real-action", repeat: true } as never },
    });
    expect(compiled.bindings.size).toBe(0);
  });

  test("bindingsの不正なバインド文字列は黙ってスキップされる", () => {
    const compiled = compileKeybindings({ bindings: { "cmd+d": "split-vertical" } as never });
    expect(compiled.bindings.size).toBe(0);
  });

  test("bindingsの未知のアクション名は黙ってスキップされる", () => {
    const compiled = compileKeybindings({ bindings: { d: "not-a-real-action" } as never });
    expect(compiled.bindings.size).toBe(0);
  });

  test("directの正常なエントリはcanonicalizeParsedされたキーでMapに入る（repeatは既定false）", () => {
    const compiled = compileKeybindings({ direct: { "ctrl+shift+c": "copy-selection" } });
    expect(compiled.direct.get("0110:c")).toEqual({ target: "copy-selection", repeat: false });
    expect(compiled.direct.size).toBe(1);
  });

  test("directの不正なバインド文字列は黙ってスキップされる", () => {
    const compiled = compileKeybindings({ direct: { d: "copy-selection" } as never });
    expect(compiled.direct.size).toBe(0);
  });

  test("defaultKeybindingsはprefix1件・bindings36件・directなしでコンパイルできる", () => {
    const compiled = compileKeybindings(defaultKeybindings);
    expect(compiled.prefix).not.toBeNull();
    expect(compiled.bindings.size).toBe(36);
    expect(compiled.direct.size).toBe(0);
  });

  test("defaultWindowsKeybindingsはprefix1件・bindings36件・direct2件でコンパイルできる", () => {
    const compiled = compileKeybindings(defaultWindowsKeybindings);
    expect(compiled.prefix).not.toBeNull();
    expect(compiled.bindings.size).toBe(36);
    expect(compiled.direct.size).toBe(2);
  });

  test("bindings/directのcustom BindingTarget（関数ハンドラ）はそのままtargetとしてMapに入る", () => {
    const compiled = compileKeybindings({
      bindings: { m: { kind: "custom", id: "handler-0" } },
      direct: { "cmd+shift+g": { kind: "custom", id: "handler-1" } },
    });
    expect(compiled.bindings.get("00:m")).toEqual({
      target: { kind: "custom", id: "handler-0" },
      repeat: false,
    });
    expect(compiled.direct.get("1010:g")).toEqual({
      target: { kind: "custom", id: "handler-1" },
      repeat: false,
    });
  });

  test("repeatTimeoutMs未指定はDEFAULT_REPEAT_TIMEOUT_MS(500)にフォールバックする", () => {
    const compiled = compileKeybindings({});
    expect(compiled.repeatTimeoutMs).toBe(DEFAULT_REPEAT_TIMEOUT_MS);
    expect(DEFAULT_REPEAT_TIMEOUT_MS).toBe(500);
  });

  test("repeatTimeoutMsに正の数値を指定するとそのまま使われる", () => {
    const compiled = compileKeybindings({ repeatTimeoutMs: 300 });
    expect(compiled.repeatTimeoutMs).toBe(300);
  });

  test("repeatTimeoutMsが0以下・非数値の場合はフォールバックする", () => {
    expect(compileKeybindings({ repeatTimeoutMs: 0 }).repeatTimeoutMs).toBe(
      DEFAULT_REPEAT_TIMEOUT_MS,
    );
    expect(compileKeybindings({ repeatTimeoutMs: -1 }).repeatTimeoutMs).toBe(
      DEFAULT_REPEAT_TIMEOUT_MS,
    );
    expect(compileKeybindings({ repeatTimeoutMs: "300" as never }).repeatTimeoutMs).toBe(
      DEFAULT_REPEAT_TIMEOUT_MS,
    );
  });

  test("defaultKeybindings/defaultWindowsKeybindingsはrepeatTimeoutMs=500でコンパイルできる", () => {
    expect(compileKeybindings(defaultKeybindings).repeatTimeoutMs).toBe(500);
    expect(compileKeybindings(defaultWindowsKeybindings).repeatTimeoutMs).toBe(500);
  });
});

describe("isDetailedBinding", () => {
  test("targetを持つオブジェクトはrepeat・descriptionの有無によらずtrue", () => {
    expect(isDetailedBinding({ target: "split-vertical", repeat: true })).toBe(true);
    expect(isDetailedBinding({ target: "split-vertical", repeat: false })).toBe(true);
    expect(isDetailedBinding({ target: "split-vertical" })).toBe(true);
    expect(isDetailedBinding({ target: "split-vertical", description: "分割する" })).toBe(true);
    expect(isDetailedBinding({ target: { kind: "custom", id: "h" }, repeat: true })).toBe(true);
  });

  test("targetが不正・repeat/descriptionの型が違う・null等はfalse", () => {
    expect(isDetailedBinding({ target: "not-a-real-action", repeat: true })).toBe(false);
    expect(isDetailedBinding({ target: "split-vertical", repeat: "true" })).toBe(false);
    expect(isDetailedBinding({ target: "split-vertical", description: 1 })).toBe(false);
    expect(isDetailedBinding("split-vertical")).toBe(false);
    expect(isDetailedBinding(null)).toBe(false);
  });
});

describe("resolveBindingEntry", () => {
  test("プレーンなBindingTarget（文字列アクション）はrepeat:falseへ正規化される", () => {
    expect(resolveBindingEntry("split-vertical")).toEqual({
      target: "split-vertical",
      repeat: false,
    });
  });

  test("プレーンなCustomBindingRefもrepeat:falseへ正規化される", () => {
    expect(resolveBindingEntry({ kind: "custom", id: "handler-0" })).toEqual({
      target: { kind: "custom", id: "handler-0" },
      repeat: false,
    });
  });

  test("DetailedBindingはtarget/repeat/descriptionをそのまま透過する", () => {
    expect(resolveBindingEntry({ target: "resize-left", repeat: true })).toEqual({
      target: "resize-left",
      repeat: true,
    });
    expect(resolveBindingEntry({ target: "resize-left", description: "左へ広げる" })).toEqual({
      target: "resize-left",
      repeat: false,
      description: "左へ広げる",
    });
  });

  test("不正な値はnull", () => {
    expect(resolveBindingEntry("not-a-real-action")).toBeNull();
    expect(resolveBindingEntry({ target: "not-a-real-action", repeat: true })).toBeNull();
    expect(resolveBindingEntry(null)).toBeNull();
  });
});

describe("isCustomBindingRef", () => {
  test("kind:customのオブジェクトはtrue", () => {
    expect(isCustomBindingRef({ kind: "custom", id: "handler-0" })).toBe(true);
  });

  test("KeybindAction文字列・null・idが数値のオブジェクトはfalse", () => {
    expect(isCustomBindingRef("split-vertical")).toBe(false);
    expect(isCustomBindingRef(null)).toBe(false);
    expect(isCustomBindingRef({ kind: "custom", id: 1 })).toBe(false);
  });
});

describe("isBindingTarget", () => {
  test("KeybindAction文字列・CustomBindingRefはどちらもtrue", () => {
    expect(isBindingTarget("split-vertical")).toBe(true);
    expect(isBindingTarget({ kind: "custom", id: "handler-0" })).toBe(true);
  });

  test("未知の文字列・不正な形はfalse", () => {
    expect(isBindingTarget("not-a-real-action")).toBe(false);
    expect(isBindingTarget({ kind: "custom" })).toBe(false);
  });
});
