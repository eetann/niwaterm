---
type: Runbook
title: Windowsでのビルド・実行手順
description: Windows実機でniwatermをビルド・実行するための手順（ネイティブライブラリのWSLからのクロスビルド含む）
---

# Windowsでのビルド・実行手順

Windowsでniwatermをビルド・実行するための手順。

> **状態**: Windows 11 x64で動作確認済み。`browser-screenshot`のみBun本体側の既知issue（後述）により動作しない。

## 全体像

Electrobunは**クロスコンパイルできない**（ホストプラットフォーム向けにしかビルドされない）ため、
アプリ本体のビルドと起動は**Windows実機**で行う必要がある。

一方でネイティブライブラリ（libghostty-vt / shim）はZigのクロスコンパイルでWSL側から生成できるため、
**Windows側にはMSVCもZigも不要**。

```
[WSL/Linux側]                          [Windows側]
zig build (クロスコンパイル)
  ├─ ghostty-vt.dll  ──────copy──────▶ vendor/libghostty/bin/
  └─ niwashim.dll    ──────copy──────▶ vendor/libghostty/bin/
                                        bun install
                                        electrobun dev  ← アプリ起動
```

## 1. Windows側の前提を整える

### 必要なもの

| ツール           | 用途                                                          | 確認コマンド    |
| ---------------- | ------------------------------------------------------------- | --------------- |
| Bun 1.4.0以上   | ランタイム。**Bun.TerminalのWindows(ConPTY)対応が1.3.14から** | `bun --version` |
| Git              | リポジトリのclone                                             | `git --version` |
| WebView2 Runtime | Electrobunの描画基盤                                          | 下記参照        |

> **開発機のBunとは別に、Hutch（electrobunのビルドツールチェーン）がアプリに同梱するBunがある。**
> electrobun 2.0.5が同梱するBunは**1.4.4**でConPTY対応(1.3.14以降)を満たしている。
> electrobun 1.x時代にあった`build.bunVersion`での明示的上書きは2.x系で廃止された
> （Hutchがelectrobunのバージョンとペアリングされたランタイムを自動で用意するため）。

WebView2 Runtimeは Windows 11 および最近のWindows 10には標準で入っている。
未導入なら [Microsoft公式](https://developer.microsoft.com/microsoft-edge/webview2/) から Evergreen Runtime を入れる。

確認方法（PowerShell）:

```powershell
(Get-ItemProperty 'HKLM:\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}').pv
```

### インストール

PowerShellで実行する:

```powershell
winget install --id Oven-sh.Bun -e
winget install --id Git.Git -e
```

インストール後はPATHを反映させるためターミナルを開き直す。

### WSLからWindows側を操作する場合

`powershell.exe -NoProfile -Command "..."` で叩ける。定型として次の2つを覚えておくとよい。

```bash
powershell.exe -NoProfile -Command "[Console]::OutputEncoding=[Text.Encoding]::UTF8; \
  \$env:PATH=[Environment]::GetEnvironmentVariable('PATH','User')+';'+[Environment]::GetEnvironmentVariable('PATH','Machine'); \
  bun --version"
```

- `[Console]::OutputEncoding=...` — これが無いと日本語が文字化けする（WindowsのCP932出力をUTF-8として読むため）
- `$env:PATH=[Environment]::GetEnvironmentVariable(...)` — **wingetでのインストール直後は必須**。
  WSL interop経由のプロセスはWSL起動時のPATHを引き継ぐので、インストールで更新されたPATHが見えない。
  レジストリから読み直すことで解決する

## 2. Windows側にリポジトリを配置する

`\\wsl$` 越しにWSL側のリポジトリを直接ビルドする方法もあるが、ファイルI/Oが遅く
パス解決やファイル監視で問題が出やすいため、**Windows側に実体を置く**。

**wip用・daily用で別ディレクトリが必要**。electrobun 2.0.1のプロジェクトビルドロック
（`.hutch/locks/`）は同一ディレクトリ配下だと同時起動を許さないため、両方を同じディレクトリで
動かせない（詳細は「普段遣い用ビルドを同時に動かす」節参照）。wip用はgtrで追加したgit worktree
（devブランチ）、daily用はこのリポジトリ本体（mainブランチ、gitのメインワークツリー）という
別々の実体を使い、Windows側もそれぞれ`$env:USERPROFILE\niwaterm-worktrees\<ディレクトリ名>`の
ようにサブディレクトリへ配置する。

Windows側にgitを入れてcloneする場合:

```powershell
cd $env:USERPROFILE\niwaterm-worktrees
git clone <このリポジトリのURL> <ディレクトリ名>
```

gitを入れずにWSLのリポジトリからコピーする場合（`mise run win:sync`相当。動作確認だけならこれで十分）:

```bash
WORKTREE_NAME=$(basename "$(git rev-parse --show-toplevel)")
WIN="$NIWATERM_WIN_WORKTREES_ROOT/$WORKTREE_NAME"
mkdir -p "$WIN"
rsync -a --exclude '.git' --exclude 'node_modules' --exclude 'build' --exclude 'vendor' \
  <repo>/ "$WIN/"
```

`node_modules` はWindows側で入れ直す（ネイティブなbunバイナリが必要なため、rsyncの同期対象外）:

```powershell
cd $env:USERPROFILE\niwaterm-worktrees\<worktree名>
bun install
```

`mise run win:sync`はこの`bun install`まで自動で行う（新規ディレクトリ作成時・`package.json`変更時の
同期漏れを防ぐため毎回実行する。依存が変わっていなければキャッシュが効き高速）。上記は
`mise`を使わず完全手動でセットアップする場合の代替手順。

## 3. ネイティブライブラリをビルドする（WSL側）

Zigはクロスコンパイルできるので、WSL側でWindows向けの`.dll`を作る。

`vendor/`はgit worktree間で共有されない（`.gitignore`対象のため）。gtrでdev用worktreeを
作成した際は`.gtrconfig`の`postCreate`フックがmainブランチ側から`vendor/`を丸ごとコピーするため、
通常このセクションを新規worktreeごとに実行する必要はない。以下は初回セットアップ、または
libghostty-vtのバージョンを上げるなどvendorそのものを更新する場合の手順（更新後は
`mise run daily:merge-dev`実行時にdev側からmain側へ同様にコピーされる）。

### 3-1. ghosttyのソースを取得する

`vendor/` は `.gitignore` 対象なので、各環境で取得する。

```bash
opensrc path ghostty-org/ghostty@v1.4.0   # 取得先パスが返る（タグはmise.tomlのghostty_ref）
```

取得したソースを `vendor/libghostty/` に配置する。

### 3-2. libghostty-vt をWindows向けにビルドする

**Zig 0.17.0以上が必要**（ghosttyのbuild.zig.zonが `minimum_zig_version = 0.17.0` を要求する。バージョンは`mise.toml`の`[vars]`の`zig_version`）。

```bash
mise run build:vendor:win
```

タスクはビルドの前に `scripts/patch-ghostty-formatter.ts` でniwaterm用のパッチを当てる
（フォーマッタが空セルへ背景色をにじませるのを直すもの。詳細:
[/known-issues/libghostty-vt-formatter-bleeds-bg-into-skipped-cells.md](/known-issues/libghostty-vt-formatter-bleeds-bg-into-skipped-cells.md)）。
適用済みなら何もしないので、何度実行してもよい。

中身は次のコマンド:

```bash
bun scripts/patch-ghostty-formatter.ts vendor/libghostty
cd vendor/libghostty
mise exec zig@0.17.0 -- zig build -Demit-lib-vt \
  -Dtarget=x86_64-windows-gnu \
  -Doptimize=ReleaseFast \
  --prefix "$PWD"
```

`-Dtarget=x86_64-windows-gnu` の **`-gnu` は必須**。
ghosttyのbuild.zigはWindowsターゲット時にABIをMSVCへ自動で切り替えるため、
省略するとWSL上に無いMSVCツールチェーンを要求されて失敗する。

生成物:

```
vendor/libghostty/bin/ghostty-vt.dll   ← 実行時に必要
vendor/libghostty/lib/ghostty-vt.lib   ← リンク時に必要（インポートライブラリ）
vendor/libghostty/include/             ← ヘッダ
```

macOSの `.dylib` と違い、**DLL本体は `lib/` ではなく `bin/` に出力される**点に注意。
`src/bun/ghostty.ts` もWindowsでは `vendor/libghostty/bin` を探索する。

### 3-3. shim をWindows向けにビルドする

```bash
mise run build:native
```

`build:native`は実行環境からターゲットを判別して振り分けるだけのタスクで、WSLでは
`build:native:win`（`mise.toml`参照）が動く。中身は次のコマンド:

```bash
mise exec zig@0.17.0 -- zig cc -target x86_64-windows-gnu -shared \
  -Ivendor/libghostty/include \
  src/native/shim.c \
  -Lvendor/libghostty/lib -lghostty-vt \
  -o vendor/libghostty/bin/niwashim.dll
```

## 4. 成果物をWindows側へコピーする

WSLからWindowsのファイルシステムは `/mnt/c/` で見える。

```bash
WORKTREE_NAME=$(basename "$(git rev-parse --show-toplevel)")
WIN_REPO="$NIWATERM_WIN_WORKTREES_ROOT/$WORKTREE_NAME"
mkdir -p "$WIN_REPO/vendor/libghostty/bin"
cp vendor/libghostty/bin/*.dll "$WIN_REPO/vendor/libghostty/bin/"
cp -r vendor/libghostty/include "$WIN_REPO/vendor/libghostty/"
```

## 5. 起動する

`mise run start`をWSL側のworktreeディレクトリ内で実行するのが基本
（worktree名を自動解決してWindows側へ同期・起動する）。

手動で行う場合、Windows側で:

```powershell
cd $env:USERPROFILE\niwaterm-worktrees\<worktree名>
bun x electrobun dev
```

WSLから起動する場合:

```bash
powershell.exe -NoProfile -Command "\
  \$env:PATH=[Environment]::GetEnvironmentVariable('PATH','User')+';'+[Environment]::GetEnvironmentVariable('PATH','Machine'); \
  cd C:\Users\<ユーザー名>\niwaterm-worktrees\<worktree名>; bun x electrobun dev"
```

> **初回起動は数分かかる。** Electrobunが自分のCLIバイナリ（数十MB）とコアバイナリ
> （`bun.exe` / `bsdiff.exe` / `bspatch.exe` / `libNativeWrapper.dll`）を
> GitHub Releasesからダウンロードするため。2回目以降はキャッシュが効く。

### 普段遣い用ビルドを同時に動かす

niwaterm自体の開発中は上記の開発中ビルドwip（`electrobun dev`、appフォルダ名`niwaterm-wip-dev`）を使う一方、
日常の作業には別途起動した普段遣い用ビルド（appフォルダ名`niwaterm-daily-dev`）を使うと、
開発中の不具合や再起動で普段の作業が巻き込まれない。

普段遣い用も**devチャンネルのままアプリ名だけ`NIWATERM_APP_NAME`環境変数で変える**方式を採る。
stable/canaryチャンネルは配布用インストーラ(self-extractor)作成が目的で、ビルド後すぐ直接実行
できる展開済みappバンドルを作らない設計になっているため採用していない
（詳細: [Windowsのstable/canaryビルドはそのまま直接実行できる展開済みappバンドルを作らない](/known-issues/windows-stable-build-not-directly-runnable.md)）。

設定ファイル・IPCソケット・WSLブリッジポートはアプリ名別に分離されている
（`src/bun/app-paths.ts`・`src/bun/ipc-server.ts`参照）ため、wipビルドと同時に起動しても干渉しない。

**ただし、electrobun 2.0.1で追加されたプロジェクトビルドロック（`.hutch/locks/`）は
ディレクトリ単位でかかるため、wipとdailyが同じディレクトリを共有していると片方の起動中は
もう片方のビルドが`Waiting for the project build lock...`のまま進まなくなる**。これを避けるため、
wip用はgtrで追加した**git worktree**（devブランチ）、daily用は**このリポジトリ本体**
（mainブランチ、gitのメインワークツリー）という別々の実体で動かす。

`mise run start`は現在のブランチを見て自動的にwip/dailyを判定するので、
`NIWATERM_APP_NAME`を手動で指定する専用タスクは用意していない
（手動で叩く場合のみ以下のように指定する）:

```powershell
cd $env:USERPROFILE\niwaterm-worktrees\<mainブランチ側のディレクトリ名>
$env:NIWATERM_APP_NAME = "niwaterm-daily"
bun x electrobun dev
```

WSLから同期・起動する場合は、mainブランチ側のディレクトリ内で`mise run start`
（内部で自動的に`NIWATERM_APP_NAME=niwaterm-daily`をセットしてから`win:sync` → `win:start`。
ディレクトリ名は自動解決する）、停止は現在のブランチに対応する方だけなら`mise run win:stop:mine`、
両方まとめてなら`win:stop`。dev側の変更をdaily側へ取り込むには、mainブランチ側で
`mise run daily:merge-dev`（`main`ブランチであることを確認した上でff-onlyマージ + `bun install` +
vendorの同期に続けて、`win:sync` → `win:build`でWindows側の同期とビルドまで行う。起動は含めないので、
そのままタスクバーのショートカットから起動すれば反映されている）。

> **project_root分離だけでは`electrobun dev`（`mise run start`）の同時起動はできない。** Hutchは
> `<hutch_home>/releases/electrobun/<version>/<platform>.lock`という**ユーザーのホーム配下で
> グローバルな**ロックを持っており、起動中の`electrobun dev`がこれを共有ロックで掴み続ける一方、
> 新しく起動する側は同じファイルを排他ロックで取りに行く。そのため、project_rootを分けていても、
> Hutchプロセス（`electrobun dev`・`electrobun build`いずれも）が1つでも生きている間は
> 別のHutchプロセスの起動処理が完全にブロックされる（実機で確認済み。`--watch`の有無は無関係）。
> 先発側を止めた瞬間に後発側は即座に前進するため、デッドロックではなく
> 「先発が生きている間だけ後発を待たせる」直列化。
> 機序と一次証拠: docs/known-issues/hutch-electrobun-release-lock-blocks-concurrent-dev.md
>
> **対策**: `mise run start` / `win:start`は`HUTCH_HOME`を`$HOME/.hutch-wip` /
> `$HOME/.hutch-daily`へ自動的に分けるため、通常はそのまま同時起動できる（ホットリロードも
> 維持される）。新しい`HUTCH_HOME`は初回にダウンロードが走るので、
> `cp -R ~/.hutch ~/.hutch-wip`のように既存ストアをコピーしておくと省ける。
> **なおこの対策はmacOS実機で検証済み、Windows実機では未検証**。
> Windowsで通らない場合や、`HUTCH_HOME`を分けたくない場合は、両方を**順番に**
> `mise run start`でビルド完了させてから`mise run win:stop:mine`で止め（同時にビルドさせないこと）、
> それぞれで`mise run win:start:built`を使ってビルド済みの`launcher.exe`を`electrobun dev`を
> 経由せず直接起動する。Hutchを経由しないためこのロックの影響を受けない（ホットリロードは失われる）。

### wipにだけ別の設定を読ませる

永続化状態とIPCソケットはアプリ名別に分かれるが、設定ディレクトリ（`~/.config/niwaterm/`）は
wipとdailyで共有している。設定まわりの検証で`niwaterm.config.ts`を書き換えると普段遣い側にも
そのまま効いてしまうため、検証用の設定ディレクトリを`mise.local.toml`へ書いておく。

```toml
[env]
NIWATERM_WIP_CONFIG_DIR = 'C:\Users\<ユーザー名>\.config\niwaterm-wip'
```

`mise run start` / `win:start` / `win:start:built`が、wip起動時にだけこの値を
`NIWATERM_CONFIG_DIR`としてWindows側へ渡す（dailyには渡さないので普段遣いの設定は変わらない）。
変数の意味・設定ディレクトリに何を置く必要があるかは[設定ファイル](/guide/config.md)の
「設定ディレクトリを変える」節を参照。

パスは**Windows側のもの**で書く（TOMLのリテラル文字列`'...'`ならバックスラッシュのエスケープは不要）。
アプリはWindows実機で動くためWSL側のパスは見えず、`\\wsl.localhost\...`を指すリンクを置いても
ファイル監視が変更を拾えずホットリロードが効かない。

中身はWindows側で用意する。`%USERPROFILE%\.config\niwaterm\`の丸ごとコピーでは済まない
（`node_modules\@niwaterm\config`はリポジトリの`packages/config`を指すジャンクションのため）ので、
同じ実体を指すジャンクションを張り直す。

```powershell
# ジャンクションの現在の向き先を確認してからTargetに使う
Get-ChildItem $env:USERPROFILE\.config\niwaterm\node_modules\@niwaterm | Select-Object Name,Target

$dst = "$env:USERPROFILE\.config\niwaterm-wip"
New-Item -ItemType Directory -Force -Path "$dst\node_modules\@niwaterm"
Copy-Item "$env:USERPROFILE\.config\niwaterm\package.json" $dst
Copy-Item "$env:USERPROFILE\.config\niwaterm\tsconfig.json" $dst
New-Item -ItemType Junction -Path "$dst\node_modules\@niwaterm\config" -Target <上で確認した向き先>
```

あとは`niwaterm.config.ts`を置けば起動時に読まれる。実際に読まれている設定ディレクトリは
`niwa-dev config show`の先頭行（`config: <パス>`）で確認できる。

### タスクバーから起動する

普段遣いビルドはWSL側から`mise run start`せずに、Windows側のタスクバーやスタートメニューから
直接起動したいことが多い。その場合は`bin\launcher.exe`を指すショートカットを作ってピン留めする。

```powershell
$sh = New-Object -ComObject WScript.Shell
$lnk = $sh.CreateShortcut($env:APPDATA + '\Microsoft\Windows\Start Menu\Programs\niwaterm-daily.lnk')
$lnk.TargetPath = $env:USERPROFILE + '\niwaterm-worktrees\niwaterm\build\niwaterm-daily\dev-win-x64\niwaterm-daily-dev\bin\launcher.exe'
$lnk.WorkingDirectory = $env:USERPROFILE + '\niwaterm-worktrees\niwaterm'
$lnk.IconLocation = $lnk.TargetPath + ',0'
$lnk.Save()
```

`launcher.exe`はcwd・環境変数なしで起動できる（`APP_VARIANT`はビルド時に焼き込まれ、初期タブのcwdは
`homedir()`へフォールバックし、`HUTCH_HOME`は`electrobun dev`専用のため）。ビルドし直しても
パスは変わらないのでショートカットの作り直しも不要。

ショートカットが実行するのは`Resources/app`へ焼き込まれたアプリコードなので、WSL側のソースを
`win:sync`しただけでは反映されない。**タスクバー起動側を最新にするにはビルドが必要**。dev側の変更を
取り込むなら`mise run daily:merge-dev`（マージから同期・ビルドまで行い、起動はしない）、main側で
直接いじった場合は`mise run win:sync` → `mise run win:build`（`electrobun build --env=dev`を起動なしで実行する）。
electrobunはビルドの度に`buildFolder`配下を丸ごと作り直すため、**対象アプリの起動中はビルドできない**
（ファイルがロックされEACCESになる）。`win:build`は起動中を検出したら中断するので、先にウィンドウを
閉じるか`mise run win:stop:mine`してから実行する。daily自身のタブから実行すると自分ごと止めることに
なるので、wip側のタブやWindows Terminalから実行するのが楽（`daily:merge-dev`はマージ・同期とも冪等なので
やり直しても安全）。

> **起動中のウィンドウを右クリックしてピン留めしてはいけない。** アプリのウィンドウを所有しているのは
> `launcher.exe`ではなく子の`bun.exe`のため、引数なしの`bun.exe`がピン留めされ、起動しても
> 一瞬ウィンドウが見えて消えるだけになる。また、`bun.exe`のPE Subsystemを書き換えていないビルドは
> Explorerから起動するとWindows Terminalのウィンドウが一緒に開き、それを閉じるとniwatermごと終了する
> （`scripts/patch-win-bun-subsystem.ts`をpostBuildフックで適用済み。詳細:
> [タスクバーからdev/dailyビルドを起動するとWindows Terminalが開き、閉じるとniwatermごと終了する](/known-issues/windows-taskbar-launch-opens-windows-terminal.md)）。

### `browser-screenshot` が動かない（Bun本体の既知issue）

`niwa browser-screenshot` を実行すると、サーバー側で次の例外が出て500エラーになる:

```
error: Failed to spawn Chrome (set BUN_CHROME_PATH, backend.path, or install Chrome/Chromium)
 code: "ERR_DLOPEN_FAILED"
    at captureUrlScreenshot (.../src/bun/browser-screenshot.ts)
```

`BUN_CHROME_PATH` にEdge/Chromeの実行ファイルパスを明示的に指定しても再現する。
niwatermのコードやElectrobun/Bun Worker環境に起因するものではなく、**素のBun（Worker無し、Electrobun無し）で`new Bun.WebView(...)`を呼ぶだけの最小再現でも同じエラーになる**ことを確認済み。
Bun本体のWindows版`Bun.WebView`（Chromeバックエンド）がChromeプロセスの起動に失敗する既知issue（[oven-sh/bun#29102](https://github.com/oven-sh/bun/issues/29102)、2026-08時点で未解決）。
Bun側の修正待ちで、niwaterm側での回避策は無い。

### ログを見る

Electrobunは**Windowsではコンソールを持たないGUIアプリとしてビルドされる**ため、
プロダクションビルドの標準出力は既定では見えない。環境変数で有効化する:

```powershell
$env:ELECTROBUN_CONSOLE=1
```

## 6. WSLディストロからniwaterm CLIを使う

niwatermはWSLディストロ（NixOS等）をシェルプロファイルとしてタブに開ける。そのタブ内から
`niwa` CLI（シェル統合のブランチ表示・エージェント統合のhooksが内部で呼び出す）を
使うには、以下の2つの対応が要る。

### 6-1. WSLディストロ内でも別途CLIセットアップが要る

CLI本体はWindows側リポジトリで`bun link`しても、WSLディストロは別のLinux環境なので
そちらには反映されない。**WSLディストロの中でも別途セットアップする**:

```bash
# WSLディストロ内で、対象のワークツリーのルートで実行
mise run cli:link
```

コマンド名はワークツリーによって変わる。

| ワークツリー          | コマンド        | 接続先の既定    |
| --------------------- | --------------- | --------------- |
| `main`（daily側）     | `niwa`      | niwaterm-daily  |
| それ以外（devなど）   | `niwa-dev`  | niwaterm-wip    |

**wipの動作確認では`niwa-dev`を使う**。`bun link`はパッケージ名(`@niwaterm/cli`)で登録するため、
複数のワークツリーから実行すると後勝ちで`niwa`を奪い合い、devで作業していても`niwa`が
daily側のソースを指したままになる（CLI側の変更が反映されていないことに気づきにくい）。
これを避けるため、wip側は`bun link`を使わず`niwa-dev`という別名の薄いラッパーにしている。

WSL側のソースを直接指すので、`niwa-dev`はワークツリーを更新すれば即座に反映される
（`niwa`側は`mise run daily:merge-dev`でmainへ取り込んだ時点で反映される）。
`niwa --version` / `niwa-dev --version`で疎通確認する。

### 6-2. WSL→WindowsはTCPブリッジ経由で接続する

WSLディストロからは、Windows側アプリが`Bun.serve({unix})`で開いているUnix domain socketへ
**直接は接続できない**。ソケットファイルは`/mnt/c/...`（9p/drvfs）越しにWSL側から見えるが、
`stat`すると`regular empty file`と出る（＝Linux側からはUnix domain socketとして認識されない）。
DrvFsはNTFS上にソケット等の特殊ファイルを表現できないため、これはWSL自体の制約であり、
niwaterm固有の問題ではない。

この制約を回避するため、`src/bun/ipc-server.ts`はWindows限定で、Unix domain socketに加えて
**WSL用のTCPブリッジ**も追加でlistenする:

- **待受先**: `0.0.0.0`ではなく、ループバック(`127.0.0.1`)と、`os.networkInterfaces()`で見つけた
  WSL用Hyper-V仮想アダプタ（`vEthernet (WSL)`等、名前に`wsl`を含むもの）のIPv4アドレスに限定する。
  WSLからどちらに届くかはWSL2のネットワークモード次第で、ミラーモード
  （`.wslconfig`の`networkingMode=mirrored`）ならループバック、NATモード（既定）なら
  仮想アダプタのIPになるため、両方でlistenする。どちらもLANの他端末からは到達できない
  （`0.0.0.0`だと同一LAN上の他端末からも到達しうるため、意図的に避けている）
- **ポート**: 固定せずOSに割り当てさせる（`Bun.serve`の`port: 0`）。固定ポートは他アプリと
  衝突しうるうえ、WSL2のミラーモードではWSL側のエフェメラルポート範囲と重なるとbindすらできない
  （[WSLミラーモードでTCPブリッジがlistenできず、CLIが繋がらない](/known-issues/wsl-mirrored-mode-breaks-tcp-bridge.md)参照）。
  割り当てられた実ポートは、Unix domain socketと同じディレクトリの`bridge-port`ファイルへ書き出す。
  複数アドレスでlistenする場合も番号は揃える（CLIが1つのポートだけ見れば済むようにするため）
- **接続元(WSL側)の判定**: `packages/cli/src/ipc-client.ts`が`/proc/version`の内容で
  WSL上かどうかを判定し、WSL上であればループバック→`/proc/net/route`のデフォルトゲートウェイ
  （＝NATモードでのWindowsホスト側アダプタのIP）の順にTCP接続を試す。ゲートウェイIPは
  WSL VM再起動のたびに変わりうるため、実行のたびに動的に読み直す（キャッシュしない）。
  ポート番号は、niwatermが起動したPTY内であれば`NIWATERM_BRIDGE_PORT`環境変数
  （自インスタンスの値）を優先し、未設定なら上記の`bridge-port`ファイルを読む
  （ソケットと違いただのregular fileなので、DrvFs越しでもWSLから読める）。
  ファイルの場所はcmd.exeで`%APPDATA%`を解決してから`wslpath`でLinuxパスへ変換して求める
- **接続先インスタンスの切り替え**: `bridge-port`ファイル（およびUnix domain socket）を
  どのインスタンスから読むかは`NIWATERM_APP_VARIANT`で指定する（既定は`niwaterm-daily`）。
  ポートが動的になったため、タブ外から開発中ビルドへ繋ぎたい場合はポート番号ではなくこちらを使う:
  `NIWATERM_APP_VARIANT=niwaterm-wip niwa ping`。
  この変数はniwaterm自身がPTYへも注入するので、タブ内から叩く分には指定不要。
  **ただしタブ内では`NIWATERM_BRIDGE_PORT`（自インスタンスのポート）も注入済みで、
  そちらがAPP_VARIANTによる解決より先に使われる**。そのため普段遣いビルドのタブ内から
  `NIWATERM_APP_VARIANT=niwaterm-wip`だけ付けても、接続先はそのタブのインスタンスのまま
  変わらない。別インスタンスへ繋ぐときは注入された変数をunsetする（タブ変数を扱うなら
  自タブ扱いを避けるため`NIWATERM_TAB_ID`も外す）:

  ```bash
  env -u NIWATERM_BRIDGE_PORT -u NIWATERM_SOCKET -u NIWATERM_TAB_ID \
    NIWATERM_APP_VARIANT=niwaterm-wip niwa-dev ping
  ```

  実際にどちらへ繋がったかは、`ping`が返すpidをWindows側のプロセス一覧
  （`Get-Process`の`MainWindowTitle`が`niwaterm-wip`/`niwaterm-daily`）と突き合わせて確認する

対応済みのため、WSLディストロのタブ内でも他プラットフォーム同様にCLIが使える:

```bash
# WSL(NixOS)タブ内で実行
niwa ping
# pong (pid ...)

niwa tab var set mykey myvalue
niwa tab var get mykey
# myvalue
```

macOS・Windows実機（PowerShell等、WSL外）からの接続は従来どおりUnix domain socketのみを使う。
WSL判定に該当しない限りTCPブリッジ側は使われない。

## トラブルシューティング

| 症状                                                                        | 原因・対処                                                                                                                                                                                                                                                                                                                                                                            |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `zig build` が `does not meet the required build version of v0.17.0` で失敗 | Zig 0.16系以前を使っている。`mise exec zig@0.17.0 --` を使う                                                                                                                                                                                                                                                                                                                              |
| クロスビルドがMSVC関連で失敗する                                            | `-Dtarget` に `-gnu` を付け忘れている                                                                                                                                                                                                                                                                                                                                                 |
| `dlopen` でDLLが見つからない                                                | `.dll` は `lib/` ではなく `bin/` に出る。配置先を確認する                                                                                                                                                                                                                                                                                                                             |
| `Failed to open library "niwashim.dll": error code 126`                     | 126は ERROR_MOD_NOT_FOUND。**DLL自体ではなく依存先の `ghostty-vt.dll` が見つかっていない**。WindowsのローダーはDLL自身と同じディレクトリを依存解決の対象にしない（macOSの `@loader_path` rpathに相当するものが無い）。先に `ghostty-vt.dll` を `dlopen` してプロセスにロード済みにしてから開く（src/bun/ghostty.tsで対応済み）。2つの`.dll`が同じディレクトリに揃っているかも確認する |
| `error: PTY not supported on this platform`                                 | electrobunが同梱するBunが1.3.14未満。electrobun 2.0.1（同梱Bun 1.4.0）以降なら発生しない（現在は2.0.5・同梱Bun 1.4.4）                                                                                                                                                                                                                                                                                             |
| ターミナルが起動しない / PTYが動かない                                      | Windows側のBunが1.3.14未満。`bun upgrade` する                                                                                                                                                                                                                                                                                                                                        |
| WebViewが真っ白                                                             | WebView2 Runtime未導入                                                                                                                                                                                                                                                                                                                                                                |
| `browser-screenshot` が `unexpected status 500` で失敗する                  | Bun本体のWindows版`Bun.WebView`の既知issue（[oven-sh/bun#29102](https://github.com/oven-sh/bun/issues/29102)）。`BUN_CHROME_PATH`を設定しても直らない。niwaterm側の回避策は無く、Bun側の修正待ち                                                                                                                                                                                    |
| `niwa ping`等のCLIコマンドが応答なしでハングする                        | niwaterm自体の問題ではなく検証時の起動方法が原因のことが多い。`Start-Process`で起動する場合は`-NoNewWindow`を付ける（付けないとIPCサーバーへの接続がハングする現象を確認した）                                                                                                                                                                                                       |
| WSLディストロのタブ内で`niwa`が`command not found`                      | WSLディストロには別途`bun link`が要る（「6-1. WSLディストロ内でも別途CLIセットアップが要る」参照）。Windows側リポジトリでのlinkとは独立                                                                                                                                                                                                                                              |
| WSLディストロのタブ内で`niwa ping`等が「アプリが起動していない可能性があります」「接続できませんでした」等で失敗する | 「6-2. WSL→WindowsはTCPブリッジ経由で接続する」参照。Windows側アプリが古くTCPブリッジ非対応、ブリッジのポートがbindできずlistenしていない、のいずれか。アプリ起動ログの`[bun] wsl bridge listening on ...`の有無で切り分ける（[WSLミラーモードでTCPブリッジがlistenできず、CLIが繋がらない](/known-issues/wsl-mirrored-mode-breaks-tcp-bridge.md)参照） |
| `send-keys`等でPTYへ書き込んだ直後にniwatermアプリ自体が`Segmentation fault`でクラッシュする | [Windows実機: PTY終了直後のdispose()でuse-after-freeクラッシュ](/known-issues/windows-pty-dispose-use-after-free.md)参照                                                                                                                                                                                                                                          |
| タスクバーにピン留めしたアイコンから起動できない（ウィンドウが一瞬見えて消える） | ピン留め対象が`launcher.exe`ではなく`bun.exe`になっている。[タスクバーからdev/dailyビルドを起動するとWindows Terminalが開き、閉じるとniwatermごと終了する](/known-issues/windows-taskbar-launch-opens-windows-terminal.md)参照 |
| Explorerから起動するとWindows Terminalも開き、閉じるとniwatermも終了する | devビルドのlauncherが`bun.exe`をコンソール付きで起動するため。postBuildフック(`scripts/patch-win-bun-subsystem.ts`)適用後のビルドで解消する。[同上](/known-issues/windows-taskbar-launch-opens-windows-terminal.md) |

## 既知の差異・制約

- **アーキテクチャはx64のみ**（ElectrobunのWindows対応がx64のみ。ARM64はエミュレーションで動作）
- **デフォルトシェルはPowerShell**（`powershell.exe -NoLogo`）。設定で変更できる
- ConPTYの仕様上、入力の `\r` → `\n` 変換（POSIXのICRNL相当）が行われない
- ConPTYは子プロセスの出力より前に短いVT初期化シーケンス（`\x1b[?9001h\x1b[?1004h...`）を出力する
- Windowsにはプロセスグループもシグナルも無いため、macOSで行っているSIGINT/SIGWINCHの補完送出は行わない
  （ConPTY側がCtrl+Cとサイズ変更を子へ伝える）
- PTY終了直後にniwatermアプリがクラッシュすることがある既知の不具合について:
  [Windows実機: PTY終了直後のdispose()でuse-after-freeクラッシュ](/known-issues/windows-pty-dispose-use-after-free.md)参照

### キーバインドの既定値

tmux風のprefix方式。prefixキー（既定`ctrl+b`）を押してから2打目のキーを押すとアクションが発火する。
prefix・2打目キーの割り当てはmacOS/Windows共通（詳細: [設定ファイル](/guide/config.md)の「キーバインドDSL」節）。
OS差分はコピー・ペースト用の`direct`（prefix不要の即時ショートカット）のみで、
macOSはApplicationMenu経由でCmd+C/Vが既に機能するため既定は空、WindowsはCtrl単独が
`Ctrl+C`等ターミナルの制御文字と衝突するため`ctrl+shift+c`/`ctrl+shift+v`を割り当てている。
いずれも`niwaterm.config.ts`で上書きできる。

| 操作                  | prefix (`ctrl+b`) の後に押すキー |
| --------------------- | --------------------------------- |
| 垂直分割              | `d`                                |
| 水平分割              | `shift+d`                          |
| タイルを閉じる        | `w`                                |
| フォーカス移動        | `↑↓←→`                             |
| 新規タブ              | `c`                                |
| 新規ブラウザタブ      | `shift+t`                          |
| 次/前のタブ           | `n` / `p`                          |
| 新規ワークスペース    | `shift+n`                          |
| 次/前のワークスペース | `]` / `[`                          |
| サイドバー開閉        | `b`                                |

| 操作（direct、prefix不要） | macOS  | Windows         |
| --------------------------- | ------ | --------------- |
| コピー                       | Cmd+C（ApplicationMenu経由） | `ctrl+shift+c` |
| ペースト                     | Cmd+V（ApplicationMenu経由） | `ctrl+shift+v` |

## 参考資料

- [Electrobun Cross-Platform Development](https://framework.blackboard.sh/electrobun/guides/cross-platform-development/)
- [Bun v1.3.14 リリースノート（Bun.TerminalのWindows対応）](https://bun.com/blog/bun-v1.3.14)
