/** hooksを仕込める対象エージェント。`agent setup`の引数候補もここから引く */
export const AGENTS = ["claude-code", "codex-cli"] as const;

export type Agent = (typeof AGENTS)[number];
export type AgentState = {
  agent: string;
  agent_status: string;
  agent_status_text: string;
};

/**
 * エージェントのtranscript（会話記録のファイル）の在り処を置くタブ変数。
 * 画面に残らないやりとりを後から辿る唯一の手がかりになる
 * （docs/known-issues/claude-code-history-not-in-scrollback.md）
 */
export const TRANSCRIPT_VAR = "agent_transcript";

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
  const name = text(payload["tool_name"]);
  const input = object(payload["tool_input"]);
  const detail = ["file_path", "command", "cmd", "pattern", "url", "description"]
    .map((key) => text(input[key]))
    .find(Boolean);
  return detail ? `${name}: ${detail}` : name;
}

export function agentState(agent: Agent, input: unknown): AgentState | null {
  const payload = object(input);
  let status: string;
  let summary = "";
  switch (payload["hook_event_name"]) {
    case "SessionStart":
      if (agent === "codex-cli" && payload["source"] === "compact") return null;
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
        text(object(payload["tool_input"])["description"]) ||
        text(payload["tool_name"]) ||
        "確認が必要です";
      break;
    case "Notification":
      if (agent !== "claude-code" || payload["notification_type"] !== "permission_prompt")
        return null;
      status = "blocked";
      summary = text(payload["message"]) || "確認が必要です";
      break;
    case "Stop":
      status = "idle";
      summary = text(payload["last_assistant_message"]);
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

/**
 * そのhookで書き込むtranscriptのパス。nullは「触らない」。
 * どのhookの入力にもパスは入っているが、値は変わらないので、セッションの始まりと
 * プロンプト送信（＝一覧が増える瞬間）だけ更新してIPCの往復を増やさない
 */
export function agentTranscript(input: unknown): string | null {
  const payload = object(input);
  switch (payload["hook_event_name"]) {
    case "SessionStart":
    case "UserPromptSubmit":
      return text(payload["transcript_path"]) || null;
    case "SessionEnd":
      return "";
    default:
      return null;
  }
}

/** hookは入力不正・接続失敗でもエージェントへ出力や失敗を返さない。 */
export async function runAgentHook(agent: unknown): Promise<void> {
  const tabId = process.env["NIWATERM_TAB_ID"];
  if (!tabId || !isAgent(agent) || process.stdin.isTTY) return;
  // stdinやIPCが停止しても、承認ダイアログや終了処理を待たせ続けない。
  const deadline = setTimeout(() => process.exit(0), 2000);
  try {
    const input = JSON.parse(await Bun.stdin.text());
    const state = agentState(agent, input);
    if (!state) return;
    const { resolveIpcEndpoint, setTabVar } = await import("./ipc-client");
    const endpoint = resolveIpcEndpoint();
    const transcript = agentTranscript(input);
    // agent_statusは最後に書く。サイドバーの表示を動かすのはこのキーなので、
    // 表示が変わった時点では他のキーが出揃っている
    const entries: [string, string][] = [
      ["agent", state.agent],
      ["agent_status_text", state.agent_status_text],
      ...(transcript === null ? [] : ([[TRANSCRIPT_VAR, transcript]] as [string, string][])),
      ["agent_status", state.agent_status],
    ];
    for (const [key, value] of entries) {
      const result = await setTabVar(endpoint, tabId, key, value);
      if (!result.ok) break;
    }
  } catch {
    // 通知は補助機能なので、エージェントの処理へエラーを伝播させない。
  } finally {
    clearTimeout(deadline);
  }
}
