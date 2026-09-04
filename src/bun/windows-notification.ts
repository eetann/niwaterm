// Windows向けデスクトップ通知。ElectrobunのUtils.showNotification（Shell_NotifyIconW実装）は
// オーナーウィンドウとしてメッセージ専用ウィンドウ（HWND_MESSAGE）を使っており、Windowsのシェルが
// これをタスクトレイアイコンのオーナーとして認識できず、NIM_ADDが成功を返すにもかかわらず
// 実際には一切登録されない（「通知領域アイコン」設定に一件も現れない。Electrobun側の
// ネイティブ実装のバグ）。そのためWindowsだけはPowerShell経由でWinRT
// ToastNotificationManagerを直接呼ぶ。AUMID（Application User Model ID）はショートカット登録
// なしで動くよう、レジストリ（HKCU\SOFTWARE\Classes\AppUserModelId\<AppId>）へ自己登録してから使う。
// Windows標準搭載のPowerShell 5.1（powershell.exe）だけで完結し、追加インストールは不要。
//
// クリック時のアクティベーション（ToastActivated相当）には常駐プロセスかCOM Activator登録が必要で
// 実装コストが大きいため表示のみ対応する（クリックしてもniwatermへのフォーカス移動は行わない）。

import type { NiwaNotifyOptions } from "@niwaterm/config";
import { APP_VARIANT } from "./app-variant.generated";

const APP_ID = `dev.eetann.${APP_VARIANT}`;

/** PowerShellのシングルクォート文字列リテラルとして安全に埋め込む（シングルクォートは2つ重ねてエスケープ） */
function psQuote(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function resolveBodyLine(opts: NiwaNotifyOptions): string {
  if (!opts.subtitle) return opts.body ?? "";
  return opts.body ? `${opts.subtitle}\n${opts.body}` : opts.subtitle;
}

/**
 * WinRT ToastNotificationManagerを呼ぶPowerShellスクリプトを組み立てる。
 * title/bodyはPowerShellの文字列リテラルとしてエスケープした上で、XMLエスケープは
 * PowerShell側の[System.Security.SecurityElement]::Escapeに任せる（TS側での二重エスケープを避ける）
 */
export function buildToastScript(appId: string, opts: NiwaNotifyOptions): string {
  const bodyLine = resolveBodyLine(opts);
  const audioTag = opts.silent ? '<audio silent="true"/>' : "";
  return `
$ErrorActionPreference = "Stop"
$AppId = ${psQuote(appId)}
$RegPath = "HKCU:\\SOFTWARE\\Classes\\AppUserModelId\\$AppId"
if (-not (Test-Path $RegPath)) {
  New-Item -Path $RegPath -Force | Out-Null
  Set-ItemProperty -Path $RegPath -Name "DisplayName" -Value "niwaterm" -Type String
}

[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
[Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime] | Out-Null

$title = [System.Security.SecurityElement]::Escape(${psQuote(opts.title)})
$body = [System.Security.SecurityElement]::Escape(${psQuote(bodyLine)})
$audio = ${psQuote(audioTag)}

$xmlText = "<toast><visual><binding template=\`"ToastGeneric\`"><text>$title</text><text>$body</text></binding></visual>$audio</toast>"

$xml = New-Object -TypeName Windows.Data.Xml.Dom.XmlDocument
$xml.LoadXml($xmlText)
$toast = New-Object -TypeName Windows.UI.Notifications.ToastNotification -ArgumentList $xml
[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($AppId).Show($toast)
`;
}

export function sendWindowsNotification(opts: NiwaNotifyOptions): void {
  const script = buildToastScript(APP_ID, opts);
  const encoded = Buffer.from(script, "utf16le").toString("base64");
  try {
    const proc = Bun.spawn(
      ["powershell.exe", "-NoProfile", "-NonInteractive", "-EncodedCommand", encoded],
      // 通知のたびにコンソールウィンドウが一瞬開くのを防ぐ
      // （詳細: docs/known-issues/windows-spawn-console-window-steals-focus.md）
      { stdout: "ignore", stderr: "pipe", windowsHide: true },
    );
    void (async () => {
      const [stderr, exitCode] = await Promise.all([new Response(proc.stderr).text(), proc.exited]);
      if (exitCode !== 0) {
        console.log(`[bun] sendWindowsNotification failed (exit ${exitCode}): ${stderr}`);
      }
    })();
  } catch (err) {
    console.log(`[bun] sendWindowsNotification failed to spawn powershell.exe: ${String(err)}`);
  }
}
