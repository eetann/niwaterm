import { describe, expect, test } from "bun:test";
import {
  appendCommandArgs,
  buildEnv,
  createPty,
  encodeRelayFrame,
  encodeRelayResize,
  ptyExecPath,
  withPtyExec,
} from "./pty";

describe("appendCommandArgs", () => {
  test("commandが未指定なら何もしない", () => {
    const cmd = ["/bin/zsh", "-il"];
    appendCommandArgs(cmd, undefined, undefined);
    expect(cmd).toEqual(["/bin/zsh", "-il"]);
  });

  test("PowerShellは-Commandでcommandをそのまま渡す", () => {
    const cmd = ["powershell.exe", "-NoLogo"];
    appendCommandArgs(cmd, "Get-Process", undefined);
    expect(cmd).toEqual(["powershell.exe", "-NoLogo", "-Command", "Get-Process"]);
  });

  test("PowerShellはcaptureStdoutTo指定時にリダイレクトを追記する", () => {
    const cmd = ["powershell.exe", "-NoLogo"];
    appendCommandArgs(cmd, "Get-Process", "C:\\Users\\foo\\out.txt");
    expect(cmd).toEqual([
      "powershell.exe",
      "-NoLogo",
      "-Command",
      'Get-Process > "C:\\Users\\foo\\out.txt"',
    ]);
  });

  test("Unix系シェルはログイン(-l)かつインタラクティブ(-i)でcommandを実行する", () => {
    const cmd = ["/bin/zsh", "-il"];
    appendCommandArgs(cmd, "niwa tab var set -t tab-1 foo bar", undefined);
    expect(cmd).toEqual(["/bin/zsh", "-il", "-l", "-i", "-c", "niwa tab var set -t tab-1 foo bar"]);
  });

  test("Unix系シェルはcaptureStdoutTo指定時にリダイレクトを追記する", () => {
    const cmd = ["/bin/bash"];
    appendCommandArgs(cmd, "fzf", "/tmp/out.txt");
    expect(cmd).toEqual(["/bin/bash", "-l", "-i", "-c", "fzf > '/tmp/out.txt'"]);
  });

  test("wsl.exeはbash経由で$SHELLをログイン+インタラクティブモードでexecする（スペース分割しない）", () => {
    const cmd = ["wsl.exe", "-d", "NixOS"];
    appendCommandArgs(
      cmd,
      "node /abs/path/index.js open --editor nvim --target-pane tab-1",
      undefined,
    );
    expect(cmd).toEqual([
      "wsl.exe",
      "-d",
      "NixOS",
      "--",
      "bash",
      "-c",
      "exec \"$SHELL\" -l -i -c 'node /abs/path/index.js open --editor nvim --target-pane tab-1'",
    ]);
  });

  test("wsl.exeはcaptureStdoutTo指定時、Windowsパスを/mnt/形式に変換してリダイレクトする", () => {
    const cmd = ["wsl.exe", "-d", "NixOS"];
    appendCommandArgs(cmd, "fzf", "C:\\Users\\foo\\out.txt");
    expect(cmd).toEqual([
      "wsl.exe",
      "-d",
      "NixOS",
      "--",
      "bash",
      "-c",
      `exec "$SHELL" -l -i -c 'fzf > '\\''/mnt/c/Users/foo/out.txt'\\'''`,
    ]);
  });

  test("wsl.exeはcaptureStdoutToのパス変換に失敗した場合リダイレクトを付けずcommandのみ渡す", () => {
    const cmd = ["wsl.exe", "-d", "NixOS"];
    appendCommandArgs(cmd, "fzf", "relative\\path.txt");
    expect(cmd).toEqual([
      "wsl.exe",
      "-d",
      "NixOS",
      "--",
      "bash",
      "-c",
      "exec \"$SHELL\" -l -i -c 'fzf'",
    ]);
  });

  test("wsl.exeの大文字小文字を区別しない", () => {
    const cmd = ["WSL.EXE", "-d", "NixOS"];
    appendCommandArgs(cmd, "fzf", undefined);
    expect(cmd).toEqual([
      "WSL.EXE",
      "-d",
      "NixOS",
      "--",
      "bash",
      "-c",
      "exec \"$SHELL\" -l -i -c 'fzf'",
    ]);
  });
});

describe("withPtyExec", () => {
  test("ラッパーのパスが解決できていればcmdの先頭へ差し込む", () => {
    expect(
      withPtyExec(["/bin/zsh", "-il"], "/repo/vendor/libghostty/lib/niwaterm-ptyexec"),
    ).toEqual(["/repo/vendor/libghostty/lib/niwaterm-ptyexec", "/bin/zsh", "-il"]);
  });

  test("ラッパーが無い場合（Windows・build:native未実行）はcmdをそのまま返す", () => {
    const cmd = ["powershell.exe", "-NoLogo"];
    expect(withPtyExec(cmd, undefined)).toEqual(cmd);
  });

  test("空のcmdはラップしない", () => {
    expect(withPtyExec([], "/repo/vendor/libghostty/lib/niwaterm-ptyexec")).toEqual([]);
  });

  test("シェルの-l -i -c等を組み立てた後の引数列もそのまま保たれる", () => {
    const cmd = ["/bin/zsh", "-il"];
    appendCommandArgs(cmd, "ghq-select", "/tmp/out");
    expect(withPtyExec(cmd, "/ptyexec")).toEqual([
      "/ptyexec",
      "/bin/zsh",
      "-il",
      "-l",
      "-i",
      "-c",
      "ghq-select > '/tmp/out'",
    ]);
  });
});

describe("buildEnv", () => {
  /** テスト対象がprocess.envを直接読むため、退避してから書き換える */
  function withProcessEnv(patch: Record<string, string>, fn: () => void): void {
    const saved = new Map(Object.keys(patch).map((key) => [key, process.env[key]]));
    Object.assign(process.env, patch);
    try {
      fn();
    } finally {
      for (const [key, value] of saved) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  }

  test("起動元のマルチプレクサ由来の環境変数をタブへ渡さない", () => {
    withProcessEnv(
      { TMUX: "/tmp/tmux-501/default,19763,3", TMUX_PANE: "%47", TERM_PROGRAM_VERSION: "3.7c" },
      () => {
        const env = buildEnv(["/bin/zsh"], "xterm-256color", undefined);
        expect(env["TMUX"]).toBeUndefined();
        expect(env["TMUX_PANE"]).toBeUndefined();
        expect(env["TERM_PROGRAM_VERSION"]).toBeUndefined();
        expect(env["TERM_PROGRAM"]).toBe("niwaterm");
        expect(env["TERM"]).toBe("xterm-256color");
      },
    );
  });

  test("ビルド時設定のNIWATERM_APP_NAMEはタブへ渡さない", () => {
    withProcessEnv({ NIWATERM_APP_NAME: "niwaterm-daily" }, () => {
      const env = buildEnv(["/bin/zsh"], "xterm-256color", {
        NIWATERM_APP_VARIANT: "niwaterm-wip",
      });
      expect(env["NIWATERM_APP_NAME"]).toBeUndefined();
      expect(env["NIWATERM_APP_VARIANT"]).toBe("niwaterm-wip");
    });
  });

  test("extraEnvはprocess.envより優先される", () => {
    withProcessEnv({ NIWATERM_TAB_ID: "tab-old" }, () => {
      const env = buildEnv(["/bin/zsh"], "xterm-256color", { NIWATERM_TAB_ID: "tab-1" });
      expect(env["NIWATERM_TAB_ID"]).toBe("tab-1");
    });
  });
});

describe("encodeRelayFrame", () => {
  test("種類1バイト・長さu32 LE・中身の順に並べる", () => {
    const frame = encodeRelayFrame(0, new TextEncoder().encode("ls\r"));
    expect([...frame]).toEqual([0, 3, 0, 0, 0, 0x6c, 0x73, 0x0d]);
  });

  test("リサイズはcols・rowsをu16 LEで並べる", () => {
    expect([...encodeRelayResize(300, 40)]).toEqual([1, 4, 0, 0, 0, 0x2c, 0x01, 40, 0]);
  });
});

// PTYを制御端末にするptyexecが要る。Windowsとbuild:native未実行の環境では走らない
describe.skipIf(!ptyExecPath())("resizeのSIGWINCH", () => {
  test("フォアグラウンドのジョブにだけ届き、それを待つシェルには届かない", async () => {
    const child = `trap "echo CHILD_WINCH" WINCH; echo READY; sleep 1 & wait`;
    const pty = createPty({
      shell: "/bin/sh",
      cols: 80,
      rows: 24,
      term: "xterm-256color",
      command: `trap "echo SHELL_WINCH" WINCH; /bin/sh -c '${child}'; echo CHILD_DONE; sleep 0.2`,
    });
    let output = "";
    const decoder = new TextDecoder();
    const exited = new Promise<void>((resolve) => pty.onExit(() => resolve()));
    pty.onData((data) => {
      const before = output;
      output += decoder.decode(data);
      if (!before.includes("READY\r\n") && output.includes("READY\r\n")) pty.resize(100, 30);
    });

    await exited;

    expect(output).toContain("CHILD_WINCH");
    expect(output).toContain("CHILD_DONE");
    expect(output).not.toContain("SHELL_WINCH");
  });
});
