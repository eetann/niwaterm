---
title: niwa API
description: キーバインドの関数などで受け取るniwaから、タイル・タブ・ポップアップ・Boardを操作するAPIの一覧
---

設定ファイル（`niwaterm.config.ts`）では、キーに関数を割り当てて好きな処理を書ける（[キーバインド](/niwaterm/keybindings/#キーの割り当てを変える)）。その関数は引数に`niwa`を受け取り、`niwa`を通してタブを開く・キーを送る・ポップアップでコマンドを実行する、といったniwatermの操作ができる。右クリックメニュー（[`mouse.selectionMenu`](/niwaterm/mouse-and-links/#選択範囲の右クリックメニューselectionmenu)）や[ホバーボタン](/niwaterm/hover-buttons/)の関数でも、同じ`niwa`を使える。

## 使い方の例

### 役割を決めたタブへ飛ぶ

エディタを開くタブで`niwa tab var set role editor`を実行しておくと、この`role`という[タブ変数](/niwaterm/cli/commands/#タブ変数tab-var)を目印にタブを探して移れる。

```ts
niwa.keybind(
  "e",
  () => {
    const [tabId] = niwa.tab.var.find("role", "editor");
    if (tabId) niwa.tab.show(tabId);
  },
  { description: "エディタのタブへ移る" },
);
```

### fzfで選んだリポジトリをBoardで開く

`niwa.popup.run`は、ポップアップでコマンドを実行し、その出力を返す。fzfのような選択画面をポップアップに出し、選ばれた結果を関数の中で使える。

```ts
niwa.keybind(
  "o",
  async () => {
    const selected = await niwa.popup.run("ghq list --full-path | fzf", {
      width: 80,
      height: 80,
    });
    // 選ばずに閉じた場合は空文字列、ほかのポップアップが開いていた場合はnullが返る
    if (!selected) return;
    niwa.board.create(selected.trim());
  },
  { description: "リポジトリを選んでBoardで開く" },
);
```

### 新しいタブを開いてコマンドを打つ

```ts
niwa.keybind(
  "l",
  async () => {
    const created = niwa.tab.create();
    if (!created) return;
    await niwa.sleep(300);
    niwa.tab.sendKeys(created.tabId, "tail -f log/development.log", "Enter");
  },
  { description: "ログを流すタブを開く" },
);
```

タブを開いた直後は、まだシェルが起動しきっていないことがある。すぐにキーを送ると取りこぼすので、`niwa.sleep`で少し待ってから送る。

## APIの一覧

### タイル

| API                          | 動作                                                                                                                               |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `niwa.tile.current()`        | フォーカス中のタイルの`{ id, cwd }`を返す。`cwd`は[シェル統合](/niwaterm/shell-integration/)を入れていないと`undefined`            |
| `niwa.tile.split(opts)`      | フォーカス中のタイルを分割し、新しい`{ tileId, tabId }`を返す。`opts`は`{ orientation: "vertical" \| "horizontal", ratio?, cwd? }` |
| `niwa.tile.focus(direction)` | 隣のタイルへフォーカスを移す。`direction`は`"up"` / `"down"` / `"left"` / `"right"`                                                |
| `niwa.tile.resize(opts)`     | フォーカス中のタイルを`direction`の方向へ広げる。`opts`は`{ direction, amount? }`。その方向へ広げられないときは`false`             |
| `niwa.tile.zoom()`           | フォーカス中のタイルだけを画面いっぱいに広げる / 元に戻す。広げた状態なら`true`を返す                                              |
| `niwa.tile.close()`          | フォーカス中のタブを閉じる                                                                                                         |

### タブ

| API                                                                    | 動作                                                                                                                              |
| ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `niwa.tab.current()`                                                   | フォーカス中のタブの`{ tabId }`を返す                                                                                             |
| `niwa.tab.create(opts?)`                                               | ターミナルのタブを開き、`{ tabId }`を返す。`opts`は`{ tileId?, cwd?, shellProfile? }`。`tileId`を省くとフォーカス中のタイルに開く |
| `niwa.tab.sendKeys(tabId, ...keys)`                                    | タブへキーを送る。文字列と`Enter` / `Escape` / `C-a`のようなキーの名前を並べて渡せる                                              |
| `niwa.tab.show(tabId)`                                                 | タブへ移る。別のワークスペースやBoardにあるタブなら、そこへ切り替える                                                             |
| `niwa.tab.respawn(tabId, opts?)`                                       | タブで動いているプログラムを終了して起動し直す。`opts`は`{ cwd?, shellProfile?, command? }`                                       |
| `niwa.tab.var.get(tabId, key)` / `niwa.tab.var.set(tabId, key, value)` | タブ変数を読む / 書く                                                                                                             |
| `niwa.tab.var.find(key, value)`                                        | タブ変数`key`が`value`のタブを探し、`tabId`の配列を返す                                                                           |

`shellProfile`には、[シェルの設定](/niwaterm/shell/)で決めたプロファイルのidを渡す。

### ポップアップ

| API                              | 動作                                                                                                                                                               |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `niwa.popup.open(opts?)`         | ポップアップを開く。`opts`は`{ command?, cwd?, width?, height? }`。`command`を渡すとそのコマンドを実行し、終わると閉じる。`width`・`height`は画面に対する割合（%） |
| `niwa.popup.run(command, opts?)` | ポップアップで`command`を実行し、閉じたあとにその標準出力を返す。`opts`は`{ cwd?, width?, height? }`                                                               |

### Boardとワークスペース

| API                                                        | 動作                                                                          |
| ---------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `niwa.board.create(cwd?)`                                  | Boardを追加して切り替え、そのidを返す。`cwd`を省くとホームディレクトリで開く  |
| `niwa.board.move(boardId, index)`                          | サイドバーでのBoardの並びを`index`番目（0から数える）へ動かす                 |
| `niwa.board.moveToWorkspace(boardId, workspaceId, index?)` | Boardを別のワークスペースへ移す。移したことで空になったワークスペースは閉じる |
| `niwa.workspace.create(cwd?)`                              | ワークスペースを追加し、そのidを返す                                          |
| `niwa.workspace.switch(workspaceId)`                       | ワークスペースを切り替える                                                    |
| `niwa.workspace.current()`                                 | 今のワークスペースのidを返す                                                  |
| `niwa.workspace.list()`                                    | すべてのワークスペースの`{ id, name, active }`をサイドバーの並び順で返す      |
| `niwa.workspace.move(workspaceId, index)`                  | サイドバーでのワークスペースの並びを`index`番目（0から数える）へ動かす        |
| `niwa.workspace.swap(workspaceIdA, workspaceIdB)`          | 2つのワークスペースの並びを入れ替える                                         |

### そのほか

| API                                                    | 動作                                                                                                                                                                                    |
| ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `niwa.shell.run(command, opts?)`                       | 画面に出さずにコマンドを実行し、`{ exitCode, stdout, stderr }`を返す。`opts`は`{ shellProfile?, cwd?, env? }`。成否は`exitCode`で判断する（シェルが`stderr`へ警告を出すことがあるため） |
| `niwa.notify(opts)`                                    | デスクトップ通知を出す。`opts`は`{ title, body?, subtitle?, silent?, tabId? }`。macOSでは`tabId`を渡すと、通知のクリックでそのタブへ移る                                                |
| `niwa.clipboard.write(text)` / `niwa.clipboard.read()` | クリップボードに書く / 読む                                                                                                                                                             |
| `niwa.sleep(ms)`                                       | 指定したミリ秒だけ待つ                                                                                                                                                                  |
| `niwa.reloadConfig()`                                  | 設定ファイルを読み込み直す。`await`すると読み込みが終わるまで待てる                                                                                                                     |

キーバインドの設定に使う`niwa.keybind`・`niwa.unbind`・`niwa.prefix`・`niwa.repeatTimeout`は[キーバインド](/niwaterm/keybindings/)、ベルやリンクのクリックで動く処理を決める`niwa.on`は[ベル](/niwaterm/bell/)と[マウスとリンク](/niwaterm/mouse-and-links/#開く処理を差し替えるniwaonopen-link-)で説明している。
