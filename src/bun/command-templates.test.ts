import { describe, expect, spyOn, test } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CommandTemplateContext, Niwa, NiwaWorkspaceInfo } from "@niwaterm/config";
import { parseCommandTemplate } from "../shared/command-template";
import {
  type CommandTemplateDef,
  type CommandTemplateFieldDef,
  createCommandTemplates,
  createFileRememberedValuesStore,
  createMemoryRememberedValuesStore,
} from "./command-templates";

const CTX: CommandTemplateContext = { tabId: "tab-1", cwd: "/repo", vars: { cwd: "/repo" } };

function fakeNiwa(workspaces: NiwaWorkspaceInfo[] = []): Niwa {
  return { workspace: { list: () => workspaces } } as unknown as Niwa;
}

function field(name: string, overrides: Partial<CommandTemplateFieldDef> = {}) {
  return {
    name,
    label: name,
    placeholder: "",
    options: null,
    default: "",
    quote: true,
    focus: false,
    ...overrides,
  } satisfies CommandTemplateFieldDef;
}

function def(
  command: string,
  fields: CommandTemplateFieldDef[],
  overrides: Partial<CommandTemplateDef> = {},
): CommandTemplateDef {
  return {
    id: "t",
    name: "テンプレート",
    description: "",
    command,
    segments: parseCommandTemplate(command),
    fields,
    rememberLastValues: false,
    ...overrides,
  };
}

describe("prepare", () => {
  test("未知のidはnull", async () => {
    const handle = createCommandTemplates([], fakeNiwa(), createMemoryRememberedValuesStore());
    expect(await handle.prepare("missing", CTX)).toBeNull();
  });

  test("自由入力の欄はdefaultを初期値にする", async () => {
    const handle = createCommandTemplates(
      [def("echo {{a}}", [field("a", { default: "hi", placeholder: "例" })])],
      fakeNiwa(),
      createMemoryRememberedValuesStore(),
    );
    const prepared = await handle.prepare("t", CTX);
    expect(prepared?.fields).toEqual([
      {
        name: "a",
        label: "a",
        placeholder: "例",
        quote: true,
        focus: false,
        options: null,
        error: null,
        initial: "hi",
      },
    ]);
  });

  test("focusを欄ごとにそのまま渡す", async () => {
    const handle = createCommandTemplates(
      [def("x {{a}} {{b}}", [field("a"), field("b", { focus: true })])],
      fakeNiwa(),
      createMemoryRememberedValuesStore(),
    );
    const prepared = await handle.prepare("t", CTX);
    expect(prepared?.fields.map((f) => f.focus)).toEqual([false, true]);
  });

  test("defaultの関数はctxとniwaを受け取り、戻り値を初期値にする", async () => {
    const niwa = fakeNiwa();
    let received: [CommandTemplateContext, Niwa] | undefined;
    const handle = createCommandTemplates(
      [
        def("echo {{a}}", [
          field("a", {
            default: async (ctx, n) => {
              received = [ctx, n];
              return "from-fn";
            },
          }),
        ]),
      ],
      niwa,
      createMemoryRememberedValuesStore(),
    );
    expect((await handle.prepare("t", CTX))?.fields[0]?.initial).toBe("from-fn");
    expect(received?.[0]).toEqual(CTX);
    expect(received?.[1]).toBe(niwa);
  });

  test("選択肢の欄のdefaultの関数は、候補を作った後に呼ばれ、候補に無い値なら先頭へ落とす", async () => {
    const calls: string[] = [];
    const handle = createCommandTemplates(
      [
        def("x {{a}} {{b}}", [
          field("a", {
            options: () => {
              calls.push("options");
              return ["main", "origin/feat/x"];
            },
            default: () => {
              calls.push("default");
              return "origin/feat/x";
            },
          }),
          field("b", {
            options: [
              { label: "main", value: "main" },
              { label: "dev", value: "dev" },
            ],
            default: () => "nope",
          }),
        ]),
      ],
      fakeNiwa(),
      createMemoryRememberedValuesStore(),
    );
    const prepared = await handle.prepare("t", CTX);
    expect(calls).toEqual(["options", "default"]);
    expect(prepared?.fields.map((f) => f.initial)).toEqual(["origin/feat/x", "main"]);
  });

  test("defaultの関数が失敗した・undefinedを返したときは初期値なしとして扱う", async () => {
    const logSpy = spyOn(console, "log").mockImplementation(() => {});
    try {
      const handle = createCommandTemplates(
        [
          def("x {{a}} {{b}}", [
            field("a", {
              default: () => {
                throw new Error("boom");
              },
            }),
            field("b", { default: () => undefined }),
          ]),
        ],
        fakeNiwa(),
        createMemoryRememberedValuesStore(),
      );
      const prepared = await handle.prepare("t", CTX);
      expect(prepared?.fields.map((f) => f.initial)).toEqual(["", ""]);
    } finally {
      logSpy.mockRestore();
    }
  });

  test("固定の選択肢はdefaultが候補にあればそれ、無ければ先頭を初期値にする", async () => {
    const options = [
      { label: "dev", value: "dev" },
      { label: "prod", value: "prod" },
    ];
    const handle = createCommandTemplates(
      [
        def("deploy {{a}} {{b}}", [
          field("a", { options, default: "prod" }),
          field("b", { options, default: "nope" }),
        ]),
      ],
      fakeNiwa(),
      createMemoryRememberedValuesStore(),
    );
    const prepared = await handle.prepare("t", CTX);
    expect(prepared?.fields.map((f) => f.initial)).toEqual(["prod", "dev"]);
  });

  test("workspaceは名前を出してidを入れ、今のワークスペースを初期値にする", async () => {
    const handle = createCommandTemplates(
      [def("x {{ws}}", [field("ws", { options: "workspace" })])],
      fakeNiwa([
        { id: "ws-1", name: "🌱 niwaterm", active: false },
        { id: "ws-2", name: null, active: true },
      ]),
      createMemoryRememberedValuesStore(),
    );
    const prepared = await handle.prepare("t", CTX);
    expect(prepared?.fields[0]?.options).toEqual([
      { label: "🌱 niwaterm", value: "ws-1" },
      { label: "Workspace 2", value: "ws-2", description: "今のワークスペース" },
    ]);
    expect(prepared?.fields[0]?.initial).toBe("ws-2");
  });

  test("関数の選択肢はctxを受け取り、文字列の要素をlabel=valueへ揃える", async () => {
    let received: CommandTemplateContext | undefined;
    const handle = createCommandTemplates(
      [
        def("git switch {{b}}", [
          field("b", {
            options: (ctx) => {
              received = ctx;
              return ["main", { label: "開発", value: "dev", description: "d" }];
            },
          }),
        ]),
      ],
      fakeNiwa(),
      createMemoryRememberedValuesStore(),
    );
    const prepared = await handle.prepare("t", CTX);
    expect(received).toEqual(CTX);
    expect(prepared?.fields[0]?.options).toEqual([
      { label: "main", value: "main" },
      { label: "開発", value: "dev", description: "d" },
    ]);
  });

  test("関数が例外を投げたら候補を空にして理由を返す", async () => {
    const logSpy = spyOn(console, "log").mockImplementation(() => {});
    try {
      const handle = createCommandTemplates(
        [
          def("x {{b}}", [
            field("b", {
              options: () => {
                throw new Error("boom");
              },
            }),
          ]),
        ],
        fakeNiwa(),
        createMemoryRememberedValuesStore(),
      );
      const prepared = await handle.prepare("t", CTX);
      expect(prepared?.fields[0]).toMatchObject({
        options: [],
        error: "候補を作れませんでした: boom",
        initial: "",
      });
    } finally {
      logSpy.mockRestore();
    }
  });
});

describe("submit", () => {
  test("値を埋めてクォートしたコマンドを返す", () => {
    const handle = createCommandTemplates(
      [def("niwa worktree new {{branch}} --workspace {{ws}}", [field("branch"), field("ws")])],
      fakeNiwa(),
      createMemoryRememberedValuesStore(),
    );
    expect(handle.submit("t", { branch: "feat/x", ws: "my ws" })).toEqual({
      ok: true,
      text: "niwa worktree new feat/x --workspace 'my ws'",
    });
  });

  test("空の欄があれば組み立てない", () => {
    const handle = createCommandTemplates(
      [def("echo {{a}} {{b}}", [field("a"), field("b")])],
      fakeNiwa(),
      createMemoryRememberedValuesStore(),
    );
    expect(handle.submit("t", { a: "x", b: "" })).toEqual({
      ok: false,
      error: "空の欄があります: b",
    });
  });

  test("未知のidはエラー", () => {
    const handle = createCommandTemplates([], fakeNiwa(), createMemoryRememberedValuesStore());
    expect(handle.submit("missing", {}).ok).toBe(false);
  });
});

describe("rememberLastValues", () => {
  test("trueなら送った値を次の初期値にする", async () => {
    const handle = createCommandTemplates(
      [
        def(
          "deploy {{a}} {{env}}",
          [
            field("a"),
            field("env", {
              options: [
                { label: "dev", value: "dev" },
                { label: "prod", value: "prod" },
              ],
            }),
          ],
          {
            rememberLastValues: true,
          },
        ),
      ],
      fakeNiwa(),
      createMemoryRememberedValuesStore(),
    );
    handle.submit("t", { a: "v1", env: "prod" });
    const prepared = await handle.prepare("t", CTX);
    expect(prepared?.fields.map((f) => f.initial)).toEqual(["v1", "prod"]);
  });

  test("falseなら覚えない", async () => {
    const store = createMemoryRememberedValuesStore();
    const handle = createCommandTemplates([def("echo {{a}}", [field("a")])], fakeNiwa(), store);
    handle.submit("t", { a: "v1" });
    expect(store.get("t")).toBeUndefined();
    expect((await handle.prepare("t", CTX))?.fields[0]?.initial).toBe("");
  });

  test("覚えた値が今の候補に無ければ使わない", async () => {
    const store = createMemoryRememberedValuesStore();
    store.set("t", { ws: "gone" });
    const handle = createCommandTemplates(
      [def("x {{ws}}", [field("ws", { options: "workspace" })], { rememberLastValues: true })],
      fakeNiwa([{ id: "ws-1", name: "a", active: true }]),
      store,
    );
    expect((await handle.prepare("t", CTX))?.fields[0]?.initial).toBe("ws-1");
  });
});

describe("createFileRememberedValuesStore", () => {
  test("保存した値を別のstoreからも読める", () => {
    const path = join(mkdtempSync(join(tmpdir(), "niwaterm-tmpl-")), "nested", "values.json");
    createFileRememberedValuesStore(path).set("t", { a: "1" });
    expect(createFileRememberedValuesStore(path).get("t")).toEqual({ a: "1" });
    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({ t: { a: "1" } });
  });

  test("壊れたファイル・文字列でない値は無視する", () => {
    const dir = mkdtempSync(join(tmpdir(), "niwaterm-tmpl-"));
    const broken = join(dir, "broken.json");
    writeFileSync(broken, "{");
    expect(createFileRememberedValuesStore(broken).get("t")).toBeUndefined();

    const mixed = join(dir, "mixed.json");
    writeFileSync(mixed, JSON.stringify({ t: { a: "1", b: 2 }, u: "x" }));
    const store = createFileRememberedValuesStore(mixed);
    expect(store.get("t")).toEqual({ a: "1" });
    expect(store.get("u")).toBeUndefined();
  });
});
