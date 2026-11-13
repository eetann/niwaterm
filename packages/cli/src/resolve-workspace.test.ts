import { describe, expect, test } from "bun:test";
import type { WorkspaceListEntry } from "./ipc-client";
import { matchWorkspace } from "./resolve-workspace";

function workspace(workspaceId: string, name: string | null): WorkspaceListEntry {
  return { workspaceId, name, active: false, activeBoardId: null, boards: [] };
}

const WORKSPACES = [
  workspace("workspace-0", "🌱 niwaterm"),
  workspace("workspace-1", "🌲 niwaterm-docs"),
  workspace("workspace-2", "Dotfiles"),
  workspace("workspace-3", null),
];

describe("matchWorkspace", () => {
  test("workspaceIdと完全一致すればそれを使う", () => {
    expect(matchWorkspace(WORKSPACES, "workspace-3")).toEqual({
      kind: "found",
      workspaceId: "workspace-3",
    });
  });

  test("名前と完全一致すれば、部分一致が他にあってもそれを使う", () => {
    expect(matchWorkspace(WORKSPACES, "🌱 niwaterm")).toEqual({
      kind: "found",
      workspaceId: "workspace-0",
    });
  });

  test("部分一致が1件なら絵文字を打たずに選べる", () => {
    expect(matchWorkspace(WORKSPACES, "docs")).toEqual({
      kind: "found",
      workspaceId: "workspace-1",
    });
  });

  test("部分一致は大文字小文字を区別しない", () => {
    expect(matchWorkspace(WORKSPACES, "dotfiles")).toEqual({
      kind: "found",
      workspaceId: "workspace-2",
    });
  });

  test("部分一致が複数なら選ばずに候補を返す", () => {
    const match = matchWorkspace(WORKSPACES, "niwa");
    expect(match.kind).toBe("ambiguous");
    if (match.kind !== "ambiguous") return;
    expect(match.candidates.map((w) => w.workspaceId)).toEqual(["workspace-0", "workspace-1"]);
  });

  test("同名のワークスペースが複数あれば候補を返す", () => {
    const match = matchWorkspace(
      [workspace("workspace-0", "dev"), workspace("workspace-1", "dev")],
      "dev",
    );
    expect(match.kind).toBe("ambiguous");
  });

  test("どれにも当たらなければnot-found", () => {
    expect(matchWorkspace(WORKSPACES, "nothing")).toEqual({ kind: "not-found" });
  });
});
