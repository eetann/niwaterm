import { describe, expect, test } from "bun:test";
import { runShellCommand } from "./shell-run";

describe("runShellCommand", () => {
  test("標準出力とexitCode 0を返す", async () => {
    const result = await runShellCommand("echo hello", { shell: "bash" });
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe("hello");
  });

  test("失敗コマンドは非0のexitCodeを返す", async () => {
    const result = await runShellCommand("exit 3", { shell: "bash" });
    expect(result.exitCode).toBe(3);
  });

  test("標準エラー出力を返す", async () => {
    // -i（インタラクティブ）指定によりbashが「no job control」警告をstderrへ出すため、
    // 完全一致ではなくcommandの出力が含まれることだけを見る
    const result = await runShellCommand("echo err 1>&2", { shell: "bash" });
    expect(result.stderr).toContain("err");
  });

  test("envオプションで渡した環境変数がコマンドから見える", async () => {
    const result = await runShellCommand("echo $NIWATERM_SHELL_RUN_TEST_VAR", {
      shell: "bash",
      env: { NIWATERM_SHELL_RUN_TEST_VAR: "bar123" },
    });
    expect(result.stdout.trim()).toBe("bar123");
  });

  test("cwdオプションで指定したディレクトリで実行される", async () => {
    const result = await runShellCommand("pwd", { shell: "bash", cwd: "/tmp" });
    expect(result.stdout.trim()).toBe("/tmp");
  });
});
