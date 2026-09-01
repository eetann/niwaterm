---
type: Known Issue
title: "Windows実機: タスクバーからdev/dailyビルドを起動するとWindows Terminalが開き、閉じるとniwatermごと終了する"
description: Explorerやタスクバーからniwatermを起動しようとしたときに踏む2つの罠（ピン留め対象がbun.exeになる／devビルドのlauncherがbun.exeをコンソール付きで起動する）の原因と対処。後者はpostBuildフックでbun.exeのPE SubsystemをGUIへ書き換えて解消した
---

# Windows実機: タスクバーからdev/dailyビルドを起動するとWindows Terminalが開き、閉じるとniwatermごと終了する

普段遣いビルド(niwaterm-daily)をタスクバーから起動しようとしたときに、独立した2つの罠を続けて踏む。
どちらもdevチャンネルのまま普段遣いビルドを運用している構成
（[Windowsのstable/canaryビルドはそのまま直接実行できる展開済みappバンドルを作らない](/known-issues/windows-stable-build-not-directly-runnable.md)）に由来する。

## 症状1: タスクバーにピン留めしても起動しない（ウィンドウが一瞬見えて消える）

起動中のniwatermのタスクバーボタンを右クリック → 「タスクバーにピン留めする」でピン留めし、
そのアイコンから起動しようとすると、何かのウィンドウが一瞬表示されてすぐ消える。
`mise run start`での起動は問題なくできる。

### 原因

**Electrobunアプリのウィンドウを所有しているプロセスは`launcher.exe`ではなく子の`bun.exe`。**
そのためウィンドウからピン留めすると、Windowsは`bun.exe`をピン留め対象として記録する。

```
$env:APPDATA\Microsoft\Internet Explorer\Quick Launch\User Pinned\TaskBar\Bun.lnk
  Target    : ...\niwaterm-wip-dev\bin\bun.exe
  Arguments : (なし)
```

引数なしの`bun.exe`はヘルプを出力して即終了するため、コンソールが一瞬開いて閉じる。
アプリ側のビルド・起動方法の問題ではない。

### 対処

`bin\launcher.exe`を指すショートカットを自分で作り、そちらをピン留めする。

```powershell
$sh = New-Object -ComObject WScript.Shell
$lnk = $sh.CreateShortcut($env:APPDATA + '\Microsoft\Windows\Start Menu\Programs\niwaterm-daily.lnk')
$lnk.TargetPath = $env:USERPROFILE + '\niwaterm-worktrees\niwaterm\build\niwaterm-daily\dev-win-x64\niwaterm-daily-dev\bin\launcher.exe'
$lnk.WorkingDirectory = $env:USERPROFILE + '\niwaterm-worktrees\niwaterm'
$lnk.IconLocation = $lnk.TargetPath + ',0'
$lnk.Save()
```

`launcher.exe`はcwd・環境変数なしで起動できる（実機確認済み）。

- `APP_VARIANT`（wip/dailyの識別）は`scripts/write-app-variant.ts`が**ビルド時に焼き込む**ため、実行時の`NIWATERM_APP_NAME`は不要
- 初期タブのcwdは`getDefaultCwd()`未設定時に`homedir()`へフォールバックする（`src/bun/pty.ts`）ため、プロセスのcwdに依存しない
- `HUTCH_HOME`は`electrobun dev`（Hutch）用。`launcher.exe`の直接起動はHutchを経由しない（`mise run win:start:built`と同じ経路）

ビルドし直しても`launcher.exe`のパスは変わらないため、ショートカットは作り直さなくてよい。

## 症状2: 起動はできるが、同時にWindows Terminalが開き、閉じるとniwatermも終了する

`launcher.exe`から起動すると、niwatermのウィンドウとは別にWindows Terminalのウィンドウが開く。
そのターミナルを閉じるとniwatermごと終了する。

### 原因

`launcher.exe`自体はGUI subsystem（PE Subsystem = 2）だが、**同梱の`bun.exe`はCUI subsystem（= 3）**。
さらにElectrobunのlauncherはdevチャンネルのビルドでコンソール出力を有効にする分岐を持つ
（`launcher.exe`内の文字列で確認できる）。

```
Dev build detected - console output enabled
Console mode forced via ELECTROBUN_CONSOLE=1
Attached to parent console
```

ターミナルから起動した場合は親プロセスのコンソールへアタッチするだけなので何も起きない。
一方Explorer・タスクバーから起動すると親コンソールが存在しないため、CUI subsystemの`bun.exe`に
**新しいコンソールが割り当てられ**、Windows 11の既定のターミナルアプリであるWindows Terminalへ
引き渡される。開いたウィンドウのタイトルが`...\bin\bun.exe`になっているのがその証拠。

そのウィンドウを閉じるとコンソールにアタッチしているプロセスへ`CTRL_CLOSE_EVENT`が送られるため、
`bun.exe`＝niwatermのメインプロセスが終了する。

`ElectrobunConfig`にコンソール出力を切る設定は無く、この判定はlauncherバイナリ側に焼き込まれているため、
設定では回避できない。

### 対処

`scripts/patch-win-bun-subsystem.ts`を`postBuild`フックとして登録し、appバンドル内の`bun.exe`の
PE Subsystemを`WINDOWS_CUI`(3)から`WINDOWS_GUI`(2)へ書き換える。GUI subsystemの実行ファイルには
ローダーがコンソールを自動割り当てしないため、Windows Terminalが開かなくなる。

**開発時のログ出力は失われない。** コンソールの継承はsubsystemとは独立しているため、
親（`mise run start`のPowerShell）がコンソールを持っていれば標準出力はそのまま継承される。
実機で`[bun] ipc server listening ...`・`niwaterm started`等のアプリ側の出力が
書き換え後も取得できることを確認済み。

スクリプトは冪等（既にGUIなら書き込まない）で、`--watch`の再ビルドで起動中の`bun.exe`を掴んで
EBUSYになるのを避けている。書き込みに失敗してもビルド自体は失敗させない。

## 関連

- [Windowsでのビルド・実行手順](/build/windows-build.md) — 「タスクバーから起動する」節
- [Windowsのstable/canaryビルドはそのまま直接実行できる展開済みappバンドルを作らない](/known-issues/windows-stable-build-not-directly-runnable.md) — devチャンネルで普段遣いビルドを運用している経緯
- `scripts/patch-win-bun-subsystem.ts` — postBuildフック本体
- `electrobun.config.ts` — `scripts.postBuild`
