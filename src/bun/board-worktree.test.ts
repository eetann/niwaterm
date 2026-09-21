import { describe, expect, test } from "bun:test";
import { resolveBoardNewTabCwd, resolveWorktreeInputPath } from "./board-worktree";

const exists = () => true;
const missing = () => false;

describe("resolveBoardNewTabCwd", () => {
  test('mode:"inherit"なら紐づけがあってもundefined（呼び出し側のcwd引き継ぎに任せる）', () => {
    expect(resolveBoardNewTabCwd("inherit", "/repo/.worktrees/feat", exists)).toBeUndefined();
  });

  test('mode:"worktree"で紐づけがあればそのパスを返す', () => {
    expect(resolveBoardNewTabCwd("worktree", "/repo/.worktrees/feat", exists)).toBe(
      "/repo/.worktrees/feat",
    );
  });

  test('mode:"worktree"でも紐づけの無いBoardはundefined', () => {
    expect(resolveBoardNewTabCwd("worktree", undefined, exists)).toBeUndefined();
  });

  test("紐づけ先が存在しない場合はundefined（PTYの起動失敗を避けて引き継ぎへ倒す）", () => {
    expect(resolveBoardNewTabCwd("worktree", "/gone", missing)).toBeUndefined();
  });
});

describe("resolveWorktreeInputPath", () => {
  test("空文字列・空白のみは紐づけ解除のnull", () => {
    expect(resolveWorktreeInputPath("", "/repo", undefined, "linux")).toBeNull();
    expect(resolveWorktreeInputPath("   ", "/repo", undefined, "linux")).toBeNull();
  });

  test("絶対パスは前後の空白を落としてそのまま使う", () => {
    expect(resolveWorktreeInputPath("  /repo/feat  ", "/other", undefined, "linux")).toBe(
      "/repo/feat",
    );
  });

  test("相対パスは基準cwd起点で解決する", () => {
    expect(resolveWorktreeInputPath("../feat", "/repo/main", undefined, "linux")).toBe(
      "/repo/feat",
    );
  });

  test("基準cwdが分からない相対パスは解決できないのでnull", () => {
    expect(resolveWorktreeInputPath("../feat", undefined, undefined, "linux")).toBeNull();
  });

  test("WindowsでWSLタブのLinuxパスを打たれた場合はUNC形式へ直す", () => {
    expect(resolveWorktreeInputPath("/home/me/repo", undefined, "wsl.exe -d NixOS", "win32")).toBe(
      "\\\\wsl.localhost\\NixOS\\home\\me\\repo",
    );
  });

  test("WindowsでもWSLタブでなければLinuxパスはそのまま（変換の判断材料が無い）", () => {
    expect(resolveWorktreeInputPath("/home/me/repo", undefined, "powershell.exe", "win32")).toBe(
      "/home/me/repo",
    );
  });
});
