// OS別クリップボードI/O。OSC52によるアプリ内コピー(terminal-session.ts)と
// Windows用のCtrl+Shift+C/V操作(index.ts)の両方から使う。
// WindowsはPowerShellの標準入出力エンコーディングが実行環境依存で文字化けしやすいため、
// [Console]::OpenStandardInput/Output経由でUTF-8バイト列を明示的に読み書きする

const isWindows = process.platform === "win32";

export function writeClipboardText(text: string): void {
  if (isWindows) {
    const proc = Bun.spawn(
      [
        "powershell",
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        "$stdin=[Console]::OpenStandardInput();$ms=New-Object System.IO.MemoryStream;" +
          "$stdin.CopyTo($ms);$text=[System.Text.Encoding]::UTF8.GetString($ms.ToArray());" +
          "Set-Clipboard -Value $text",
      ],
      { stdin: "pipe", stderr: "ignore" },
    );
    proc.stdin.write(text);
    proc.stdin.end();
    return;
  }
  const proc = Bun.spawn(["pbcopy"], { stdin: "pipe" });
  proc.stdin.write(text);
  proc.stdin.end();
}

export async function readClipboardText(): Promise<string> {
  try {
    if (isWindows) {
      const proc = Bun.spawn(
        [
          "powershell",
          "-NoProfile",
          "-NonInteractive",
          "-Command",
          "$text=Get-Clipboard -Raw -ErrorAction SilentlyContinue;if($null -eq $text){$text=''};" +
            "$bytes=[System.Text.Encoding]::UTF8.GetBytes($text);$stdout=[Console]::OpenStandardOutput();" +
            "$stdout.Write($bytes,0,$bytes.Length);$stdout.Flush()",
        ],
        { stdout: "pipe", stderr: "ignore" },
      );
      const text = await new Response(proc.stdout).text();
      await proc.exited;
      return text;
    }
    const proc = Bun.spawn(["pbpaste"], { stdout: "pipe" });
    const text = await new Response(proc.stdout).text();
    await proc.exited;
    return text;
  } catch (err) {
    console.log(`[bun] failed to read clipboard: ${String(err)}`);
    return "";
  }
}
