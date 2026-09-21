import { describe, expect, spyOn, test } from "bun:test";
import { resolveWorktreeLayout } from "./open";

/** failAndExitのprocess.exitを例外へ差し替えて、終了したことをテストから観測する */
function expectExit(fn: () => void): void {
  const exitSpy = spyOn(process, "exit").mockImplementation(((code?: number) => {
    throw new Error(`exit:${code}`);
  }) as never);
  const errorSpy = spyOn(console, "error").mockImplementation(() => {});
  try {
    expect(fn).toThrow("exit:1");
  } finally {
    exitSpy.mockRestore();
    errorSpy.mockRestore();
  }
}

describe("resolveWorktreeLayout", () => {
  test("--layoutは設定の既定値より優先される", () => {
    expect(
      resolveWorktreeLayout({
        commandName: "worktree open",
        explicit: "from-flag",
        configured: "from-config",
        trust: "trusted",
      }),
    ).toBe("from-flag");
  });

  test("--layout省略時は設定の既定値を使う", () => {
    expect(
      resolveWorktreeLayout({
        commandName: "worktree open",
        explicit: undefined,
        configured: "from-config",
        trust: "absent",
      }),
    ).toBe("from-config");
  });

  test("どちらも無ければundefined（未承認でも止めない）", () => {
    expect(
      resolveWorktreeLayout({
        commandName: "worktree open",
        explicit: undefined,
        configured: undefined,
        trust: "declined",
      }),
    ).toBeUndefined();
  });

  test("未承認のリポジトリでレイアウトを指定されたら終了する", () => {
    expectExit(() =>
      resolveWorktreeLayout({
        commandName: "worktree open",
        explicit: "from-flag",
        configured: undefined,
        trust: "declined",
      }),
    );
  });
});
