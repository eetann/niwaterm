---
title: インストール
description: niwatermをソースからビルドして起動する手順（macOS・Windows）
---

niwatermには、まだインストーラーなどの配布物がない。使うにはソースコードからビルドする。対応しているのはmacOSとWindows（x64）で、どちらも最後は開発用のコマンドでアプリを起動する形になる。

ビルドに使うコンパイラ（Zig）などはmiseが自動で入れるので、下の表にあるものだけ用意すればよい。

## macOS

### 必要なもの

| ツール                                            | 確認コマンド     | 入れ方                                            |
| ------------------------------------------------- | ---------------- | ------------------------------------------------- |
| [Bun](https://bun.sh/)                            | `bun --version`  | 公式サイトの手順                                  |
| [mise](https://mise.jdx.dev/)                     | `mise --version` | 公式サイトの手順                                  |
| Xcode Command Line Tools                          | `cc --version`   | `xcode-select --install`                          |
| [opensrc](https://github.com/vercel-labs/opensrc) | `opensrc --help` | `bun add -g opensrc`（ghosttyのソース取得に使う） |

### ビルドして起動する

```sh
git clone https://github.com/eetann/niwaterm.git
cd niwaterm
mise trust
bun install
mise run build:vendor:mac
mise run build:native
mise run start
```

- `mise trust` — リポジトリの`mise.toml`に書いたタスクを実行できるようにする
- `build:vendor:mac` / `build:native` — niwatermが使うライブラリをビルドする。初回はソースの取得に数分かかる
- `start` — アプリを起動する。初回はビルドに使うツール一式をダウンロードするので時間がかかる

起動したコマンドは、アプリを開いているあいだ終わらない。止めるときはそのターミナルで`Ctrl+C`を押す。2回目以降の起動は`mise run start`だけでよい。

## Windows

Windowsでは、ライブラリのビルドをWSL（Linux）側で行い、アプリはWindows側で動かす。Windows側にZigやVisual Studioを入れる必要はない。

### 必要なもの

Windows側（PowerShell）で次を入れる。入れたあとはPATHを反映させるため、ターミナルを開き直す。

```powershell
winget install --id Oven-sh.Bun -e
winget install --id Git.Git -e
```

WSL側には、macOSの表のうちBun・mise・opensrcとrsyncを入れる。

### WSL側でビルドする

```sh
git clone https://github.com/eetann/niwaterm.git
cd niwaterm
mise trust
bun install
mkdir -p vendor/libghostty
cp -r "$(opensrc path ghostty-org/ghostty)/." vendor/libghostty/
mise run build:vendor:win
mise run build:native
```

### Windows側へコピーして起動する

WSL側のリポジトリ直下に`mise.local.toml`を作り、Windows側のコピー先を書く。コピー先は`C:\Users\<ユーザー名>\niwaterm-worktrees`で固定なので、`<ユーザー名>`だけ自分のものに置き換える。

```toml
[env]
NIWATERM_WIN_WORKTREES_ROOT = "/mnt/c/Users/<ユーザー名>/niwaterm-worktrees"
```

あとはWSL側で起動する。

```sh
mise run start
```

ソースとビルドしたライブラリを`niwaterm-worktrees\niwaterm`へコピーし、Windows側で依存を入れてからバックグラウンドで起動する。初回はビルドに使うツール一式をダウンロードするので、ウィンドウが開くまで数分かかる。起動中のログは`/tmp/niwaterm-win-daily.log`に出る。初回は「HUTCH_HOME … がまだありません」と表示されるが、これからダウンロードするという知らせなので、そのまま待てばよい。

止めるときは`mise run win:stop:mine`を実行する。

## 起動するアプリの名前

`mise run start`は、`main`ブランチでは`niwaterm-daily`という名前でアプリを起動する。それ以外のブランチでは開発中の変更を試すための`niwaterm-wip`になる。2つはワークスペースの保存先とCLIの接続先が別々なので、同時に起動しても干渉しない（設定ファイルはどちらも同じ`~/.config/niwaterm/`を読む）。普段使いには`main`ブランチのまま起動すればよい。

## 次にやること

アプリが起動したら、[セットアップ](/niwaterm/getting-started/)で`niwa`コマンドを使えるようにし、設定ファイルを置くディレクトリを作る。画面の作りは[画面の構成](/niwaterm/concepts/)で説明している。
