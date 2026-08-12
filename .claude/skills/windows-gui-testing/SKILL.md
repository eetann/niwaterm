---
name: windows-gui-testing
description: |
  niwatermのWindows実機（ElectrobunアプリのGUI）をAIがWSLから起動・操作・動作確認するノウハウ。
  トリガー: Windows実機での動作確認、NixOS(WSL)タブの動作確認、「Windowsで確認して」「実機で試して」
---

niwaterm（Electrobunアプリ）はLinux非対応のため、**AIがWSL/Linux環境で作業していて
`bun run start`が直接実行できない場合**（Windows実機側から直接作業している場合はこのスキルは
不要）、Windows実機の動作確認・NixOS(WSL)タブの動作確認は、`powershell.exe`（WSL interop）
経由でWindows側を操作する。リモートデスクトップやユーザーへの操作依頼を都度挟まなくても、
起動・操作・停止・スクリーンショット撮影まで基本的にWSL側から完結する。

とくにNixOS(WSL)タブの挙動確認は、WSL/Linux環境の中だけで完結させようとしないこと。
確認すべきは「Windows上で動くniwatermアプリが、WSLディストロをどう扱うか」なので、
アプリ自体は必ずWindows実機ビルドで動かす。

## 前提: WSL→Windows同期

コードはWindows側に別途チェックアウトされている前提（Electrobunはクロスビルド不可）。
コード変更後は毎回同期してから検証する:

```bash
mise run win:sync
```

（初回で`NIWATERM_WIN_REPO`未設定の場合はコマンドが設定方法を案内するので、それに従う）

## PowerShellコマンドの定型

WSL interopで`powershell.exe`を叩くときは、日本語文字化け対策とPATH復元が毎回必要
（wingetでのインストール直後などはユーザーPATHがWSL起動時点のものしか見えない）。
詳細はdocs/windows-build.md「WSLからWindows側を操作する場合」参照。

```bash
PS_PREFIX='[Console]::OutputEncoding=[Text.Encoding]::UTF8; $env:PATH=[Environment]::GetEnvironmentVariable("PATH","User")+";"+[Environment]::GetEnvironmentVariable("PATH","Machine")+";"+$env:USERPROFILE+"\.bun\bin"; '
powershell.exe -NoProfile -Command "$PS_PREFIX <実行したいコマンド>"
```

末尾の`\.bun\bin`はniwaterm CLI（後述）用。単にbun/electrobunコマンドを叩くだけなら不要。

## niwaterm CLIのセットアップ（Windows側、初回のみ）

CLIはWindows側リポジトリで別途linkが必要（WSL側でlinkしても同期されない・意味がない）。

```bash
powershell.exe -NoProfile -Command "$PS_PREFIX cd \$env:USERPROFILE\niwaterm\packages\cli; bun link"
```

`niwaterm --version`で疎通確認。`command not found`になる場合は上記PS_PREFIXの
`\.bun\bin`付与を忘れていないか確認する（`bin`フィールド経由で`~/.bun/bin`に登録されるため）。

## アプリの起動・停止

devモードはGUIアプリなのでバックグラウンド起動し、ログをファイルへリダイレクトする。
`NIWATERM_DEBUG_PTY=1`は一時的な診断用（コミット対象外のデバッグコードを仕込んだ時のみ使う）。

```bash
powershell.exe -NoProfile -Command "[Console]::OutputEncoding=[Text.Encoding]::UTF8; \$env:PATH=[Environment]::GetEnvironmentVariable('PATH','User')+';'+[Environment]::GetEnvironmentVariable('PATH','Machine'); cd \$env:USERPROFILE\niwaterm; bun run start" > /path/to/scratchpad/niwaterm-dev.log 2>&1 &
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

- `send-keys`はキーを**位置引数**で渡す（`-k`のようなオプションではない）:
  `niwaterm send-keys --tab tab-3 'echo foo' Enter`
- `switch-tab`は`--tile`必須: `niwaterm switch-tab --tile tile-4 --tab tab-6`
- WSLディストロ等のシェルプロファイルIDは`niwaterm shell-profiles`で確認してから
  `niwaterm new-tab -t <tileId> -s <shellProfileId>`で作成する

## 目視確認・スクリーンショット

PowerShell標準の.NET（`System.Drawing`）だけでWindowsデスクトップのスクリーンショットが撮れる。
追加ツールのインストールは不要。まず`niwaterm show-tab --tab <tabId>`で対象タブを前面化してから撮る:

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

## 複数タブを同時に動かすとログが混ざる

診断用に一時的なconsole.errorログを仕込む場合、tabId等の識別子をログに含めないと
どのタブの出力か特定できず原因調査が困難になる。`createTerminalSession`の呼び出し元
（`src/bun/workspace.ts`の`spawnSession`）でtabIdを渡せるようにしてからログに含めること。
