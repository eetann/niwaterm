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
| Bun 1.3.14以上   | ランタイム。**Bun.TerminalのWindows(ConPTY)対応が1.3.14から** | `bun --version` |
| Git              | リポジトリのclone                                             | `git --version` |
| WebView2 Runtime | Electrobunの描画基盤                                          | 下記参照        |

> **開発機のBunとは別に、アプリに同梱されるBunがある。**
> Electrobunはビルド時に自前のBunをアプリへ同梱するため、開発機のBunを上げても
> アプリ内のランタイムは変わらない。Electrobun 1.18.1の同梱版は**1.3.13**でConPTY対応前なので、
> `electrobun.config.ts` で明示的に上書きしている:
>
> ```ts
> build: {
>   bunVersion: "1.3.14",
>   ...
> }
> ```

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

Windows側にgitを入れてcloneする場合:

```powershell
cd $env:USERPROFILE
git clone <このリポジトリのURL> niwaterm
```

gitを入れずにWSLのリポジトリからコピーする場合（動作確認だけならこれで十分）:

```bash
WIN=/mnt/c/Users/<ユーザー名>/niwaterm
mkdir -p "$WIN"
rsync -a --exclude '.git' --exclude 'node_modules' --exclude 'build' --exclude 'vendor' \
  <repo>/ "$WIN/"
```

`node_modules` はWindows側で入れ直す（ネイティブなbunバイナリが必要なため）:

```powershell
cd $env:USERPROFILE\niwaterm
bun install
```

## 3. ネイティブライブラリをビルドする（WSL側）

Zigはクロスコンパイルできるので、WSL側でWindows向けの`.dll`を作る。

### 3-1. ghosttyのソースを取得する

`vendor/` は `.gitignore` 対象なので、各環境で取得する。

```bash
opensrc path ghostty-org/ghostty   # 取得先パスが返る
```

取得したソースを `vendor/libghostty/` に配置する。

### 3-2. libghostty-vt をWindows向けにビルドする

**Zig 0.16.0以上が必要**（ghosttyのbuild.zigが `minimum_zig_version = 0.16.0` を要求する）。

```bash
bun run build:vendor:win
```

中身は次のコマンド:

```bash
cd vendor/libghostty
mise exec zig@0.16.0 -- zig build -Demit-lib-vt \
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
bun run build:native:win
```

中身は次のコマンド:

```bash
mise exec zig@0.16.0 -- zig cc -target x86_64-windows-gnu -shared \
  -Ivendor/libghostty/include \
  src/native/shim.c \
  -Lvendor/libghostty/lib -lghostty-vt \
  -o vendor/libghostty/bin/niwashim.dll
```

## 4. 成果物をWindows側へコピーする

WSLからWindowsのファイルシステムは `/mnt/c/` で見える。

```bash
WIN_REPO=/mnt/c/Users/<ユーザー名>/niwaterm
mkdir -p "$WIN_REPO/vendor/libghostty/bin"
cp vendor/libghostty/bin/*.dll "$WIN_REPO/vendor/libghostty/bin/"
cp -r vendor/libghostty/include "$WIN_REPO/vendor/libghostty/"
```

## 5. 起動する

Windows側で:

```powershell
cd $env:USERPROFILE\niwaterm
bun run start
```

WSLから起動する場合:

```bash
powershell.exe -NoProfile -Command "\
  \$env:PATH=[Environment]::GetEnvironmentVariable('PATH','User')+';'+[Environment]::GetEnvironmentVariable('PATH','Machine'); \
  cd C:\Users\<ユーザー名>\niwaterm; bun run start"
```

> **初回起動は数分かかる。** Electrobunが自分のCLIバイナリ（数十MB）とコアバイナリ
> （`bun.exe` / `bsdiff.exe` / `bspatch.exe` / `libNativeWrapper.dll`）を
> GitHub Releasesからダウンロードするため。2回目以降はキャッシュが効く。

### `browser-screenshot` が動かない（Bun本体の既知issue）

`niwaterm browser-screenshot` を実行すると、サーバー側で次の例外が出て500エラーになる:

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
`niwaterm` CLI（シェル統合のブランチ表示・エージェント統合のhooksが内部で呼び出す）を
使うには、以下の2つの対応が要る。

### 6-1. WSLディストロ内でも別途CLIセットアップが要る

CLI本体はWindows側リポジトリで`bun link`しても、WSLディストロは別のLinux環境なので
そちらには反映されない。**WSLディストロの中でも別途セットアップする**:

```bash
# WSLディストロ内で実行
cd /mnt/c/Users/<ユーザー名>/niwaterm/packages/cli
bun link
```

`niwaterm --version`で疎通確認する。

### 6-2. WSL→WindowsはTCPブリッジ経由で接続する

WSLディストロからは、Windows側アプリが`Bun.serve({unix})`で開いているUnix domain socketへ
**直接は接続できない**。ソケットファイルは`/mnt/c/...`（9p/drvfs）越しにWSL側から見えるが、
`stat`すると`regular empty file`と出る（＝Linux側からはUnix domain socketとして認識されない）。
DrvFsはNTFS上にソケット等の特殊ファイルを表現できないため、これはWSL自体の制約であり、
niwaterm固有の問題ではない。

この制約を回避するため、`src/bun/ipc-server.ts`はWindows限定で、Unix domain socketに加えて
**WSL用のTCPブリッジ**も追加でlistenする:

- **待受先**: `0.0.0.0`ではなく、`os.networkInterfaces()`で見つけた
  WSL用Hyper-V仮想アダプタ（`vEthernet (WSL)`等、名前に`wsl`を含むもの）のIPv4アドレスに限定する。
  このアダプタはWindowsホスト⇔WSL VM間の内部NATに閉じており、LANの他端末からは到達できない
  （`0.0.0.0`だと同一LAN上の他端末からも到達しうるため、意図的に避けている）
- **ポート**: 固定ポート`47831`（`packages/cli/src/ipc-client.ts`の`WSL_BRIDGE_PORT`と
  `src/bun/ipc-server.ts`の`WSL_BRIDGE_PORT`に意図的に重複させている。変更時は両方揃えること）
- **接続元(WSL側)の判定**: `packages/cli/src/ipc-client.ts`が`/proc/version`の内容で
  WSL上かどうかを判定し、WSL上であれば`/proc/net/route`からデフォルトゲートウェイ
  （＝Windowsホスト側の上記アダプタのIP）を読み取ってTCP接続する。ゲートウェイIPは
  WSL VM再起動のたびに変わりうるため、実行のたびに動的に読み直す（キャッシュしない）

対応済みのため、WSLディストロのタブ内でも他プラットフォーム同様にCLIが使える:

```bash
# WSL(NixOS)タブ内で実行
niwaterm ping
# pong (pid ...)

niwaterm set-var mykey myvalue
niwaterm get-var mykey
# myvalue
```

macOS・Windows実機（PowerShell等、WSL外）からの接続は従来どおりUnix domain socketのみを使う。
WSL判定に該当しない限りTCPブリッジ側は使われない。

## トラブルシューティング

| 症状                                                                        | 原因・対処                                                                                                                                                                                                                                                                                                                                                                            |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `zig build` が `does not meet the required build version of v0.16.0` で失敗 | Zig 0.15系を使っている。`mise exec zig@0.16.0 --` を使う                                                                                                                                                                                                                                                                                                                              |
| クロスビルドがMSVC関連で失敗する                                            | `-Dtarget` に `-gnu` を付け忘れている                                                                                                                                                                                                                                                                                                                                                 |
| `dlopen` でDLLが見つからない                                                | `.dll` は `lib/` ではなく `bin/` に出る。配置先を確認する                                                                                                                                                                                                                                                                                                                             |
| `Failed to open library "niwashim.dll": error code 126`                     | 126は ERROR_MOD_NOT_FOUND。**DLL自体ではなく依存先の `ghostty-vt.dll` が見つかっていない**。WindowsのローダーはDLL自身と同じディレクトリを依存解決の対象にしない（macOSの `@loader_path` rpathに相当するものが無い）。先に `ghostty-vt.dll` を `dlopen` してプロセスにロード済みにしてから開く（src/bun/ghostty.tsで対応済み）。2つの`.dll`が同じディレクトリに揃っているかも確認する |
| `error: PTY not supported on this platform`                                 | **アプリに同梱されるBun**が1.3.14未満。Electrobun 1.18.1の同梱版は1.3.13なので、`electrobun.config.ts` の `build.bunVersion` で上書きする（設定済み）。開発機のBunを上げるだけでは直らない点に注意                                                                                                                                                                                    |
| ターミナルが起動しない / PTYが動かない                                      | Windows側のBunが1.3.14未満。`bun upgrade` する                                                                                                                                                                                                                                                                                                                                        |
| WebViewが真っ白                                                             | WebView2 Runtime未導入                                                                                                                                                                                                                                                                                                                                                                |
| `browser-screenshot` が `unexpected status 500` で失敗する                  | Bun本体のWindows版`Bun.WebView`の既知issue（[oven-sh/bun#29102](https://github.com/oven-sh/bun/issues/29102)）。`BUN_CHROME_PATH`を設定しても直らない。niwaterm側の回避策は無く、Bun側の修正待ち                                                                                                                                                                                    |
| `niwaterm ping`等のCLIコマンドが応答なしでハングする                        | niwaterm自体の問題ではなく検証時の起動方法が原因のことが多い。`Start-Process`で起動する場合は`-NoNewWindow`を付ける（付けないとIPCサーバーへの接続がハングする現象を確認した）                                                                                                                                                                                                       |
| WSLディストロのタブ内で`niwaterm`が`command not found`                      | WSLディストロには別途`bun link`が要る（「6-1. WSLディストロ内でも別途CLIセットアップが要る」参照）。Windows側リポジトリでのlinkとは独立                                                                                                                                                                                                                                              |
| WSLディストロのタブ内で`niwaterm ping`等が「アプリが起動していない可能性があります」等で失敗する | 「6-2. WSL→WindowsはTCPブリッジ経由で接続する」参照。Windows側アプリが古くTCPブリッジ非対応、WSL用仮想アダプタが見つからない、ポート`47831`が別プロセスに使われている、のいずれか                                                                                                                                                                                                    |
| `send-keys`等でPTYへ書き込んだ直後にniwatermアプリ自体が`Segmentation fault`でクラッシュする | [Windows実機: PTY終了直後のdispose()でuse-after-freeクラッシュ](/known-issues/windows-pty-dispose-use-after-free.md)参照                                                                                                                                                                                                                                          |

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

macOSはcmd系、Windowsは**ctrl+shift系**を既定にしている。
ctrl単独は `Ctrl+C` / `Ctrl+D` / `Ctrl+B`（tmuxのprefix）などターミナルの制御文字と衝突するため、
必ずshiftかaltを伴わせる。`niwaterm.config.ts` で上書きできる。

| 操作                  | macOS               | Windows              |
| --------------------- | ------------------- | -------------------- |
| 垂直分割              | `cmd+d`             | `ctrl+shift+d`       |
| 水平分割              | `cmd+shift+d`       | `ctrl+shift+e`       |
| タイルを閉じる        | `cmd+w`             | `ctrl+shift+w`       |
| フォーカス移動        | `cmd+alt+↑↓←→`      | `ctrl+alt+↑↓←→`      |
| 新規タブ              | `cmd+t`             | `ctrl+shift+t`       |
| 新規ブラウザタブ      | `cmd+shift+t`       | `ctrl+shift+alt+t`   |
| 次/前のタブ           | `cmd+shift+]` / `[` | `ctrl+shift+]` / `[` |
| 新規ワークスペース    | `cmd+n`             | `ctrl+shift+n`       |
| 次/前のワークスペース | `cmd+alt+]` / `[`   | `ctrl+alt+]` / `[`   |
| サイドバー開閉        | `cmd+b`             | `ctrl+shift+b`       |

## 参考資料

- [Electrobun Cross-Platform Development](https://framework.blackboard.sh/electrobun/guides/cross-platform-development/)
- [Bun v1.3.14 リリースノート（Bun.TerminalのWindows対応）](https://bun.com/blog/bun-v1.3.14)
