---
type: Known Issue
title: "Windows実機: Bun.spawnした子プロセスにコンソールウィンドウが割り当てられ、フォーカスを奪われる"
description: コンソールを持たないniwaterm本体（GUI subsystemのbun.exe）からwindowsHide無しでBun.spawnすると、子のコンソールアプリへ新しいコンソールウィンドウが割り当てられる。ペースト・シェル実行のたびにウィンドウが一瞬開いてniwatermからフォーカスが奪われるため、全てのBun.spawnにwindowsHide: trueを付ける
---

# Windows実機: Bun.spawnした子プロセスにコンソールウィンドウが割り当てられ、フォーカスを奪われる

## 症状

Windows実機で、ペースト（`paste-clipboard`）や`niwa.shell.run`を使うキーバインドを実行すると、
何かのウィンドウが一瞬表示されて消える。そのウィンドウにフォーカスが移るため、
消えた後もniwatermのwebviewへキー入力が戻らなくなる。

## 原因

**niwaterm本体のプロセス（`bun.exe`）はコンソールを持たない。**
タスクバー・Explorerからの起動でWindows Terminalが開くのを避けるため、`bun.exe`のPE Subsystemを
`WINDOWS_GUI`へ書き換えている（[タスクバーからdev/dailyビルドを起動するとWindows Terminalが開く](/known-issues/windows-taskbar-launch-opens-windows-terminal.md)）。
GUI subsystemの実行ファイルにはローダーがコンソールを自動割り当てしないため、
ターミナル以外から起動したniwatermはコンソールを一切持たない状態で動く。

この状態から`Bun.spawn`でコンソールアプリ（`powershell.exe`・`wsl.exe`）を起動すると、
子プロセスには継承できるコンソールが無いため**新しいコンソールが割り当てられ、そのウィンドウが表示される**。
子は一瞬で終了するのでウィンドウもすぐ消えるが、表示された時点でフォアグラウンドを奪うため、
niwatermのwebviewはキーボードフォーカスを失う。

PTY経由のタブ（`Bun.Terminal` = ConPTY）は擬似コンソールへ接続されるためこの問題を踏まない。
影響を受けるのは**PTYを経由しないワンショットの`Bun.spawn`**だけ。

### 実機での確認方法

GUI subsystemの`bun.exe`（appバンドル内の`bin/bun.exe`）から子プロセスを起動し、
子の中で`GetConsoleWindow()`を呼ぶと、コンソールウィンドウの有無をハンドル値で判定できる。

```ts
const ps =
  `Add-Type -Namespace K -Name N -MemberDefinition '[DllImport("kernel32.dll")] public static extern System.IntPtr GetConsoleWindow();'; [K.N]::GetConsoleWindow().ToString()`;
Bun.spawn(["powershell.exe", "-NoProfile", "-NonInteractive", "-Command", ps], {
  windowsHide: /* true or false */ false,
  stdout: "pipe",
});
```

このスクリプトを`Start-Process`（ShellExecute経由なので親のコンソールを継承しない）でGUI subsystemの
`bun.exe`に実行させたところ、`windowsHide`なしでは`consoleWindow=461450`（＝ウィンドウあり）、
`windowsHide: true`では`consoleWindow=0`（＝ウィンドウなし）になった。

## 対処

`Bun.spawn`のオプションに`windowsHide: true`を付ける。libuvの`UV_PROCESS_WINDOWS_HIDE_CONSOLE`
（`CREATE_NO_WINDOW`）に対応し、コンソールウィンドウの割り当て自体が起きなくなる。

**PTYを経由しない`Bun.spawn`をアプリ本体（`src/bun/`）へ新しく追加するときは、必ず`windowsHide: true`を付けること。**
現在の適用箇所は以下。

| ファイル | 起動するもの | 経路 |
| --- | --- | --- |
| `src/bun/clipboard.ts` | `powershell`（Set-Clipboard / Get-Clipboard） | コピー・ペースト、OSC52 |
| `src/bun/shell-run.ts` | シェルプロファイルのシェル（`wsl.exe`等） | `niwa.shell.run` |
| `src/bun/shell-profiles.ts` | `wsl.exe --list` | 起動時のシェルプロファイル検出 |
| `src/bun/windows-notification.ts` | `powershell.exe`（WinRT Toast） | `niwa.notify` |

`packages/cli`側の`Bun.spawn`/`Bun.spawnSync`はターミナルから実行される＝親がコンソールを持つため対象外。

## 関連

- [タスクバーからdev/dailyビルドを起動するとWindows Terminalが開き、閉じるとniwatermごと終了する](/known-issues/windows-taskbar-launch-opens-windows-terminal.md) — `bun.exe`をGUI subsystemへ書き換えている経緯
- [activateWindow()でpopup表示直後にキー入力が届かなくなる](/known-issues/windows-popup-activatewindow-focus-loss.md) — 同じくWindows実機でフォーカスを失う別原因の症状
- [Electrobunのデスクトップ通知がシェルに登録されない](/known-issues/windows-shell-notifyicon-not-registered.md) — `windows-notification.ts`がPowerShellを起動している理由
- [Windowsでのビルド・実行手順](/build/windows-build.md)
