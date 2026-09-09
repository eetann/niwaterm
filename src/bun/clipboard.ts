// OS別クリップボードI/O。OSC52によるアプリ内コピー(terminal-session.ts)と
// Windows用のCtrl+Shift+C/V操作(index.ts)の両方から使う。
// WindowsはPowerShellの標準入出力エンコーディングが実行環境依存で文字化けしやすいため、
// [Console]::OpenStandardInput/Output経由でUTF-8バイト列を明示的に読み書きする
//
// PowerShellはコンソールアプリなので、windowsHideを付けないとniwaterm本体（コンソールを持たない
// GUI subsystemのbun.exe）から起動した際にコンソールウィンドウが割り当てられ、コピー・ペーストの
// たびにウィンドウが一瞬開いてフォーカスを奪う
// （詳細: docs/known-issues/windows-spawn-console-window-steals-focus.md）

const isWindows = process.platform === "win32";

// クリップボードへ書き込んだことの通知先（webview側のコピーバッジ表示に使う）。
// マウス選択・キーバインド・コピーモード・OSC52と経路が分かれているため、
// 呼び出し側それぞれではなく書き込み口の1箇所で拾う
let writeListener: ((text: string) => void) | null = null;

export function setClipboardWriteListener(listener: (text: string) => void): void {
  writeListener = listener;
}

export function writeClipboardText(text: string): void {
  writeToOs(text);
  writeListener?.(text);
}

function writeToOs(text: string): void {
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
      { stdin: "pipe", stderr: "ignore", windowsHide: true },
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
        { stdout: "pipe", stderr: "ignore", windowsHide: true },
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
