---
title: シェルとターミナル
description: 新しいタブで起動するシェル、「+」ボタンから選べるシェルプロファイル、スクロールバックの行数の設定
---

新しいタブで起動するシェルと、スクロールバックで遡れる行数は、設定ファイルで変える。

## 新しいタブで起動するシェル

`shell.default`に、新しいタブで起動するシェルのコマンドを書く。書かなければ、macOSでは`/bin/zsh -il`、Windowsでは`powershell.exe -NoLogo`が起動する。

```ts
import { defineConfig } from "@niwaterm/config";

const isWindows = process.platform === "win32";

export default defineConfig({
  shell: {
    // WindowsではWSLのNixOSを、macOSではOS標準のシェルを起動する
    default: isWindows ? "wsl.exe -d NixOS" : undefined,
  },
});
```

macOSとWindowsで同じ設定ファイルを使うときは、この例のように`process.platform`で分けられる。`undefined`にした側では、OS標準のシェルが起動する。

`-d NixOS`のように引数も付けられる。ただしコマンドは空白で区切って渡すだけなので、空白を含むパスや、引用符で囲んだ引数は使えない。

設定を変えると、次に開いたタブから新しいシェルになる。開いているタブのシェルはそのまま。

## シェルを選んでタブを開く（シェルプロファイル）

タブバーの「+」ボタンの横にある「⌄」から、起動するシェルを選んで新しいタブを開ける。並べるシェルは`shell.profiles`に書く。

```ts
shell: {
  profiles: [
    { id: "bash", name: "Bash", command: "/bin/bash" },
    { id: "ssh-dev", name: "開発サーバー", command: "ssh dev" },
  ],
},
```

| 項目      | 内容                                                                                    |
| --------- | --------------------------------------------------------------------------------------- |
| `id`      | CLIの`niwa tab new --shell <id>`などで指すときの名前。英数字と`_` `-` `.`で、64文字まで |
| `name`    | 「⌄」のメニューに出す名前                                                               |
| `command` | 起動するコマンド。`shell.default`と同じ書き方                                           |

Windowsでは、PowerShellとインストール済みのWSLディストロが最初から並ぶ。WSLのディストロは`WSL: Ubuntu`のような名前で出る。`shell.profiles`に同じ`id`で書くと、名前やコマンドを書き換えられる。

コマンドパレット（prefix + `:`）にも、プロファイルごとに`New Tab: <name>`が並ぶ。キーボードだけで選びたいときはこちらを使う。

使えるプロファイルの一覧と`id`は、`niwa shell-profile list`で確かめられる。

```sh
niwa shell-profile list
```

## スクロールバックの行数

画面から流れた行は、デフォルトで10000行まで遡れる。行数は`terminal.scrollback`で変える。

```ts
terminal: {
  scrollback: 50000,
},
```

- 行数を増やすと、そのぶんメモリを使う。80桁で50000行なら、タブ1つあたり30MB強になる
- 実際に遡れる行数は、指定した値より数百行ほど多くなることがある
- 保存すると、開いているタブにもすぐ反映される。減らした場合、超えた分の履歴は消えて元に戻せない
