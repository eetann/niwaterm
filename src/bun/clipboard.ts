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

/**
 * macOSのpbcopy/pbpasteが読み書きするエンコーディングはロケール環境変数で決まり、
 * 未設定だとシステム既定（日本語環境ならShift_JIS）としてUTF-8バイト列を解釈するため、
 * 非ASCIIが化けるか、変換できずクリップボードが空になる。.appから起動したniwatermは
 * ロケール変数を持たないので明示する。他のロケール変数より優先されるLC_ALLを使い、
 * ユーザー環境側の設定に左右されないようにする
 * （詳細: docs/known-issues/macos-pbcopy-needs-utf8-locale.md）
 */
const macClipboardEnv = { ...process.env, LC_ALL: "en_US.UTF-8" };

// クリップボードへ書き込んだことの通知先（webview側のコピーバッジ表示に使う）。
// マウス選択・キーバインド・コピーモードと経路が分かれているため、
// 呼び出し側それぞれではなく書き込み口の1箇所で拾う
let writeListener: ((text: string) => void) | null = null;

export function setClipboardWriteListener(listener: (text: string) => void): void {
  writeListener = listener;
}

/** ユーザー操作によるコピー。書き込んだことをリスナー（コピーバッジ）へ伝える */
export function writeClipboardText(text: string): void {
  writeToOs(text);
  writeListener?.(text);
}

/**
 * ターミナル上のアプリからのコピー（OSC 52）。vimのyank等でユーザーが「コピーした」と
 * 意識しないまま頻繁に発火するため、writeClipboardTextと違いリスナーへは伝えない
 */
export function writeClipboardTextFromApp(text: string): void {
  writeToOs(text);
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
    void proc.stdin.write(text);
    void proc.stdin.end();
    return;
  }
  Bun.spawn(["pbcopy"], { stdin: new TextEncoder().encode(text), env: macClipboardEnv });
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
    const proc = Bun.spawn(["pbpaste"], { stdout: "pipe", env: macClipboardEnv });
    const text = await new Response(proc.stdout).text();
    await proc.exited;
    return text;
  } catch (err) {
    console.log(`[bun] failed to read clipboard: ${String(err)}`);
    return "";
  }
}
