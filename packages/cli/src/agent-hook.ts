/** hooksを仕込める対象エージェント。`agent setup`の引数候補もここから引く */
export const AGENTS = ["claude-code", "codex-cli"] as const;

export type Agent = (typeof AGENTS)[number];
export type AgentState = {
  agent: string;
  agent_status: string;
  agent_status_text: string;
};

type JsonObject = Record<string, unknown>;

export function isAgent(value: unknown): value is Agent {
  return AGENTS.includes(value as Agent);
}

function object(value: unknown): JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonObject)
    : {};
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function toolText(payload: JsonObject): string {
  const name = text(payload.tool_name);
  const input = object(payload.tool_input);
  const detail = ["file_path", "command", "cmd", "pattern", "url", "description"]
    .map((key) => text(input[key]))
    .find(Boolean);
  return detail ? `${name}: ${detail}` : name;
}

export function agentState(agent: Agent, input: unknown): AgentState | null {
  const payload = object(input);
  let status: string;
  let summary = "";
  switch (payload.hook_event_name) {
    case "SessionStart":
      if (agent === "codex-cli" && payload.source === "compact") return null;
      status = "idle";
      break;
    case "UserPromptSubmit":
      status = "working";
      break;
    case "PreToolUse":
    case "PostToolUse":
      status = "working";
      summary = toolText(payload);
      break;
    case "PostToolUseFailure":
      if (agent !== "claude-code") return null;
      status = "working";
      summary = toolText(payload);
      break;
    case "PermissionRequest":
      if (agent !== "codex-cli") return null;
      status = "blocked";
      summary =
        text(object(payload.tool_input).description) || text(payload.tool_name) || "確認が必要です";
      break;
    case "Notification":
      if (agent !== "claude-code" || payload.notification_type !== "permission_prompt") return null;
      status = "blocked";
      summary = text(payload.message) || "確認が必要です";
      break;
    case "Stop":
      status = "idle";
      summary = text(payload.last_assistant_message);
      break;
    case "Interrupt":
      if (agent !== "codex-cli") return null;
      status = "idle";
      break;
    case "SessionEnd":
      return { agent: "", agent_status: "", agent_status_text: "" };
    default:
      return null;
  }
  return {
    agent,
    agent_status: status,
    agent_status_text: [...summary.replace(/[\n\r]/g, " ")].slice(0, 60).join(""),
  };
}

/** hookは入力不正・接続失敗でもエージェントへ出力や失敗を返さない。 */
export async function runAgentHook(agent: unknown): Promise<void> {
  const tabId = process.env["NIWATERM_TAB_ID"];
  if (!tabId || !isAgent(agent) || process.stdin.isTTY) return;
  // stdinやIPCが停止しても、承認ダイアログや終了処理を待たせ続けない。
  const deadline = setTimeout(() => process.exit(0), 2000);
  try {
    const state = agentState(agent, JSON.parse(await Bun.stdin.text()));
    if (!state) return;
    const { resolveIpcEndpoint, setTabVar } = await import("./ipc-client");
    const endpoint = resolveIpcEndpoint();
    for (const key of ["agent", "agent_status_text", "agent_status"] as const) {
      const result = await setTabVar(endpoint, tabId, key, state[key]);
      if (!result.ok) break;
    }
  } catch {
    // 通知は補助機能なので、エージェントの処理へエラーを伝播させない。
  } finally {
    clearTimeout(deadline);
  }
}
