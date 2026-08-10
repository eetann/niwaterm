# Windowsでのビルド・実行手順

Windowsでniwatermをビルド・実行するための手順。

> **状態**（2026-08-10時点）: Windows 11 x64で**動作確認済み**。
> 確認できたのは、アプリ起動・PowerShellの起動と入出力・タイル分割（`ctrl+shift+d`）・
> IPCサーバー起動・CLI（`ping` / `list` / `send-keys` / `capture-tab`）まで。
> **ブラウザタブ・スクリーンショット・カスタムViewは未検証**。

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

### 動作確認できたこと

起動後、次まで確認済み:

- PowerShellのプロンプト表示と入出力（`echo` の実行と結果表示、シンタックスハイライト）
- `ctrl+shift+d` によるタイル分割（分割先で新しいPTYが起動する）
- IPCサーバーの起動 → CLIからの操作

```powershell
bun packages/cli/src/index.ts ping
# pong (pid 29032)

bun packages/cli/src/index.ts send-keys --tab tab-3 'echo cli-from-windows' Enter
bun packages/cli/src/index.ts capture-tab --tab tab-3
# PS C:\Users\eetann> echo cli-from-windows
# cli-from-windows
```

`Bun.serve({unix})` と `fetch(..., {unix})` はWindowsでも動作する。
ブラウザタブ・スクリーンショット・カスタムViewは未検証。

### ログを見る

Electrobunは**Windowsではコンソールを持たないGUIアプリとしてビルドされる**ため、
プロダクションビルドの標準出力は既定では見えない。環境変数で有効化する:

```powershell
$env:ELECTROBUN_CONSOLE=1
```

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

## 既知の差異・制約

- **アーキテクチャはx64のみ**（ElectrobunのWindows対応がx64のみ。ARM64はエミュレーションで動作）
- **デフォルトシェルはPowerShell**（`powershell.exe -NoLogo`）。設定で変更できる
- ConPTYの仕様上、入力の `\r` → `\n` 変換（POSIXのICRNL相当）が行われない
- ConPTYは子プロセスの出力より前に短いVT初期化シーケンス（`\x1b[?9001h\x1b[?1004h...`）を出力する
- Windowsにはプロセスグループもシグナルも無いため、macOSで行っているSIGINT/SIGWINCHの補完送出は行わない
  （ConPTY側がCtrl+Cとサイズ変更を子へ伝える）

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
