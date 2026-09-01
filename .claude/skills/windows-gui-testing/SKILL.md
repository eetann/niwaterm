---
name: windows-gui-testing
description: |
  niwatermのWindows実機（ElectrobunアプリのGUI）をAIがWSLから起動・操作・動作確認するノウハウ。
  トリガー: Windows実機での動作確認、NixOS(WSL)タブの動作確認、「Windowsで確認して」「実機で試して」
---

niwaterm（Electrobunアプリ）はLinux非対応のため、**AIがWSL/Linux環境で作業していて
アプリ本体をローカルで直接実行できない場合**（Windows実機側から直接作業している場合はこのスキルは
不要）、Windows実機の動作確認・NixOS(WSL)タブの動作確認は、`powershell.exe`（WSL interop）
経由でWindows側を操作する。リモートデスクトップやユーザーへの操作依頼を都度挟まなくても、
起動・操作・停止・スクリーンショット撮影まで基本的にWSL側から完結する。

とくにNixOS(WSL)タブの挙動確認は、WSL/Linux環境の中だけで完結させようとしないこと。
確認すべきは「Windows上で動くniwatermアプリが、WSLディストロをどう扱うか」なので、
アプリ自体は必ずWindows実機ビルドで動かす。

**動作確認は必ず開発中ビルドwip（`niwaterm-wip-dev`）を使い、daily（`niwaterm-daily-dev`）には
触らないこと**。`mise run start`は現在の作業ディレクトリのブランチで自動判定する
（`main`ブランチ＝このリポジトリ本体のメインワークツリーならdaily、それ以外
（gtrで追加したdevブランチのworktree）ならwip）ため、**必ずdevブランチのworktree内にいることを
確認してから実行する**。dailyはユーザーが普段使いしているインスタンスで、
起動・停止・再起動は作業中のセッション・ポップアップ等を巻き込んで壊す。CLIで実機確認する際も
`niwaterm ping`等が意図せずdaily側（アプリ名未指定時のCLIのデフォルト接続先はdaily相当、
packages/cli/src/ipc-client.ts参照）に繋がらないよう、接続先インスタンスを明示する:
`NIWATERM_APP_VARIANT=niwaterm-wip niwaterm ping`。
WSLブリッジのポートは動的割り当てなので番号を調べる必要はない（CLIがwipの`bridge-port`
ファイルから読む）。

## 前提: WSL→Windows同期

コードはWindows側に別途チェックアウトされている前提（Electrobunはクロスビルド不可）。
コード変更後は毎回同期してから検証する:

```bash
mise run win:sync
```

（初回で`NIWATERM_WIN_WORKTREES_ROOT`未設定の場合はコマンドが設定方法を案内するので、それに従う。
wipはgtrで追加したgit worktree（devブランチ）、dailyはこのリポジトリ本体（mainブランチ、
gitのメインワークツリー）という別々の実体から動かす運用のため、Windows側も
`niwaterm-worktrees/<ディレクトリ名>/`という配置になる。以降のコマンド例の`<worktree名>`は、
操作対象のディレクトリ名（`basename "$(git rev-parse --show-toplevel)"`で取得できる）に読み替える）

## PowerShellコマンドの定型

WSL interopで`powershell.exe`を叩くときは、日本語文字化け対策とPATH復元が毎回必要
（wingetでのインストール直後などはユーザーPATHがWSL起動時点のものしか見えない）。
詳細はdocs/build/windows-build.md「WSLからWindows側を操作する場合」参照。

```bash
PS_PREFIX='[Console]::OutputEncoding=[Text.Encoding]::UTF8; $env:PATH=[Environment]::GetEnvironmentVariable("PATH","User")+";"+[Environment]::GetEnvironmentVariable("PATH","Machine")+";"+$env:USERPROFILE+"\.bun\bin"; '
powershell.exe -NoProfile -Command "$PS_PREFIX <実行したいコマンド>"
```

末尾の`\.bun\bin`はniwaterm CLI（後述）用。単にbun/electrobunコマンドを叩くだけなら不要。

## niwaterm CLIのセットアップ（Windows側、初回のみ）

CLIはWindows側リポジトリで別途linkが必要（WSL側でlinkしても同期されない・意味がない）。

```bash
WORKTREE_NAME=$(basename "$(git rev-parse --show-toplevel)")
powershell.exe -NoProfile -Command "$PS_PREFIX cd \$env:USERPROFILE\niwaterm-worktrees\\$WORKTREE_NAME\packages\cli; bun link"
```

`niwaterm --version`で疎通確認。`command not found`になる場合は上記PS_PREFIXの
`\.bun\bin`付与を忘れていないか確認する（`bin`フィールド経由で`~/.bun/bin`に登録されるため）。

**NixOS(WSL)タブの動作確認をする場合は、このBashツールが動いているWSLディストロ自体にも
別途`bun link`が要る**（Windows側でlinkしても別のLinux環境なので反映されない）。

```bash
cd /mnt/c/Users/<ユーザー名>/niwaterm-worktrees/<worktree名>/packages/cli
bun link
```

WSLディストロからWindows側アプリ本体への接続はTCPブリッジ（固定ポート、WSL用仮想アダプタに
バインド）経由になる。仕組みの詳細はdocs/build/windows-build.md「6. WSLディストロから
niwaterm CLIを使う」参照。アプリ起動後、WSLディストロ側で`niwaterm ping`が通れば疎通確認完了。

## アプリの起動・停止

devモードはGUIアプリなのでバックグラウンド起動し、ログをファイルへリダイレクトする。
`NIWATERM_DEBUG_PTY=1`は一時的な診断用（コミット対象外のデバッグコードを仕込んだ時のみ使う）。

```bash
WORKTREE_NAME=$(basename "$(git rev-parse --show-toplevel)")
powershell.exe -NoProfile -Command "[Console]::OutputEncoding=[Text.Encoding]::UTF8; \$env:PATH=[Environment]::GetEnvironmentVariable('PATH','User')+';'+[Environment]::GetEnvironmentVariable('PATH','Machine'); cd \$env:USERPROFILE\niwaterm-worktrees\\$WORKTREE_NAME; bun x electrobun dev" > /path/to/scratchpad/niwaterm-wip.log 2>&1 &
disown
```

停止・再起動は`bun.exe`と`electrobun.exe`のプロセスをまとめて止める（プロセス名で複数ヒットする）:

```bash
powershell.exe -NoProfile -Command "$PS_PREFIX Get-Process | Where-Object { \$_.ProcessName -match 'bun|electrobun' } | Select-Object Id,ProcessName"
powershell.exe -NoProfile -Command "$PS_PREFIX Stop-Process -Id <上で確認したId群をカンマ区切り> -Force -ErrorAction SilentlyContinue"
```

**ログファイルのバッファリングに注意**: PowerShell経由のリダイレクトは、出力が数分単位で
バッファされて「止まって見える」ことがある。実際は動いているのに古い内容しか読めない時は、
何か新しい操作（キー送信など）を送って新規出力を発生させるとまとめてフラッシュされる。

## niwaterm CLIでの操作

疎通確認・一覧・レイアウト操作は`.claude/skills/niwaterm-cli/SKILL.md`と
`niwaterm docs show cli`が正。ここではハマりやすい引数の形だけメモする。

- `tab send-keys`はキーを**位置引数**で渡す（`-k`のようなオプションではない）:
  `niwaterm tab send-keys --tab tab-3 'echo foo' Enter`
- `tab switch`は`--tile`必須: `niwaterm tab switch --tile tile-4 --tab tab-6`
- WSLディストロ等のシェルプロファイルIDは`niwaterm shell-profiles`で確認してから
  `niwaterm tab new -t <tileId> -s <shellProfileId>`で作成する

## 目視確認・スクリーンショット

PowerShell標準の.NET（`System.Drawing`）だけでWindowsデスクトップのスクリーンショットが撮れる。
追加ツールのインストールは不要。まず`niwaterm tab show --tab <tabId>`で対象タブを前面化してから撮る:

```bash
powershell.exe -NoProfile -Command "Add-Type -AssemblyName System.Windows.Forms,System.Drawing; \$b=[System.Windows.Forms.SystemInformation]::VirtualScreen; \$bmp=New-Object System.Drawing.Bitmap \$b.Width,\$b.Height; \$g=[System.Drawing.Graphics]::FromImage(\$bmp); \$g.CopyFromScreen(\$b.Location,[System.Drawing.Point]::Empty,\$b.Size); \$bmp.Save(\"\$env:TEMP\niwaterm-shot.png\",[System.Drawing.Imaging.ImageFormat]::Png)"
```

保存先は`$env:TEMP`（通常`C:\Users\<ユーザー名>\AppData\Local\Temp`）なので、`$env:USERPROFILE`直下を汚さない。
WSLからは`/mnt/c/Users/<ユーザー名>/AppData/Local/Temp/niwaterm-shot.png`として`Read`ツールでそのまま読める。
使い終わったら`rm`で消しておく（Windows側のTempも溜まり続けるとゴミになるため）。

**既知の制約**: リモートデスクトップ接続が切断された状態（サインインはしているが非アクティブな
RDPセッション）だと、GDI経由のキャプチャが黒画面になることがある。実機に直接ログインしている
通常の状態なら問題ない。黒画面になった場合はユーザーに手動でスクリーンショットを撮って共有して
もらう。

## キーボードショートカット・マウス操作のシミュレーション

`niwaterm tab send-keys`はPTYへの文字列送信（tmuxのsend-keys相当）であり、
Ctrl+Shift+CやCtrl+Shift+VのようなGUIレベルのキーボードショートカット（webviewの
keydownイベント経由でRPCが飛ぶもの）は発火できない。これらを検証するにはOSレベルの
キー・マウスイベント注入が必要で、`System.Windows.Forms.SendKeys`と`user32.dll`の
`mouse_event`/`SetCursorPos`をP/Invokeで使う。

**`SetForegroundWindow`だけではwebviewにキー入力が届かない**。`GetForegroundWindow`で
確認すると対象プロセスが確かにフォアグラウンドになっていても、SendKeysで送ったキーが
無視されることがある。原因はCLAUDE.mdにある「キーボード入力には明示的なフォーカスが必要」
という制約で、ウィンドウ自体のフォアグラウンド化とwebview内DOM要素へのfocus()は別物。
**確実なのはウィンドウのタイトルバーではなく、ターミナル表示領域を実際にマウスクリックして
からSendKeysを送る**方法（クリックでwebview内の要素にfocusが移る）。

```powershell
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class Win32Mouse {
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint dwFlags, uint dx, uint dy, uint dwData, UIntPtr dwExtraInfo);
}
"@
[Win32Mouse]::SetCursorPos($x, $y)  # ターミナル表示領域内の座標（タイトルバーは不可）
Start-Sleep -Milliseconds 200
[Win32Mouse]::mouse_event(0x0002, 0, 0, 0, [UIntPtr]::Zero)  # LEFTDOWN
Start-Sleep -Milliseconds 100
[Win32Mouse]::mouse_event(0x0004, 0, 0, 0, [UIntPtr]::Zero)  # LEFTUP
Start-Sleep -Milliseconds 500
Add-Type -AssemblyName System.Windows.Forms
[System.Windows.Forms.SendKeys]::SendWait("^+v")  # Ctrl+Shift+V。^=Ctrl +=Shift %=Alt
```

対象座標はまずスクリーンショットを撮ってGUI要素の表示座標を特定し、
`実座標 = 表示座標 × (原寸/表示サイズ)`で換算する（Readツールで画像を開くと
「original WxH, displayed at wxh」が出るのでその比率を使う）。

ドラッグ選択（テキスト選択→コピーの検証など）はLEFTDOWN後に`SetCursorPos`を
少しずつ動かしながらループしてからLEFTUPする。1回のジャンプでは選択が発生しないことがある。

これらのP/Invokeスクリプトは複数行になるため、bashのヒアドキュメントで`/tmp`に書いてから
`cp`でWindows側の`$env:TEMP`へ置き、`powershell.exe -ExecutionPolicy Bypass -Command "& \$env:TEMP\foo.ps1"`
で実行するのが確実（`-Command`に長いスクリプトをインラインで詰め込むとクォートのエスケープが
bash→powershell.exeの二重引用ですぐ壊れる）。既定のExecutionPolicyはスクリプトファイルの
直接実行（`. $env:TEMP\foo.ps1`）を拒否するため、`-ExecutionPolicy Bypass -File`か
`-Command "& <path>"`を使う。

## 複数タブを同時に動かすとログが混ざる

診断用に一時的なconsole.errorログを仕込む場合、tabId等の識別子をログに含めないと
どのタブの出力か特定できず原因調査が困難になる。`createTerminalSession`の呼び出し元
（`src/bun/workspace.ts`の`spawnSession`）でtabIdを渡せるようにしてからログに含めること。
