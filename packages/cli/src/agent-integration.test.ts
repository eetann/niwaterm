import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { agentState, agentTranscript } from "./agent-hook";
import { mergeAgentHooks, setupAgent } from "./agent-setup";
import codexHooks from "../../../contrib/agent-integration/codex-cli/hooks.json";
import claudeHooks from "../../../contrib/agent-integration/claude-code/hooks.json";

const entry = join(import.meta.dir, "index.ts");

/** ipc-client.tsのisWslと同じ判定（あちらは非公開なので同じ内容を持つ） */
function isWsl(): boolean {
  if (process.platform !== "linux") return false;
  try {
    return /microsoft/i.test(readFileSync("/proc/version", "utf8"));
  } catch {
    return false;
  }
}
async function invoke(args: string[], input: string, env: Record<string, string> = {}) {
  const process = Bun.spawn([Bun.which("bun")!, entry, ...args], {
    env: { ...Bun.env, NIWATERM_TAB_ID: "", ...env },
    stdin: new Blob([input]),
    stdout: "pipe",
    stderr: "pipe",
    windowsHide: true,
  });
  return {
    code: await process.exited,
    stdout: await new Response(process.stdout).text(),
    stderr: await new Response(process.stderr).text(),
  };
}

/**
 * CLIの接続先を再現するダミーIPCサーバー。ipc-client.tsのresolveIpcEndpointは
 * WSLのときだけTCPブリッジを見て、それ以外はunix socketを見るため、テスト側も同じ分岐で
 * 待ち受けないとリクエストが1件も届かない（macOSではNIWATERM_BRIDGE_PORTは無視される）
 */
async function startIpcStub(
  requests: unknown[],
): Promise<{ env: Record<string, string>; stop: () => Promise<void> }> {
  const handler = {
    async fetch(request: Request) {
      expect(new URL(request.url).pathname).toBe("/set-var");
      requests.push(await request.json());
      return Response.json(
        { ok: true },
        { headers: { "x-niwaterm-app-variant": "niwaterm-test" } },
      );
    },
  };
  if (isWsl()) {
    const server = Bun.serve({ port: 0, hostname: "127.0.0.1", ...handler });
    return {
      env: { NIWATERM_BRIDGE_PORT: String(server.port), NIWATERM_APP_VARIANT: "niwaterm-test" },
      stop: async () => {
        server.stop(true);
      },
    };
  }
  const dir = await mkdtemp(join(tmpdir(), "niwaterm-agent-ipc-test-"));
  const socketPath = join(dir, "niwaterm.sock");
  const server = Bun.serve({ unix: socketPath, ...handler });
  return {
    env: { NIWATERM_SOCKET: socketPath },
    stop: async () => {
      server.stop(true);
      await rm(dir, { recursive: true, force: true });
    },
  };
}

describe("agent hooks", () => {
  test("配布イベントを状態へ変換し、終了では3変数をクリアする", () => {
    for (const [agent, template] of [
      ["codex-cli", codexHooks],
      ["claude-code", claudeHooks],
    ] as const) {
      for (const event of Object.keys(template.hooks)) {
        const result = agentState(agent, {
          hook_event_name: event,
          notification_type: "permission_prompt",
        });
        expect(result).not.toBeNull();
        expect(result?.agent).toBe(event === "SessionEnd" ? "" : agent);
      }
      expect(agentState(agent, { hook_event_name: "SessionEnd" })).toEqual({
        agent: "",
        agent_status: "",
        agent_status_text: "",
      });
      expect(agentState(agent, { hook_event_name: "UserPromptSubmit" })?.agent_status).toBe(
        "working",
      );
    }
  });
  test("承認待ちからツール実行後に戻り、古い要約を消す", () => {
    expect(
      agentState("codex-cli", {
        hook_event_name: "PermissionRequest",
        tool_input: { description: "許可してください" },
      }),
    ).toEqual({
      agent: "codex-cli",
      agent_status: "blocked",
      agent_status_text: "許可してください",
    });
    expect(
      agentState("codex-cli", {
        hook_event_name: "PostToolUse",
        tool_name: "Bash",
        tool_input: { command: "echo hello" },
      })?.agent_status,
    ).toBe("working");
    expect(agentState("codex-cli", { hook_event_name: "Interrupt" })?.agent_status_text).toBe("");
    expect(
      agentState("claude-code", {
        hook_event_name: "Notification",
        notification_type: "permission_prompt",
        message: "確認",
      })?.agent_status,
    ).toBe("blocked");
    expect(agentState("claude-code", { hook_event_name: "PostToolUseFailure" })?.agent_status).toBe(
      "working",
    );
  });
  test("未知・他エージェント専用のイベントと圧縮時の開始を無視する", () => {
    expect(agentState("codex-cli", null)).toBeNull();
    expect(
      agentState("codex-cli", { hook_event_name: "SessionStart", source: "compact" }),
    ).toBeNull();
    expect(agentState("codex-cli", { hook_event_name: "PostToolUseFailure" })).toBeNull();
    expect(
      agentState("claude-code", {
        hook_event_name: "Notification",
        notification_type: "idle_prompt",
      }),
    ).toBeNull();
  });
  test("Unicodeを壊さず改行と長さを正規化し、型不正も扱う", () => {
    const message = "庭🌱\n".repeat(40);
    expect(
      agentState("codex-cli", { hook_event_name: "Stop", last_assistant_message: message })
        ?.agent_status_text,
    ).toBe("庭🌱 ".repeat(20));
    expect(
      agentState("codex-cli", { hook_event_name: "PreToolUse", tool_input: "unexpected" })
        ?.agent_status_text,
    ).toBe("");
    expect(
      agentState("claude-code", { hook_event_name: "Stop", last_assistant_message: 42 })
        ?.agent_status_text,
    ).toBe("");
  });
  test("実際のCLIから指定タブだけへIPCで3変数を書き込む", async () => {
    const requests: unknown[] = [];
    const stub = await startIpcStub(requests);
    try {
      expect(
        await invoke(
          ["_hook", "codex-cli"],
          JSON.stringify({ hook_event_name: "Stop", last_assistant_message: "完了" }),
          { NIWATERM_TAB_ID: "test-only-tab", ...stub.env },
        ),
      ).toEqual({ code: 0, stdout: "", stderr: "" });
      expect(requests).toEqual([
        { tabId: "test-only-tab", key: "agent", value: "codex-cli" },
        { tabId: "test-only-tab", key: "agent_status_text", value: "完了" },
        { tabId: "test-only-tab", key: "agent_status", value: "idle" },
      ]);
    } finally {
      await stub.stop();
    }
  });
  test("transcriptはセッション開始とプロンプト送信で更新し、終了でクリアする", () => {
    const path = "/home/me/.claude/projects/proj/session.jsonl";
    for (const event of ["SessionStart", "UserPromptSubmit"]) {
      expect(agentTranscript({ hook_event_name: event, transcript_path: path })).toBe(path);
    }
    expect(agentTranscript({ hook_event_name: "SessionEnd", transcript_path: path })).toBe("");
    // 値は変わらないので、状態だけが動くhookでは書き直さない
    for (const event of ["PreToolUse", "PostToolUse", "Stop", "Notification"]) {
      expect(agentTranscript({ hook_event_name: event, transcript_path: path })).toBeNull();
    }
    // パスを渡さないエージェント（Codex等）では触らない
    expect(agentTranscript({ hook_event_name: "SessionStart" })).toBeNull();
    expect(agentTranscript({ hook_event_name: "SessionStart", transcript_path: 1 })).toBeNull();
    expect(agentTranscript("invalid")).toBeNull();
  });
  test("実際のCLIからtranscriptをagent_statusより先に書き込む", async () => {
    const requests: unknown[] = [];
    const stub = await startIpcStub(requests);
    try {
      expect(
        await invoke(
          ["_hook", "claude-code"],
          JSON.stringify({
            hook_event_name: "UserPromptSubmit",
            transcript_path: "/home/me/.claude/projects/proj/session.jsonl",
          }),
          { NIWATERM_TAB_ID: "test-only-tab", ...stub.env },
        ),
      ).toEqual({ code: 0, stdout: "", stderr: "" });
      expect(requests).toEqual([
        { tabId: "test-only-tab", key: "agent", value: "claude-code" },
        { tabId: "test-only-tab", key: "agent_status_text", value: "" },
        {
          tabId: "test-only-tab",
          key: "agent_transcript",
          value: "/home/me/.claude/projects/proj/session.jsonl",
        },
        { tabId: "test-only-tab", key: "agent_status", value: "working" },
      ]);
    } finally {
      await stub.stop();
    }
  });
  test("タブ外・不正入力・引数不正・IPC失敗でも無出力で成功する", async () => {
    for (const [args, input, env] of [
      [["_hook", "codex-cli"], "{}", {}],
      [["_hook"], "{}", {}],
      [["_hook", "unknown"], "{}", {}],
      [["_hook", "codex-cli"], "invalid", { NIWATERM_TAB_ID: "test-only-tab" }],
      [
        ["_hook", "codex-cli"],
        '{"hook_event_name":"Stop"}',
        { NIWATERM_TAB_ID: "test-only-tab", NIWATERM_BRIDGE_PORT: "1" },
      ],
    ] as [string[], string, Record<string, string>][]) {
      expect(await invoke(args, input, env)).toEqual({ code: 0, stdout: "", stderr: "" });
    }
    expect((await invoke(["--help"], "")).stdout).not.toContain("_hook");
  });
});

describe("agent setup", () => {
  test("同じmatcher内の他handlerと設定を保持し、旧設定も重複なく更新する", () => {
    const other = { type: "command", command: "echo other" };
    const current = {
      model: "keep",
      hooks: {
        Stop: [
          {
            matcher: "",
            hooks: [
              other,
              {
                command:
                  'if [ -n "$NIWATERM_TAB_ID" ]; then niwa tab var set agent_status idle; fi',
              },
            ],
          },
        ],
        SubagentStop: [{ hooks: [other] }],
      },
    };
    const merged = mergeAgentHooks(current, "codex-cli", "niwa-dev");
    expect(merged.model).toBe("keep");
    expect(merged.hooks?.Stop?.[0]?.hooks).toEqual([other]);
    expect(merged.hooks?.SubagentStop).toEqual(current.hooks.SubagentStop);
    expect(merged.hooks?.Stop?.[1]?.hooks[0]?.command).toStartWith("niwa-dev _hook codex-cli");
    expect(mergeAgentHooks(merged, "codex-cli", "niwa-dev")).toEqual(merged);
    expect(current.hooks.Stop[0]?.hooks).toHaveLength(2);
  });
  test("旧dev用hookを移行し、タブ環境を使う他のhookは保持する", () => {
    const other = { command: 'echo "$NIWATERM_TAB_ID"' };
    const current = {
      hooks: {
        Stop: [
          {
            hooks: [
              other,
              {
                command:
                  'if [ -n "$NIWATERM_TAB_ID" ]; then niwa-dev tab var set agent_status idle; fi',
              },
            ],
          },
        ],
      },
    };
    const merged = mergeAgentHooks(current, "claude-code", "niwa-dev");
    expect(merged.hooks?.Stop?.[0]?.hooks).toEqual([other]);
    expect(merged.hooks?.Stop).toHaveLength(2);
  });
  test("旧コマンド名niwatermで入れたhookを置き換える", () => {
    const current = {
      hooks: {
        Stop: [{ hooks: [{ command: "niwaterm _hook claude-code >/dev/null 2>&1 || true" }] }],
      },
    };
    const merged = mergeAgentHooks(current, "claude-code", "niwa");
    expect(JSON.stringify(merged)).not.toContain("niwaterm _hook");
    expect(merged.hooks?.Stop?.[0]?.hooks[0]?.command).toStartWith("niwa _hook claude-code");
  });
  test("リンク切れの設定先を置き換えない", async () => {
    const directory = await mkdtemp(join(tmpdir(), "niwaterm-agent-"));
    try {
      const path = join(directory, "hooks.json");
      await symlink(join(directory, "missing.json"), path);
      await expect(setupAgent("codex-cli", path, "niwa")).rejects.toThrow("シンボリックリンク");
      expect(await readdir(directory)).toEqual(["hooks.json"]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
  test("不正な設定を上書きしない", async () => {
    const directory = await mkdtemp(join(tmpdir(), "niwaterm-agent-"));
    try {
      for (const contents of [
        "invalid",
        "[]",
        '{"hooks":null}',
        '{"hooks":{"Stop":{}}}',
        '{"hooks":{"Stop":[{}]}}',
      ]) {
        const path = join(directory, "hooks.json");
        await writeFile(path, contents);
        await expect(setupAgent("codex-cli", path, "niwa")).rejects.toThrow();
        expect(await readFile(path, "utf8")).toBe(contents);
        expect(await readdir(directory)).toEqual(["hooks.json"]);
      }
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
  test("初回導入・バックアップ・再実行・シンボリックリンクを扱う", async () => {
    const directory = await mkdtemp(join(tmpdir(), "niwaterm-agent-"));
    try {
      const path = join(directory, "config with spaces", "hooks.json");
      expect((await setupAgent("codex-cli", path, "niwa")).changed).toBe(true);
      const original = await readFile(path, "utf8");
      const link = join(directory, "linked.json");
      await symlink(path, link);
      expect((await setupAgent("codex-cli", link, "niwa-dev")).changed).toBe(true);
      const files = await readdir(join(directory, "config with spaces"));
      const backup = files.find((file) => file.endsWith(".bak"))!;
      expect(await readFile(join(directory, "config with spaces", backup), "utf8")).toBe(original);
      expect((await stat(path)).mode & 0o777).toBe(0o600);
      expect((await setupAgent("codex-cli", path, "niwa-dev")).changed).toBe(false);
      expect(await readdir(join(directory, "config with spaces"))).toEqual(files);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
  test("setup CLIは明示した設定だけに書き込む", async () => {
    const directory = await mkdtemp(join(tmpdir(), "niwaterm-agent-"));
    try {
      const path = join(directory, "settings.json");
      const result = await invoke(
        ["agent", "setup", "claude-code", "--config", path, "--cli", "niwa-dev"],
        "",
      );
      expect(result.code).toBe(0);
      expect(JSON.parse(await readFile(path, "utf8")).hooks.Stop[0].hooks[0].command).toStartWith(
        "niwa-dev _hook claude-code",
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
