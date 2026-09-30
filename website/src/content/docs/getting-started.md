---
title: セットアップ
description: niwaterm CLIを使えるようにして設定ファイルを作る。設定は保存するだけで反映される
---

アプリを起動できたら、次の2つを済ませる。

1. `niwaterm`コマンド（CLI）を使えるようにする
2. `niwaterm init`で設定ファイルを作る

どちらも1回やれば終わる。アプリのビルドと起動がまだなら、先に[インストール](/niwaterm/installation/)を済ませる。

## CLIを使えるようにする

リポジトリのルートで次を実行する。

```sh
cd packages/cli
bun link
```

これで`niwaterm`コマンドが`~/.bun/bin`に入る。`~/.bun/bin`にPATHが通っていなければ追加する。アプリを起動した状態で`niwaterm ping`を実行し、`pong (pid …)`と返れば使える。

リポジトリの場所を指すリンクなので、リポジトリを移動・削除すると`niwaterm`コマンドも動かなくなる。そのときは移動先でもう一度`bun link`する。

### Windowsの場合

[インストール](/niwaterm/installation/#windows)でコピーした先（`%USERPROFILE%\niwaterm-worktrees\niwaterm`）の`packages\cli`で、PowerShellから`bun link`を実行する。niwatermのタブで開いたPowerShellから使えるようになる。

WSLのディストロをタブで開いて使うなら、WSL側のリポジトリでも同じように`bun link`する。ディストロの中はWindowsとは別の環境なので、こちらにも入れる必要がある。入れればWSL側からもWindowsで動いているniwatermを操作できる。

## 設定ディレクトリを作る

niwatermの設定は`~/.config/niwaterm/niwaterm.config.ts`にTypeScriptで書く。エディタで補完が使えるので、どんな設定項目があるかを補完候補から探しながら書ける。

雛形は`niwaterm init`で作る。

```sh
niwaterm init
```

`~/.config/niwaterm/`に`niwaterm.config.ts`と、補完に必要な`package.json`・`tsconfig.json`ができ、必要なパッケージのインストールまで済む。すでにあるファイルは上書きしないので、何度実行しても大丈夫。

できた`niwaterm.config.ts`には、キーバインドと見た目の設定例が入っている（抜粋）。

```ts
import { defaultAppearance, defineConfig } from "@niwaterm/config";

export default defineConfig({
  keybindings: (niwa) => {
    niwa.keybind("d", "split-horizontal");
    niwa.keybind("shift+d", "split-vertical");

    niwa.keybind("g", () => {
      niwa.popup.open({ width: 90, height: 90, command: "lazygit" });
    });
  },
  appearance: {
    ...defaultAppearance,
    fontSize: 14,
    foreground: "#e0e0e0",
    background: "#101010",
  },
});
```

この例では、prefixキー（デフォルトは`ctrl+b`）のあとに`d`でタイルを上下に分割し、`g`でlazygitをポップアップで開く。フォントサイズと文字色・背景色も変えている。書ける内容は[キーバインド](/niwaterm/keybindings/)や[見た目](/niwaterm/appearance/)などの各ページで説明している。

設定ディレクトリをdotfilesで管理する場合、`node_modules/`はGitの管理から外しておく。

### 別のディレクトリの設定で起動する

環境変数`NIWATERM_CONFIG_DIR`に絶対パスを入れて起動すると、`~/.config/niwaterm/`の代わりにそのディレクトリの設定を読む。普段の設定を変えずに別の設定を試したいときに使う。

ディレクトリごと切り替わるので、`niwaterm.config.ts`だけでなく`package.json`や`node_modules/`も一式そろえる。雛形は`NIWATERM_CONFIG_DIR=<パス> niwaterm init`で作れる。この環境変数は、niwatermが開いたタブのシェルには引き継がれない。

## ホットリロード

`niwaterm.config.ts`を保存すると、アプリを再起動しなくてもすぐに反映される。キーバインド・見た目・カスタムビューなど、すべての設定が対象になる。設定を[複数ファイルに分けている](/niwaterm/keybindings/#設定を複数のファイルに分ける)場合も、どのファイルを保存しても反映される。

手動で読み込み直したいときは、コマンドパレットから「Reload Config」を実行する。

### 設定を書き間違えたとき

構文エラーなどで設定ファイルを読み込めないときは、**直前に読み込めた設定のまま動き続ける**。書き間違えた途端にキーバインドが全部消えて、元に戻す操作もできなくなる、ということは起きない。

読み込めなかった理由はデスクトップ通知で知らせる。直して保存し直せばその内容が反映され、直ったことも通知される。ただし、起動したときから設定を読み込めていない場合は、デフォルトの設定で起動する。

## 現在の設定値を確認する

「書いたのに反映されない」ときは、いま実際に使われている設定を見る。アプリ内ではprefixキーのあとに`i`（またはコマンドパレットの「Show Settings」）で、CLIからは`niwaterm config show`で表示できる。

表示される内容は次のとおり。

- 設定ファイルを読み込めなかった場合は、その理由（「読み込みエラー」）
- 値が正しくなくて無視した項目と、デフォルト値に戻した項目（「無視した設定」）。正しくない項目があっても、その項目だけを無視して残りは反映している
- 各設定の現在の値。設定ファイルに書いていない項目もデフォルト値で表示される

キーバインドの割り当ての一覧は、ここには出ない。`niwaterm keybind list`で確認する。関数で書いた設定（右クリックメニューやワークツリーのフックなど）も表示されない。
