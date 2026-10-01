---
title: ベルと通知
description: ほかのタブで鳴ったベルに印と通知で気付ける。ベルが鳴ったときの動きの差し替えと、CLIからの通知
---

ターミナルでベルが鳴ると、そのタブに印が付き、見ていないタブならデスクトップ通知も出る。長いビルドが終わったときや、AIエージェントが返事を待っているときに、別のタブや別のワークスペースを見ていても気付ける。

```sh
# ビルドが終わったらベルを鳴らす
make && printf '\a'
```

## ベルが鳴るとどうなるか

- **印が付く** — タブバーのタブと、サイドバーのBoardにベルのアイコンが出る。そのタブを表示すると消える
- **通知が出る** — ベルが鳴ったタブを今見ていないときは、デスクトップ通知が出る。同じタブで何度も鳴っても、通知は5秒に1回まで。macOSでは、通知をクリックするとベルが鳴ったタブへ移る

[AIエージェント連携](/niwaterm/agents/)を入れているタブでは、エージェントが作業している途中に鳴ったベルは無視する。エージェントは作業の途中でもベルを鳴らすことがあるため。返事を待っているときや作業が終わったときのベルには、いつもどおり印と通知が出る。

## ベルが鳴ったときの動きを変える（`niwa.on("bell", ...)`）

ベルが鳴ったときの動きを、自分で書いた関数に差し替えられる。設定ファイルの`keybindings`の関数の中で、`niwa.on("bell", ...)`を呼ぶ。

```ts
import { defineConfig } from "@niwaterm/config";

export default defineConfig({
  keybindings: (niwa) => {
    niwa.on("bell", (event) => {
      // 今見ていないワークスペースで鳴ったときだけ通知する
      if (event.workspaceId !== niwa.workspace.current()) {
        niwa.notify({ title: "ベル", body: event.tabName ?? event.tabId, tabId: event.tabId });
      }
    });
  },
});
```

差し替えると、印と通知は出なくなる。いつもの動きに何かを足したいだけなら、関数の中で`niwa.bell.default(event)`を呼ぶ。

```ts
niwa.on("bell", (event) => {
  niwa.bell.default(event);
  // 鳴った時刻をタブ変数に残す
  niwa.tab.var.set(event.tabId, "bell_at", new Date().toLocaleTimeString());
});
```

関数の中では、通知（`niwa.notify`）やコマンドの実行（`niwa.shell.run`）など、[niwa API](/niwaterm/keybindings/api/)の操作を使える。

関数に渡る`event`の中身は次のとおり。

| 項目                                 | 内容                                                                                                                                   |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------- |
| `tabId`                              | ベルが鳴ったタブのid                                                                                                                   |
| `tabName`                            | 自分で付けたタブの名前。付けていなければ`null`                                                                                         |
| `tileId` / `boardId` / `workspaceId` | そのタブがあるタイル・Board・ワークスペースのid                                                                                        |
| `windowFocused`                      | 鳴ったとき、niwatermのウィンドウが前面にあったか                                                                                       |
| `visible`                            | 鳴ったとき、そのタブが画面に表示されていたか                                                                                           |
| `agentStatus`                        | 鳴ったときのAIエージェントの状態。`"idle"`（終わった）・`"working"`（作業中）・`"blocked"`（返事待ち）。エージェントがいなければ`null` |

`niwa.bell`には、印を操作する関数がある。

| 関数             | 動き                                                         |
| ---------------- | ------------------------------------------------------------ |
| `default(event)` | いつもの動き（印を付けて、見ていないタブなら通知する）をする |
| `mark(tabId)`    | タブに印を付ける。そのタブを表示すると消える                 |
| `clear(tabId)`   | タブの印を消す                                               |

エージェントの作業中に鳴ったベルにも印を付けたいときは、`niwa.bell.default(event)`の代わりに`niwa.bell.mark(event.tabId)`を呼ぶ。

## CLIから通知を出す（`notify`）

ベルとは別に、`niwa notify`でデスクトップ通知を出せる。AIエージェントやスクリプトから、作業が終わったことを知らせるときに使う。

```sh
niwa notify --title <title> [--body <body>] [--subtitle <subtitle>] [--silent] [--tab <tabId>]
```

- `--title`だけが必須。`--silent`を付けると通知音を鳴らさない
- macOSでは、通知をクリックすると`--tab`のタブへ移る。`--tab`を省くと、コマンドを実行したタブへ移る
- Windowsでは、通知をクリックしてもタブへは移らない
