---
type: Reference
title: 設定ファイル
description: niwatermのTypeScript設定ファイル（キーバインド・外観など）のセットアップと書き方
---

# 設定ファイル

niwatermの設定はTypeScriptで書く。設定ディレクトリ（`~/.config/niwaterm/`）を小さなNodeプロジェクトとして扱い、型定義・ヘルパー関数は`@niwaterm/config`パッケージから提供する。これによりTypeScript LSPの標準機能（型補完・定義ジャンプ）がそのまま使える。

キーバインドに加えて、フォント・カラーテーマなどの外観も設定できる。設定ファイルの変更は再起動なしで反映される（ホットリロード）。

## セットアップ

CLI（`docs/guide/cli.md`参照）から`niwaterm init`を実行する。

```sh
niwaterm init
```

`~/.config/niwaterm/`に`package.json`/`tsconfig.json`/`niwaterm.config.ts`の3ファイルを生成し（`packages/config/examples/`が実体）、`bun install`まで実行する。`package.json`の`@niwaterm/config`依存はこのリポジトリの`packages/config`への絶対パスで自動的に埋まる（実際にnpm registryへ公開されたら、このfile参照はバージョン範囲指定、例: `^0.1.0`に差し替わる想定）。既存ファイルは上書きしないため、再実行しても安全。依存インストールを飛ばしたい場合は`--skip-install`を付ける。

生成される`niwaterm.config.ts`は次の内容がベース。

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

`node_modules/`はDotfilesで管理する場合、Git管理対象外にする想定。

`file:`の代わりに`bun link`を使う方法もある（`niwaterm init`実行後、`packages/config`で`bun link`を実行し、`~/.config/niwaterm/`で`bun link @niwaterm/config`すると差し替えられる）。

## キーバインド

niwatermのキーバインドはtmux風の**prefix方式**。まずprefixキー（既定`ctrl+b`）を押し、離してから2打目のキー（例: `d`）を押すとアクションが発火する（タイムアウトは無く、2打目キーの入力があるまで待ち続ける。`Escape`または割り当てのないキーでキャンセルできる）。コピー・ペーストのような頻用操作だけは、prefixを介さず即座に発火する`direct`ショートカットとして別枠を持てる。`repeat: true`を付けたバインドは、発火後`repeatTimeoutMs`（既定500ms）以内ならprefix無しで連打できる（tmuxの`bind-key -r`相当。詳細は下記「repeatによる連打」参照）。

`keybindings`の指定方法は2つある。単純な文字列アクションの割り当てのみで済むならオブジェクト形式で十分だが、複数アクションの束ね・条件分岐・シェル実行を伴う複雑なバインド（`.tmux.conf`にあるような`bind-key`）を書きたい場合は関数ベースAPIを使う。

### 関数ベースAPI（推奨）

`niwa`（`niwa.keybind`等）を使って1エントリずつ登録する形。**デフォルトキーバインドは先に登録済みの状態で関数が呼ばれる**ため、上書き・追加したい分だけ書けばよい（`niwa.unbind`で個別に解除もできる）。

```ts
import { defineConfig } from "@niwaterm/config";

export default defineConfig({
  keybindings: (niwa) => {
    niwa.keybind("d", "split-horizontal"); // 既存アクション名の文字列で上書き
    niwa.keybind("m", () => {
      // 任意のTSコードを書ける。tmuxのif-shell/run-shell/{}束ねに相当することは
      // 素のif文・Bun.spawn・複数行の関数呼び出しで表現する（専用DSLは増やさない）
      niwa.popup.open({ width: 80, height: 80, command: "lazygit" });
    });
  },
});
```

`niwa.keybind`のhandlerは**実際にそのキーが押された時**に呼ばれる（configファイル実行時ではない）。`niwa.tile.current()`等はその時点の実際の状態を返す。

`noPrefix: true`で`alt+`を含むキーを割り当てると、tmuxの`bind-key -n M-key`相当の即時発火バインドになる。ただしAlt(Option)キー単独の組み合わせはシェルのreadlineショートカット（`Alt+b`で単語移動等）やmacOSの特殊文字入力に使われることがあるため、割り当てるとそのキーはniwaterm側に横取りされ、シェル側へは届かなくなる点に注意する。

#### niwa API

| API | 意味 |
|---|---|
| `niwa.prefix(binding)` | prefixキー本体を設定する。例: `niwa.prefix("ctrl+b")` |
| `niwa.repeatTimeout(ms)` | `repeat: true`なバインドが連打とみなす間隔(ms)を設定する。省略時は既定500ms |
| `niwa.keybind(key, action, opts?)` | キーにアクションを割り当てる。`action`は既存アクション名の文字列、または関数ハンドラ`(niwa) => void \| Promise<void>`。`opts.noPrefix: true`でprefix不要の即時発火（directと同じ扱い。この場合`key`はcmd/ctrl/altのいずれかを含むKeyBindingString表記）。`opts.repeat: true`で発火後`repeatTimeoutMs`以内はprefix無しで連打できる（tmuxの`bind-key -r`相当。`bindings`側のみ有効、`noPrefix`併用時は効果を持たない）。`opts.description`で一覧表示（`niwaterm keybind list`）用の説明を付けられる |
| `niwa.unbind(key, opts?)` | `niwa.keybind`で割り当てたバインドを解除する |
| `niwa.sleep(ms)` | 明示的な待ち時間(ms)。下記「非同期処理について」参照 |
| `niwa.notify(opts)` | OSのデスクトップ通知を出す。`opts: { title, body?, subtitle?, silent? }`（`title`のみ必須）。クリックしてもniwatermへのフォーカス移動は行わない |
| `niwa.reloadConfig()` | 設定ファイルを再読み込みする（ファイル監視での自動リロード・`reload-config`キーバインドと同じ処理）。完了を`await`できるため、`niwa.keybind`の関数ハンドラ内で「リロード→完了後に`niwa.notify`で知らせる」のような組み立てができる |
| `niwa.tile.current()` | フォーカス中タイルの情報（`{ id, cwd }`）を返す。`cwd`はOSC7シェル統合で報告された値、未報告なら`undefined` |
| `niwa.tile.split(opts)` | フォーカス中タイルを分割する。`opts: { orientation: "horizontal" \| "vertical", ratio?, cwd? }` |
| `niwa.tile.focus(direction)` | 隣接タイルへフォーカス移動する。`direction: "up" \| "down" \| "left" \| "right"` |
| `niwa.tile.resize(opts)` | フォーカス中タイルを`direction`方向へ`amount`分拡大する（tmuxの`resize-pane`相当）。`opts: { direction, amount? }`（`amount`省略時は既定の1ステップ分）。`direction`の軸に一致するsplitが祖先に無い場合（単一タイルのワークスペース等）は`false` |
| `niwa.tile.zoom()` | フォーカス中タイルの一時的なズーム表示を切り替える（tmuxの`resize-pane -Z`相当）。他のタイルを隠し画面全体に表示し、再度呼ぶと解除する。戻り値はトグル後の状態（`true`=ズーム中） |
| `niwa.tile.close()` | フォーカス中タイルのアクティブタブを閉じる |
| `niwa.tab.current()` | フォーカス中タイルのアクティブタブの情報（`{ tabId }`）を返す。アクティブタブが無い場合は`null` |
| `niwa.tab.create(opts?)` | 新規タブを作成する。`opts: { tileId?, cwd?, shellProfile? }`（`tileId`省略時はフォーカス中タイル） |
| `niwa.tab.respawn(tabId, opts?)` | 指定タブのプロセスを強制終了し、同じtabId・タイル位置のまま再起動する（tmuxの`respawn-pane -k`相当）。`opts: { cwd?, shellProfile?, command? }`（`cwd`省略時は直前のOSC7報告cwdを引き継ぐ）。ブラウザタブ・存在しないtabIdは`false` |
| `niwa.tab.sendKeys(tabId, ...keys)` | 指定タブへキーを送信する（tmuxのsend-keys、CLIの`niwaterm tab send-keys`相当）。リテラル文字列と特殊キー名（`Enter`/`Escape`/`C-a`等）を複数個混在指定できる |
| `niwa.tab.show(tabId)` | 指定タブへフォーカスを移す。所属ワークスペースへの切替・タイルフォーカス・タブのアクティブ化をまとめて行う（tmuxの`select-pane`、CLIの`niwaterm tab show`相当）。対象タブが存在しない場合は`false` |
| `niwa.tab.var.get(tabId, key)` / `niwa.tab.var.set(tabId, key, value)` | タブ変数の読み書き（`niwaterm tab var get/set`相当） |
| `niwa.tab.var.find(key, value)` | 全ワークスペース・タイル・タブを横断して、`key`の値が`value`と一致するタブの`tabId`配列を返す（tmuxの`list-panes -F "#{pane_id} #{@role}"` + `awk`相当） |
| `niwa.popup.open(opts?)` | ポップアップを開く。`opts: { cwd?, command?, width?, height? }` |
| `niwa.popup.run(command, opts?)` | ポップアップで`command`を実行し、閉じるまで待って標準出力を返す（CLIの`popup open --capture-stdout`相当）。`opts: { cwd?, width?, height? }`。fzf等の対話UIはポップアップ内に表示したまま、選択結果だけをハンドラ側で受け取れる。既にポップアップが開いている場合は`null`、コマンドが何も出力しなかった場合は空文字列 |
| `niwa.board.create(cwd?)` | アクティブなワークスペースに新規Boardを作成してアクティブにし、そのidを返す（tmuxの`new-window`相当。BoardはADR 0006の「1ワークスペース内の複数タイルレイアウト」でtmuxのWindowに対応する）。`cwd`は最初のタブの作業ディレクトリで、省略時はOS標準（`tab.create`等と違いフォーカス中タブのcwdは引き継がない） |
| `niwa.board.move(boardId, index)` | Boardを所属ワークスペース内の表示順（サイドバーの並び・名前未設定時の連番ラベル）の`index`番目（0始まり）へ移動する。範囲外のindexは先頭・末尾へクランプする。中身とアクティブなBoardは変更しない。別のワークスペースへ移すのは`niwa.board.moveToWorkspace`（CLIの`niwaterm board move --up/--down`、サイドバーのドラッグ&ドロップと同じ並び替え） |
| `niwa.board.moveToWorkspace(boardId, workspaceId, index?)` | Boardを別のワークスペースへ移す（tmuxの`move-window`相当。CLIの`niwaterm board move --to-workspace`、サイドバーで別ワークスペースへドラッグ&ドロップするのと同じ）。レイアウト・タブ・実行中のプロセスはそのまま移る。`index`は移動先での挿入位置（0始まり）で、省略・範囲外は末尾。アクティブなBoardは移動元・移動先とも変更しない。移動元がこれで空になる場合、そのワークスペースは閉じられる（開いているポップアップも一緒に閉じる） |
| `niwa.workspace.create(cwd?)` | 新規ワークスペースを作成し、そのidを返す |
| `niwa.workspace.switch(workspaceId)` | ワークスペースを切り替える |
| `niwa.workspace.move(workspaceId, index)` | ワークスペースを表示順（サイドバー・ウィンドウタイトルの番号）の`index`番目（0始まり）へ移動する。範囲外のindexは先頭・末尾へクランプする。中身とアクティブなワークスペースは変更しない（CLIの`niwaterm workspace move`、サイドバーのドラッグ&ドロップと同じ並び替え） |
| `niwa.workspace.swap(workspaceIdA, workspaceIdB)` | 2つのワークスペースの表示順（サイドバー・ウィンドウタイトルの番号）を入れ替える（tmuxの`swap-window`相当）。中身は変更しない |
| `niwa.workspace.list()` | 全ワークスペースを表示順で`{ id, name, active }[]`として返す。`name`は未設定なら`null` |
| `niwa.workspace.current()` | 現在アクティブなワークスペースのidを返す（tmuxの`switch-client`が参照する`current-window`相当） |
| `niwa.clipboard.write(text)` / `niwa.clipboard.read()` | クリップボードの読み書き |
| `niwa.shell.run(command, opts?)` | 現在のシェルプロファイル設定（wsl.exe/powershell.exe/zsh等）に従ってログイン・インタラクティブシェル経由でコマンドを実行し、結果（`{ exitCode, stdout, stderr }`）を返す（tmuxの`run-shell`相当）。`opts: { shellProfile?, cwd?, env? }`（`shellProfile`省略時はdefaultShell）。PTYを使わないワンショット実行でGUI上にタブ・ポップアップは作らない。対話的な出力を見せたい場合は`popup.open({ command })`を使う。`-i`（インタラクティブ）指定の副作用でシェルが「no job control」等の警告をstderrへ出すことがあるため、判定にはexitCodeを使い、stderrの完全一致は避けること |

**非同期処理について**: `niwa.tile.split`等の内部APIはPTYの起動要求が完了した時点で返り、実際にシェルが入力を受け付けられる状態になるまでは待たない（niwaterm側では検知できないタイミングのため）。新規タブへ直後に`sendKeys`する場合など、シェル起動待ちが必要な場面では`await niwa.sleep(ms)`で明示的に待つ（`layouts`プリセットの`delay`フィールドと同じ思想）。

```ts
niwa.keybind("c", async () => {
  const created = niwa.tab.create();
  if (!created) return;
  await niwa.sleep(300);
  niwa.tab.sendKeys(created.tabId, "cd ~/ghq", "Enter");
});
```

`niwa.tab.var.find` + `niwa.tab.show`を組み合わせると、`role`タブ変数を目印にした「特定の役割のタブへジャンプする」キーバインドが組める（tmuxの`select-pane`をペイン変数で引く運用の相当）。

```ts
niwa.keybind("e", () => {
  const [tabId] = niwa.tab.var.find("role", "editor");
  if (tabId) niwa.tab.show(tabId);
});
```

`niwa.popup.run`を使うと、ポップアップ内のfzf等でユーザーに選ばせた結果をキーバインドのハンドラ側で受け取って処理できる（tmuxの「`display-popup`内のスクリプトからtmuxコマンドを叩く」構成に対して、niwatermでは「popupは選択結果を標準出力へ返すだけ、実際の操作はハンドラ側」と分担できる）。

```ts
// ghqのリポジトリ一覧をfzfで選び、Enterなら新規Board、ctrl-oなら現在のタブでcdする
niwa.keybind("w", async () => {
  const tab = niwa.tab.current();
  const tile = niwa.tile.current();
  // ghq-selectは「1行目: 押されたキー（fzfの--expect形式。Enterなら空行）」「2行目: 絶対パス」を
  // 標準出力へ返すだけのスクリプト
  const output = await niwa.popup.run("ghq-select", { width: 80, height: 80, cwd: tile?.cwd });
  if (!output) return; // null（既にpopupが開いている）・空文字列（キャンセル）
  const [key, targetPath] = output.split("\n");
  if (!targetPath) return;
  if (key === "ctrl-o") {
    if (tab) niwa.tab.sendKeys(tab.tabId, `cd "${targetPath}"`, "Enter");
    return;
  }
  niwa.board.create(targetPath);
});
```

#### repeatによる連打

`opts.repeat: true`を付けたバインドは、発火後`repeatTimeoutMs`（既定500ms、`niwa.repeatTimeout(ms)`で変更可）以内ならprefix無しで同じ2打目キーテーブルのrepeatableなキーを連打できる（tmuxの`bind-key -r`相当）。`.tmux.conf`の`bind-key -r H/J/K/L resize-pane -L/-D/-U/-R`に相当する例:

```ts
keybindings: (niwa) => {
  niwa.repeatTimeout(300); // 省略時は500ms
  niwa.keybind("h", "resize-left", { repeat: true });
  niwa.keybind("j", "resize-down", { repeat: true });
  niwa.keybind("k", "resize-up", { repeat: true });
  niwa.keybind("l", "resize-right", { repeat: true });
},
```

`resize-up`/`resize-down`/`resize-left`/`resize-right`はフォーカス中タイルを既定の1ステップ分（`niwa.tile.resize`と同じ量）だけ拡大する組み込みアクションで、既定キーは割り当てられていない（上記のように自分で割り当てる）。`repeat`は`bindings`（prefix経由の2打目キー）側でのみ効果を持ち、`noPrefix: true`のdirectショートカットには効果がない（directは元々prefix無しの即時発火で、キーを押し続ければOSのキーリピートがそのまま連続入力を生むため）。

#### 一覧での説明表示

現在有効なキーバインドは`niwaterm keybind list`（詳細: `docs/guide/cli.md`）で確認できる。一覧に出るのは既定ではアクション名（文字列アクション）または`function`（関数ハンドラ）のため、関数ハンドラには`opts.description`で何をするバインドなのかを添えておくと読める一覧になる。

```ts
niwa.keybind(
  "r",
  async () => {
    await niwa.reloadConfig();
    niwa.notify({ title: "設定をリロードしました" });
  },
  { description: "設定をリロードして通知する" },
);
```

```
ctrl+b r          設定をリロードして通知する
```

#### 複数ファイルへの分割

キーバインドを関心事ごとに複数ファイルへ分けたい場合、各ファイルは`niwa`を受け取る関数をexportし、エントリファイル（`niwaterm.config.ts`）側でimportして呼び出す。

```ts
// keymaps.ts
import type { Niwa } from "@niwaterm/config";

export function applyTileKeymaps(niwa: Niwa): void {
  niwa.keybind("d", "split-horizontal");
}

// niwaterm.config.ts
import { defineConfig } from "@niwaterm/config";
import { applyTileKeymaps } from "./keymaps";

export default defineConfig({
  keybindings: (niwa) => {
    applyTileKeymaps(niwa);
  },
});
```

エントリファイル以外（上記の`keymaps.ts`）の変更もホットリロードで拾われる（「ホットリロード」節参照）。

### オブジェクト形式（従来）

`keybindings`に次の4フィールドを持つオブジェクトを直接渡すこともできる。未指定のフィールドは`defaultKeybindings`の値のまま有効（`defaultKeybindings`をspreadしてから一部だけ上書きするのが基本の書き方）。

| フィールド | 型 | 意味 |
|---|---|---|
| `prefix` | `KeyBindingString` | prefixキー本体。既定は`"ctrl+b"`（tmux標準を踏襲。macOS/Windowsで共通） |
| `bindings` | `Record<string, KeybindAction \| { target: KeybindAction, repeat: boolean }>` | prefix入力後に押す2打目キー→アクションのマップ。`{ target, repeat: true }`の形で指定するとrepeat連打が有効になる（上記「repeatによる連打」参照） |
| `direct` | `Record<KeyBindingString, KeybindAction \| { target: KeybindAction, repeat: boolean }>` | prefixを介さず即座に発火する直接ショートカット。既定はWindowsのみコピー・ペーストが入っている（macOSはApplicationMenu経由でCmd+C/Vが既に機能するため空）。`repeat`はここでは効果を持たない |
| `repeatTimeoutMs` | `number` | `repeat: true`なバインドが連打とみなす間隔(ms)。既定500 |

```ts
keybindings: {
  ...defaultKeybindings,
  bindings: {
    ...defaultKeybindings.bindings,
    d: "split-horizontal",
    "shift+d": "split-vertical",
    h: { target: "resize-left", repeat: true },
  },
},
```

以下、両形式に共通するバインド文字列の書式・既定値・アクション一覧。

**`prefix` / `direct` の書式**: `修飾子+...+キー本体`（`+`区切り）

- 修飾子は `cmd` / `ctrl` / `shift` / `alt`。**`cmd`/`ctrl`/`alt`のいずれかを含む必要がある**（`shift`単独を含め、これらを含まないキーは通常のターミナル入力に予約されているため、割り当てても無視される）
- 例: `"ctrl+b"`, `"cmd+shift+c"`, `"alt+h"`（tmuxの`bind-key -n M-h`相当。Alt単独の組み合わせはシェルのreadlineショートカットや特殊文字入力と衝突しうるので注意）

**`bindings`（2打目キー）の書式**: 修飾子なしの単一キー本体、または`修飾子+キー本体`

- 修飾子は `shift` / `alt` のみ許容（prefix自体で既に主要な修飾子を使っているため、2打目はシンプルな単一キー操作に絞っている。`cmd`/`ctrl`を含むエントリは無視される）
- キー本体はアルファベット（`d`, `w`, `c`等）、矢印（`up`/`down`/`left`/`right`）、`pageup`/`pagedown`/`home`/`end`、角括弧（`[`/`]`）、バッククォート（`` ` ``）のいずれか
- 例: `"d"`, `"shift+d"`, `"up"`, `"pageup"`

**既定の2打目キー一覧**（prefix `ctrl+b` の後に押す）:

| キー | アクション |
|---|---|
| `d` / `shift+d` | split-vertical / split-horizontal |
| `w` | close-tile |
| `up` / `down` / `left` / `right` | focus-up / focus-down / focus-left / focus-right |
| `z` | toggle-zoom |
| `c` | new-tab |
| `shift+t` | new-browser-tab |
| `n` / `p` | next-tab / prev-tab |
| `r` | rename-tab |
| `,` | rename-board |
| `shift+n` | new-workspace |
| `shift+w` | new-window |
| `]` / `[` | next-workspace / prev-workspace |
| `b` | toggle-sidebar |
| `shift+b` | next-sidebar-view |
| `f` | jump-hint |
| `v` | copy-mode |
| `` ` `` | toggle-popup |
| `i` | show-config |
| `:` | command-palette |
| `=` / `-` / `0` | increase-font-size / decrease-font-size / reset-font-size |
| `pageup` / `pagedown` | scroll-page-up / scroll-page-down |
| `home` / `end` | scroll-to-top / scroll-to-bottom |

**KeybindAction の一覧**（50種類。関数ベースAPIでは`niwa.keybind(key, "アクション名")`のように文字列そのまま渡せる）:

| アクション | 意味 |
|---|---|
| `split-vertical` / `split-horizontal` | タイルを垂直/水平分割 |
| `close-tile` | フォーカス中のタブ/タイルを閉じる |
| `focus-up` / `focus-down` / `focus-left` / `focus-right` | 隣接タイルへフォーカス移動 |
| `resize-up` / `resize-down` / `resize-left` / `resize-right` | フォーカス中タイルを既定の1ステップ分拡大（`niwa.tile.resize`相当）。既定キーは無いため使うには自分で割り当てる必要がある。`repeat: true`と組み合わせるとtmuxの`-r`風に連打できる（上記「repeatによる連打」参照） |
| `toggle-zoom` | フォーカス中タイルの一時的なズーム表示を切り替える（`niwa.tile.zoom()`相当。tmuxの`resize-pane -Z`相当。他のタイルを隠し画面全体に表示、再実行で解除。タブを右クリックして「ズーム表示」／「ズームを解除」を選んでも同じことができる） |
| `new-tab` | 新規タブ作成 |
| `new-browser-tab` | 新規ブラウザタブ作成（表示URLは`browser.defaultUrl`を参照） |
| `new-custom-view-tab` | `customView`設定を開くタブを作成（`customView`未設定時は何もしない。既定キーは無いため使うには自分で割り当てる必要がある） |
| `next-tab` / `prev-tab` | タブ切替 |
| `rename-tab` | フォーカス中タブの名前を入力ダイアログで変更する（既定は prefix + `r`。Enterで確定、Escapeでキャンセル。空のまま確定すると既定の連番ラベルへ戻る。タブバーのタブを右クリックして「名前を変更」を選んでも同じことができる） |
| `restart-tab` | フォーカス中タブのプロセスを強制終了し、同じ`tabId`のまま再起動する（`niwa.tab.respawn`相当。tmuxの`respawn-pane -k`相当だが既定バインドは無く、実行前にy/nの確認ダイアログを挟む。使うには自分で割り当てる必要がある） |
| `next-board` / `prev-board` | 同じワークスペース内のBoard切替（tmuxの`next-window` / `previous-window`相当）。既定キーは無いため使うには自分で割り当てる必要がある |
| `rename-board` | アクティブなBoardの名前を入力ダイアログで変更する（tmuxの`rename-window`相当。既定は prefix + `,`。Enterで確定、Escapeでキャンセル。空のまま確定すると既定の連番ラベルへ戻る。サイドバーのBoard行をダブルクリック・右クリックしても同じことができる） |
| `set-board-worktree` | アクティブなBoardに紐づくワークツリーを入力ダイアログで設定する（CLIの`niwaterm board worktree set`と同じ。入力欄にはそのBoardのカレントディレクトリが入った状態で開き、空のまま確定すると紐づけを解除する。サイドバーのBoard行を右クリックしても同じことができる）。既定キーは無いため使うには自分で割り当てる必要がある |
| `new-workspace` | 新規ワークスペース作成 |
| `new-window` | 新しいOSウィンドウを開く（既定は prefix + `shift+w`。CLIの`niwaterm window new`と同じ。前回の状態は復元されず、閉じても何も残らない一時ウィンドウになる。詳細は[CLIガイド](/guide/cli.md)の「ウィンドウ」節） |
| `next-workspace` / `prev-workspace` | ワークスペース切替 |
| `move-board-up` / `move-board-down` | アクティブなBoardの表示順をワークスペース内で1つ上/下へ移動する（サイドバーのドラッグ&ドロップ、CLIの`niwaterm board move --up/--down`と同じ並び替え）。端では何もしない。既定キーは無いため使うには自分で割り当てる必要がある |
| `move-board-to-workspace` | アクティブなBoardを別のワークスペースへ移す（tmuxの`move-window`相当。CLIの`niwaterm board move --to-workspace`と同じ）。移動先はピッカーで選ぶ（Escapeでキャンセル）。移すとワークスペースが空になる場合は確認ダイアログを挟む。既定キーは無いため使うには自分で割り当てる必要がある |
| `move-workspace-up` / `move-workspace-down` | アクティブなワークスペースの表示順を1つ上/下へ移動する（サイドバーのドラッグ&ドロップ、CLIの`niwaterm workspace move`と同じ並び替え）。端では何もしない。既定キーは無いため使うには自分で割り当てる必要がある |
| `toggle-sidebar` | サイドバーの表示/非表示切替 |
| `next-sidebar-view` / `prev-sidebar-view` | サイドバーに出すビュー（ワークスペース一覧と`customView`パネル）を循環で切り替える（既定はnext側のみ prefix + `shift+b`。ビューが2つの間はnextだけで往復できるため、prevを使うには自分で割り当てる必要がある。`customView`未設定時はビューが1つしかないので何もしない。サイドバーを閉じている場合は開いた上で切り替える） |
| `toggle-popup` | ポップアップの表示/非表示切替 |
| `jump-hint` | ジャンプ先へラベルを出し、打ったラベルの場所へ飛ぶ（既定は prefix + `f`。vimiumの`f`相当。操作は下記「ジャンプヒント」参照） |
| `copy-selection` | 選択範囲をクリップボードへコピー（既定は`direct`にWindowsのみ`ctrl+shift+c`が割り当て済み。macOSはApplicationMenu経由でCmd+Cが既に機能する） |
| `copy-mode` | vi風コピーモードに入る（既定は prefix + `v`。キーボードだけでスクロールバックを移動・選択・コピーできる。操作キーは下記「コピーモード」参照） |
| `paste-clipboard` | クリップボードの内容をペースト（既定は`direct`にWindowsのみ`ctrl+shift+v`が割り当て済み。macOSはApplicationMenu経由でCmd+Vが既に機能する） |
| `scroll-page-up` / `scroll-page-down` | スクロールバックを1ページ分スクロール |
| `scroll-to-top` / `scroll-to-bottom` | スクロールバックの先頭/最新行へジャンプ |
| `command-palette` | コマンドパレットを開く |
| `increase-font-size` / `decrease-font-size` / `reset-font-size` | フォントサイズの拡大/縮小/リセット |
| `reload-config` | 設定ファイルを手動で再読み込みする（ファイル保存時の自動リロードと同じ処理。既定キーは無いため使うには自分で割り当てる必要がある） |
| `show-config` | 現在有効な設定値の一覧をモーダルで表示する（既定は prefix + `i`。CLIの`niwaterm config show`と同じ内容。Escapeで閉じる） |

### ジャンプヒント

prefix + `f`（`jump-hint`アクション）で、ジャンプできる場所にラベルが重なって表示される。ラベルを打つとその場所へ飛ぶ。vimiumの`f`と同じ発想で、方向キーを何度も押したりサイドバーをクリックしたりせずに目的の場所へ1〜2打で届かせるためのもの。

ラベルが出る対象は次の4つ。

| 対象 | 打ったときの動き |
|---|---|
| タイル（ラベルは中央） | そのタイルへフォーカスを移す。表示中のタブはそのまま |
| タブバーのタブ | そのタブへ切り替える（タイルのフォーカスもそのタイルへ移る） |
| サイドバーのBoard行 | そのBoardへ切り替える。別ワークスペースのBoardならワークスペースごと切り替わる |
| サイドバーのワークスペース見出し・ポップアップ | そのワークスペースへ切り替える／ポップアップを出す |

- ラベルは`asdfghjkl`（ホームロー）で、対象が9個までなら1文字、超えると一部が2文字になる。2文字ラベルは1文字打った時点で候補が絞り込まれ、打った分は薄く表示される
- **画面に出ているものにだけラベルが出る**。サイドバーを閉じていればBoard行は対象外（`toggle-sidebar`で開いてから使う）、ズーム表示中は隠れているタイルも対象外になる
- タブが1つだけのタイルにはタブのラベルを出さない（タイルのラベルと行き先が同じため）。逆にブラウザタブを表示中のタイルはタイル中央のラベルが出ず、タブ側のラベルだけになる（ブラウザの描画がHTMLより手前に来るため、重ねたラベルが見えない）
- `Escape`・`Backspace`（1文字も打っていないとき）・どのラベルにも繋がらないキー・修飾キー付きの打鍵で取りやめる。取りやめた打鍵はターミナルへは送られない
- ラベルはヒントを出した時点の座標に描かれるため、ウィンドウをリサイズするかクリックすると畳まれる

### コピーモード（vi風のキーボード選択）

prefix + `v`（`copy-mode`アクション）でコピーモードに入る。マウスを使わずにスクロールバックを移動し、範囲を選択してクリップボードへコピーできる。コピーモード中はビューポートがその時点の位置で固定されるため、新しい出力が来ても画面が流れない。

コピーモード中のキーはniwatermが受け取り、ターミナルへは送られない（prefixキーは通常どおり効くため、prefix経由のタイル操作はコピーモード中もできる）。

| キー | 動作 |
|---|---|
| `h` / `j` / `k` / `l`、矢印キー | カーソル移動 |
| `w` / `b` / `e` | 単語単位の移動（次の単語の先頭 / 前の単語の先頭 / 単語の末尾） |
| `0` / `^` / `$` | 行頭 / 行の最初の非空白 / 行の最後の非空白 |
| `gg` / `G` | スクロールバックの先頭 / 最新行 |
| `ctrl+u` / `ctrl+d` | 半画面ずつ上下へ |
| `ctrl+b` / `ctrl+f`、`pageup` / `pagedown` | 1画面ずつ上下へ（`ctrl+b`はprefixが優先されるため、実際にはprefixとして解釈される点に注意） |
| `H` / `M` / `L` | 画面の上端 / 中央 / 下端へ |
| `/` / `?` | 前方 / 後方へのインクリメンタル検索を開始する（打った文字列がその場でハイライトされ、`Enter`で最初の一致へジャンプ、`Escape`で取りやめ） |
| `n` / `N` | 直前の検索を同じ向き / 逆向きで繰り返す |
| `v` / `V` | 文字選択 / 行選択の開始・解除（選択中に押すと切り替え） |
| `y`、`Enter` | 選択範囲をクリップボードへコピーしてコピーモードを抜ける（選択していなければカーソル行をコピー） |
| `Escape` | 選択中なら選択解除、選択していなければコピーモードを抜ける |
| `q` / `ctrl+c` | コピーモードを抜ける |

コピー時は折り返された行を1行に連結し（unwrap）、行末の空白を落とす（trim）。全角文字は2桁として扱うため、日本語を含む行でも桁がずれない。

#### 検索の挙動

- 検索文字列は正規表現ではなく**そのままの文字列**として扱う。すべて小文字なら大文字小文字を区別せず、1文字でも大文字を含めると区別する（vimのsmartcase相当）
- スクロールバックの端まで探すと反対の端から折り返して探す（vimのwrapscan相当）。見つからない場合は画面下端にメッセージが出る
- 検索文字列の入力中は`Backspace`で1文字削除（空の状態で押すと入力自体を取りやめ）、`ctrl+u`で全消し、`ctrl+c`で取りやめ。空のまま`Enter`を押すと直前の検索文字列を使い回す
- 入力中はIMEでの日本語入力とペースト（Cmd+V）も使える
- 選択中（`v`/`V`のあと）に検索してもコピーモードは抜けず、選択範囲が一致箇所まで伸びる
- 検索は**画面上の1行**の中で完結した一致だけを見つける。折り返して2行に跨っている文字列は、コピー時と違ってunwrapされないためヒットしない

不正なバインド文字列（`prefix`/`direct`で未知の修飾子・`cmd`/`ctrl`/`alt`のいずれも含まない、`bindings`で`cmd`/`ctrl`を含む等）や未知のアクション名を指定した場合、そのエントリだけが無視され、警告がコンソールに出力される（起動時にターミナルから`mise run start`した場合に見える）。設定ファイル自体が読み込めない場合（構文エラー、`node_modules`未インストール等）はデフォルトキーバインド全体にフォールバックする。

## ベル

ターミナルがBEL文字（`0x07`）を出力すると、そのタブに「ベル」の印が付く。長いビルドの終わり（`make && printf '\a'`）やエージェントの応答待ちを、別のタブ・別のワークスペースを見ている間でも取りこぼさないための仕組み。

既定の挙動は2つ。

- **タブへのマーク**: タブバーとサイドバーのBoard行にベルのアイコンが出る。そのタブが画面に出た時点で自動的に消える（ウィンドウがフォーカスされていない間は、画面に出ていても消えない）
- **デスクトップ通知**: そのタブが今まさに画面に出ている時以外に出す（別Board・別ワークスペース・非アクティブタブ、またはniwatermのウィンドウが後ろにある場合）。目の前に出ているタブならマークだけで気づけるため通知しない。同じタブでベルが続く場合、通知は5秒間隔まで間引く（マークは常に付く）

### 処理を差し替える（`niwa.on("bell", ...)`）

`keybindings`の関数の中で`niwa.on("bell", handler)`を呼ぶと、**既定の処理の代わりに**そのハンドラが走る。

```ts
import { defineConfig } from "@niwaterm/config";

export default defineConfig({
  keybindings: (niwa) => {
    niwa.on("bell", (event) => {
      // 今見ていないワークスペースで鳴ったベルだけ通知する
      if (event.workspaceId !== niwa.workspace.current()) {
        niwa.notify({ title: "ベル", body: event.tabName ?? event.tabId });
      }
    });
  },
});
```

既定の挙動に何かを足したいだけなら、ハンドラの中から`niwa.bell.default(event)`を呼ぶ。

```ts
niwa.on("bell", (event) => {
  niwa.bell.default(event);
  niwa.tab.var.set(event.tabId, "bell_at", new Date().toLocaleTimeString());
});
```

ハンドラは`async`にでき、`niwa`のAPI（`notify`・`shell.run`・`tab.show`等）をそのまま使える。

### ハンドラに渡る値（`NiwaBellEvent`）

| フィールド | 型 | 意味 |
|---|---|---|
| `tabId` | `string` | ベルが鳴ったタブ |
| `tabName` | `string \| null` | サイドバーから設定したタブ名。未設定は`null` |
| `tileId` / `boardId` / `workspaceId` | `string` | そのタブの所在 |
| `windowFocused` | `boolean` | 鳴った時点でniwatermのウィンドウがフォーカスされていたか |
| `visible` | `boolean` | 鳴った時点でそのタブが画面に出ていたか（別Board・別ワークスペース・非アクティブタブなら`false`） |

### `niwa.bell`

| メソッド | 意味 |
|---|---|
| `default(event)` | 既定の処理（マーク＋画面に出ていないタブなら通知）を実行する |
| `mark(tabId)` | タブにマークを付ける。マークはそのタブが画面に出た時点で自動的に消える |
| `clear(tabId)` | タブのマークを消す |

## 外観設定

`appearance`はフォント・カラーテーマを指定するオブジェクト。全フィールドoptionalで、指定しなかったフィールドは`defaultAppearance`の値のまま有効（`defaultAppearance`をspreadしてから一部だけ上書きするのが基本の書き方）。

| フィールド | 型 | 意味 |
|---|---|---|
| `fontFamily` | `string` | CSSの`font-family`値をそのまま文字列で指定する（複数フォント列挙・クォートはユーザー側の責務） |
| `fontSize` | `number` | フォントサイズ（px） |
| `lineHeight` | `number` | 行高（px）。`font-size`コマンド・キーバインドでのズームでは、`fontSize`との比率を保ったままこの値も拡大・縮小される |
| `foreground` | `string` | 前景色（CSSカラー値） |
| `background` | `string` | 背景色（CSSカラー値） |
| `backgroundOpacity` | `number` | 背景の不透明度（0〜1、既定`1`）。1未満にすると背後のウィンドウが透ける |
| `backgroundImage` | `string` | 背景画像（既定`"none"`）。CSSの`background-image`値か、画像ファイルのパス |
| `ansiColors` | `readonly string[]` | ANSI標準16色（index 0-7:通常、8-15:bright）。16色すべてを書く必要はなく、書いたindexだけ上書きされる |
| `tabBar` | `"auto"` / `"always"` | タブが1つだけのタイルでのタブバーの出し方（既定`"auto"`）。下記「タブバーの出し方」参照 |
| `titleBar` | `"default"` / `"hidden"` | ネイティブのタイトルバーを出すか隠すか（既定`"default"`）。下記「タイトルバーを隠す」参照 |

```ts
appearance: {
  ...defaultAppearance,
  fontSize: 16,
  // index 0（黒相当）だけ赤に変更する例
  ansiColors: defaultAppearance.ansiColors.with(0, "#ff0000"),
},
```

`ansiColors`はindex 0-15だけを読むため、`[...defaultAppearance.ansiColors, "#ff0000"]`のように末尾へ足す書き方だと追加分はindex 16以降になって無視される。一部だけ変えるときは上の`with()`を使うか、16色すべてを並べる。

不正な値（`fontSize`に文字列を渡す、色に空文字列を渡す等）を指定した場合、そのフィールド（`ansiColors`はそのindex）だけ警告付きでデフォルトにフォールバックする。256色のうち16-231（6x6x6カラーキューブ）・232-255（グレースケール）は固定の計算式でユーザー設定の対象外。

### タブバーの出し方

タブが1つだけのタイルでは、タブバーは常時表示せず、マウスカーソルをタイルの上端（数px）へ当てている間だけターミナルへ重ねて出す（既定の`tabBar: "auto"`）。1行分の高さがターミナルに回るぶん表示行が増える代わりに、`+`（新規タブ）・`▼`（シェルプロファイル指定の新規タブ）・タブの右クリックメニュー・タブのドラッグ&ドロップにはマウスを上端へ当ててから触ることになる。

```ts
appearance: {
  ...defaultAppearance,
  // タブの数に関わらず常にタブバーを表示する（従来の挙動）
  tabBar: "always",
},
```

- タブが2つ以上あるタイルは`"auto"`でも常時表示（どのタブを見ているか分からなくなるため）
- ブラウザタブ・カスタムビュータブだけのタイルも常時表示（ネイティブのwebviewがHTMLより手前に描かれるため重ねられない）
- 重ねての表示中も高さは占有しないので、出し入れでターミナルの行数は変わらない
- 呼び出しの当たり判定はタイル上端の数pxだけ（バー1本分にはしていない。出たバーはマウスを受け取る側に回るため、判定を広げるとターミナル1行目のクリック・選択・マウスレポートがバーに吸われてしまう）
- キーボードだけで同じ操作へ届くよう、`rename-tab`アクション（既定 prefix + `r`）とコマンドパレットの`New Tab: <プロファイル名>`を用意している

### 背景の透過・グラデーション・画像

```ts
appearance: {
  ...defaultAppearance,
  backgroundOpacity: 0.85,
  backgroundImage: "linear-gradient(135deg, rgba(137, 180, 250, 0.3), transparent)",
  // 画像ファイルを直接指定することもできる
  // backgroundImage: "/home/user/pictures/wall.png",
},
```

`backgroundImage`はCSSの関数形式（`linear-gradient(...)`・`url(...)`・`none`）ならそのまま使われ、それ以外は画像ファイルのパスとして読み込んでdata URIへ埋め込む。対応拡張子はpng・jpg・jpeg・gif・webp・avif・bmp・svg。読めない場合は警告して背景なしになる。

透過に関する注意:

- `backgroundOpacity`を変えたときはniwatermの再起動が必要。透過の有無はウィンドウ生成時にしか決められない
- 透過するのはウィンドウの地の部分（ターミナル・サイドバー・タブバー）で、SGRで背景色が指定されたセル（TUIが塗った部分）は不透明のまま残る
- ポップアップ（`popup`キーバインドで開くターミナル）は読みやすさを優先して不透明のまま
- 透過中はサブピクセルアンチエイリアスが使えずグレースケール描画になるため、文字の見え方がわずかに変わる

### タイトルバーを隠す

```ts
appearance: {
  ...defaultAppearance,
  titleBar: "hidden",
},
```

OSのタイトルバーを隠し、その高さぶんを画面に回す。背景の透過とは独立した設定なので、片方だけでも組み合わせても使える。

隠すとウィンドウの移動・最小化・最大化・終了の導線がタイトルバーごと無くなるため、代わりに以下を使う。

- 移動: サイドバー上端のツールバー（虫眼鏡ボタンの左側の空き）をドラッグする
- 最小化・最大化・終了: OSのショートカット（Windowsなら<kbd>Win</kbd>+<kbd>↓</kbd>・<kbd>Win</kbd>+<kbd>↑</kbd>・<kbd>Alt</kbd>+<kbd>F4</kbd>）
- 端をつかんでのリサイズ・スナップは隠しても従来どおり効く

注意:

- `titleBar`を変えたときはniwatermの再起動が必要。タイトルバーの有無はウィンドウ生成時にしか決められない
- Windowsではツールバーのドラッグ移動中、Aero Snap（画面端へ寄せてのスナップ）とダブルクリックでの最大化は働かない
- macOSではウィンドウ操作ボタン（信号機）だけがツールバーへ重なって残るため、移動以外はそのまま使える

## ブラウザ設定

`browser`は新規ブラウザタブ（`new-browser-tab`キーバインド、または`niwaterm tab new`のCLIで`--url`省略時）を開いた際のデフォルトURLを指定するオブジェクト。

| フィールド | 型 | 意味 |
|---|---|---|
| `defaultUrl` | `string` | 新規ブラウザタブの初期表示URL。未指定時は`about:blank` |

```ts
browser: {
  defaultUrl: "https://example.com",
},
```

不正な値（空文字列等）を指定した場合、警告付きで`about:blank`にフォールバックする。CLIから`niwaterm tab new --tile <tileId> --url <url>`のように`--url`を指定した場合は、この設定に関わらず指定したURLが優先される。

## マウス設定

`mouse`はマウス操作の挙動を指定するオブジェクト。

| フィールド | 型 | 意味 |
|---|---|---|
| `copyOnSelect` | `boolean` | マウスでのテキスト選択が終わった時点で、選択範囲をクリップボードへ自動コピーする。未指定時は`false` |
| `selectionMenu` | `function` | 選択範囲を右クリックした時のメニューに並べる項目を組み立てる。未指定時は組み込みの「コピー」だけが出る |

```ts
mouse: {
  copyOnSelect: true,
},
```

`copyOnSelect`が拾うのはターミナル出力の中で完結した選択だけで、サイドバーやコマンドパレットの文字列を選択してもクリップボードは書き換わらない。コピー後も選択はそのまま残る。TUIアプリがマウスを掴んでいる間（マウスレポート有効時）はドラッグがアプリ側へ渡るため、Shiftを押しながらドラッグして選択する。

コピーが成立すると、そのターミナルの右上に`COPIED · 2行`のようなバッジが1.5秒だけ出る。この表示は`copyOnSelect`専用ではなく、`ctrl+shift+c`（`copy-selection`）・コピーモードの`y`でも共通に出る。一方、ターミナル上のアプリがOSC 52で書き込んだぶん（vimのyank等）はユーザー操作ではないためバッジを出さない。

不正な値（真偽値以外）を指定した場合、警告付きで`false`にフォールバックする。

### 選択範囲の右クリックメニュー（selectionMenu）

ターミナル出力を選択した状態で右クリックすると、その選択範囲に対するメニューが出る。メニューの先頭には常に組み込みの「コピー」があり、その下に`selectionMenu`が返した項目が並ぶ。選択が無い状態の右クリックではメニューを出さない（マウスレポート中のTUIアプリにはこれまで通り右クリックがそのまま渡る）。

`selectionMenu`は右クリックのたびに呼ばれる関数で、開くコマンドの出し分け（拡張子・OS・cwd）は素のif文で書ける。

```ts
mouse: {
  selectionMenu: (selection, niwa) => {
    const path = selection.text.trim();
    const items = [];
    if (/\.(png|jpe?g|gif|svg)$/.test(path)) {
      items.push({
        label: "画像を開く",
        run: () => niwa.shell.run(`qlmanage -p '${path}'`, { cwd: selection.cwd }),
      });
    }
    items.push({
      label: process.platform === "win32" ? "エクスプローラで開く" : "openで開く",
      run: () => {
        const opener = process.platform === "win32" ? "explorer.exe" : "open";
        return niwa.shell.run(`${opener} '${path}'`, { cwd: selection.cwd });
      },
    });
    return items;
  },
},
```

第1引数には選択範囲の情報が渡る。

| フィールド | 型 | 意味 |
|---|---|---|
| `text` | `string` | 選択されているテキスト |
| `tabId` | `string` | 選択があるタブのid |
| `cwd` | `string \| undefined` | そのタブが報告している作業ディレクトリ。シェル統合（OSC 7）を入れていないタブでは`undefined` |

第2引数は[キーバインドの関数ハンドラ](#キーバインド)と同じ`niwa`で、`niwa.shell.run`・`niwa.popup.open`・`niwa.tab.create`・`niwa.notify`等をそのまま呼べる。返す項目は`label`（メニューの表示名）と`run`（選んだ時の処理）を持つオブジェクトで、`run`は非同期でもよい。空配列を返せば組み込みの「コピー」だけのメニューになる。

関数はniwaterm本体（bun側）で実行されるため、`process.platform`でのOS判定・`Bun.spawn`・`node:fs`の読み書きも書ける。選択テキストは`niwa.shell.run`でシェルへ渡るため、パスに空白や記号が入りうるならクォートする。

関数が例外を投げた場合・配列以外を返した場合・`label`や`run`を欠く項目は、警告付きで無視される（メニュー自体は組み込みの項目だけで開く）。

相対パスを開くには`cwd`が要るので、シェル統合（`contrib/shell-integration/`）を入れておくと扱いやすい。

## ユーザー定義HTML UI（customView）

`customView`は、ユーザーが用意したHTMLをniwaterm内（サイドバー・タブ）に表示するための設定。**未指定なら機能自体がオフ**になり、サイドバーの見た目・挙動は変化しない。

| フィールド | 型 | 意味 |
|---|---|---|
| `name` | `string` | サイドバーの切替ボタンに表示する名前。未指定時は`"Custom View"` |
| `path` | `string` | ローカルHTMLファイルへのパス。`~/.config/niwaterm/`（設定ファイルのあるディレクトリ）からの相対 or 絶対パス。`file://`として読み込む |
| `url` | `string` | 任意URL。`path`未指定時のみ使われる（`path`優先） |
| `handlers` | `Record<string, (payload, niwa) => unknown>` | HTML側から`niwaterm.call`で呼べる関数。後述 |

`path`と`url`のどちらも指定しなかった場合は警告付きで機能オフになる。

```ts
customView: {
  name: "Notes",
  path: "./notes.html",
},
```

設定すると、サイドバーの上部にワークスペース一覧との切替スイッチャーが表示され、クリックで一覧表示とcustomViewパネルを切り替えられる。キーバインド（既定は prefix + `shift+b`の`next-sidebar-view`）・コマンドパレットの「Next Sidebar View」からも同じ切り替えができる。同じHTMLはタブとしても開ける:

- キーバインド: `new-custom-view-tab`アクションを自分で割り当てる（既定キーは無い）
  ```ts
  keybindings: (niwa) => {
    niwa.keybind("shift+u", "new-custom-view-tab");
  },
  ```
- CLI: `niwaterm tab new --tile <tileId> --custom-view`（`--url`と同時指定は不可）

内部的には既存のブラウザタブ機構（`<electrobun-webview>`）をそのまま使っている。

### HTMLからniwatermを操作する（handlers）

HTMLはniwaterm本体とは別プロセス（webview）で動くため、そこから直接niwatermやOSを操作することはできない。
代わりに、`handlers`へ書いた関数をHTML側から名前で呼ぶ。

```ts
customView: {
  name: "Worktrees",
  path: "./worktrees.html",
  handlers: {
    list: async (_payload, niwa) => {
      const result = await niwa.shell.run("niwaterm worktree list");
      return result.stdout;
    },
    open: async (payload: { path: string }, niwa) => {
      await niwa.shell.run(`niwaterm worktree open "${payload.path}"`);
    },
  },
},
```

```js
// worktrees.html
const stdout = await niwaterm.call("list");
await niwaterm.call("open", { path: "/path/to/worktree" });
```

サイドバーのパネルとタブのどちらで開いても同じように使える。
関数の第1引数はHTML側が渡した`payload`、第2引数は`niwa`（キーバインドの関数ハンドラ・`mouse.selectionMenu`と同じAPI）。
設定ファイルと同じ実行環境なので、`Bun.spawn`・`node:fs`もそのまま書ける。

- `payload`と戻り値はJSONへ変換できる形に限る（関数・循環参照は渡せない）。戻り値を省略すると`null`が返る
- ハンドラが例外を投げると、HTML側の`niwaterm.call`がその`message`でrejectする
- 時間のかかる処理でも打ち切られない（gitの操作・依存のインストールをそのまま書ける）
- 関数以外を書いた項目は警告付きで無視される。呼べる名前は`niwaterm config show`で確認できる
- `niwa.shell.run`の出力をパースする場合、シェル統合を入れているとプロンプトフックのOSC（cwd通知）が標準出力へ混ざる。`contrib/custom-views/worktrees/handlers.ts`の`stripOsc`が取り除き方の例

`window.niwaterm`はページの読み込みが終わってから注入されるため、HTML側のスクリプトがすぐ呼ぶと間に合わないことがある。`niwaterm:ready`イベントで待つ。

```js
function whenReady() {
  if (window.niwaterm) return Promise.resolve();
  return new Promise((resolve) => {
    window.addEventListener("niwaterm:ready", resolve, { once: true });
  });
}
```

呼べる名前は`window.niwaterm.handlers`にも入っているので、HTML側で機能の有無を見分けられる。
設定のホットリロードで`handlers`だけを変えた場合、HTMLは読み込み直さずこの配列だけが差し替わる。

`window.niwaterm.theme`には`appearance`の背景色・文字色・背景画像（`background`・`foreground`・`backgroundImage`）が入っている。
これをCSS変数へ流し込むと、ターミナルと同じ地の上にUIを載せられる。配色が変わったときは`niwaterm:theme`イベントが飛ぶので、そこで当て直す。

HTMLは必ず自分で地を塗ること。**webviewの背後は透けない**（`docs/known-issues/electrobun-webview-background-cannot-be-transparent.md`）ので、
地を指定しないとそこだけ白く浮く。ホバー・枠線のような中間色は、地と混ぜず文字色からの透明度だけで作ると背景のグラデーションを潰さない。

```js
function applyTheme() {
  const theme = window.niwaterm && window.niwaterm.theme;
  if (!theme) return;
  const root = document.documentElement.style;
  root.setProperty("--bg", theme.background);
  root.setProperty("--bg-image", theme.backgroundImage);
  root.setProperty("--fg", theme.foreground);
}
window.addEventListener("niwaterm:theme", applyTheme);
```

`url`でリモートのページを指している場合も同じように呼べる。そのページから`handlers`に書いた操作が実行できるということなので、自分で用意したページ以外を指すときは何を渡しているか意識する。

そのまま使える例が`contrib/custom-views/`にある（gitワークツリーの一覧・絞り込み・作成）。

## シェル設定

`shell`は新規タブ作成時に使うデフォルトシェル・追加のシェルプロファイルを指定するオブジェクト。**未指定なら機能オフ**で、OS標準シェル（macOS/Linux: `/bin/zsh -il`、Windows: `powershell.exe -NoLogo`）が使われる。

| フィールド | 型 | 意味 |
|---|---|---|
| `default` | `string` | 新規タブ作成時に使うシェルの実行コマンド（PATHから解決される） |
| `profiles` | `ShellProfile[]` | 追加のシェルプロファイル一覧（後述） |

```ts
shell: {
  default: "/bin/bash",
  profiles: [{ id: "ssh-dev", name: "dev server", command: "ssh dev" }],
},
```

`default`に不正な値（空文字列等）を指定した場合、警告付きでOS標準シェルにフォールバックする。設定はホットリロード対象で、保存後に新規作成されるタブから反映される（既存タブのシェルは変わらない）。

シェルの実行コマンド（`default`・`profiles[].command`共通）はスペース区切りで単純分割される（クォート・エスケープ非対応）。`"wsl.exe -d Ubuntu"`のように引数を含められるが、スペースを含むパス・引数は指定できない。

### シェルプロファイル（`shell.profiles`）

Windows TerminalやWeztermのように、新規タブ作成時に起動するシェルを「+」ボタン横の「⌄」ドロップダウンから選べる。各プロファイルは以下の3フィールドを持つ。

| フィールド | 型 | 意味 |
|---|---|---|
| `id` | `string` | 一意識別子。英数字・`_`・`-`・`.`のみ、1〜64文字。CLIの`niwaterm tab new --shell <id>`やRPCでの指定に使う |
| `name` | `string` | ドロップダウン・`niwaterm shell-profiles`に表示する名前 |
| `command` | `string` | 実行コマンド（PATHから解決される。スペース区切りで単純分割） |

Windows環境では起動時に`wsl.exe --list --quiet`相当でインストール済みのWSLディストロを自動検出し、`id: "wsl-<ディストロ名>"`のプロファイルとして追加する（PowerShellは`id: "powershell"`の固定プロファイルとして常に追加される）。macOS/Linuxでは自動検出は行われず、`shell.profiles`で指定した分のみが有効。

`shell.profiles`と自動検出プロファイルは`id`単位でマージされ、**同じidの場合は`shell.profiles`側が優先**される（自動検出結果の名前・コマンドを上書きしたい場合に使える）。不正なプロファイル（`id`/`name`/`command`のいずれかが欠けている、`id`が形式不正）は警告付きでスキップされる。

コマンドパレット（既定 prefix + `:`）にもプロファイルごとに`New Tab: <name>`という項目が並ぶため、ドロップダウンを開かずキーボードだけでも同じ操作ができる。

利用可能なプロファイル一覧はCLIの`niwaterm shell-profiles`で確認できる（詳細: `docs/guide/cli.md`）。

## ワークスペース設定

`workspace`は、新規ワークスペース作成時（アプリ起動時の最初のワークスペース・`niwaterm workspace new`）の最初のタブに使うデフォルトcwdを指定するオブジェクト。**未指定ならOS標準のホームディレクトリ**が使われる（niwaterm自体をWSL/Linux環境で動かしている場合は、そのホームディレクトリが自然にデフォルトになる）。

| フィールド | 型 | 意味 |
|---|---|---|
| `defaultCwd` | `string` | 新規ワークスペース作成時、最初のタブに使う作業ディレクトリ（絶対パス） |

```ts
workspace: {
  defaultCwd: "/home/eetann/projects",
},
```

不正な値（空文字列等）を指定した場合、警告付きでOS標準のホームディレクトリにフォールバックする。この設定が影響するのは新規ワークスペース作成時のみで、既存タイルからの新規タブ作成・タイル分割は引き続き分割元/対象タイルの実際のcwd（OSC7シェル統合で追跡した値）を継承する。

## Board設定

`board`は、新しいタブを開くときのcwdの決め方を指定するオブジェクト。

| フィールド | 型 | 意味 |
|---|---|---|
| `newTabCwd` | `"inherit"` \| `"worktree"` | 新しいタブのcwd。`"inherit"`（既定）は今のタブのcwdを引き継ぐ、`"worktree"`はそのBoardに紐づくワークツリーを使う |

```ts
board: {
  newTabCwd: "worktree",
},
```

`"worktree"`が効くのはタブ追加・タイル分割・ポップアップの3つ。CLI・設定APIで`cwd`を明示した場合はそちらが優先される。Boardにワークツリーが紐づいていない場合と、紐づけ先のディレクトリが存在しない場合は`"inherit"`と同じ挙動になる（存在しないcwdではPTYの起動自体が失敗するため）。紐づけの付け方は`docs/guide/worktree.md`「Boardに紐づくワークツリー」節を参照。

## レイアウト

`layouts`は、あらかじめ定義したタイル構成をCLI（`niwaterm layout apply <name>`）から名前指定して適用できるようにするプリセット集（[vde-layout](https://github.com/yuki-yano/vde-layout)ライク）。**未指定なら機能オフ**で、`niwaterm layout list`は空一覧を返す。

ここで定義するのは全プロジェクト共通のプリセット。リポジトリ固有のレイアウトは`<projectRoot>/.niwaterm/config.ts`にも置ける（同名ならそちらが優先される。書き方・解決順・trustの扱いは`docs/guide/cli.md`「プロジェクトローカルのレイアウト」節）。プリセットの中身（下の表とタイル構成）はどちらでも同じ。

| フィールド | 型 | 意味 |
|---|---|---|
| `description` | `string` | `niwaterm layout list`に表示する説明文（省略可） |
| `layout` | `LayoutNodeConfig` | タイル構成（後述） |

```ts
layouts: {
  dev: {
    description: "Editor + server + logs",
    layout: {
      kind: "split",
      orientation: "horizontal",
      ratio: 0.7,
      first: { kind: "tile", tabs: [{ name: "editor", command: "nvim", focus: true }] },
      second: {
        kind: "split",
        orientation: "vertical",
        first: { kind: "tile", tabs: [{ name: "server", command: "npm run dev", cwd: "~/proj" }] },
        second: { kind: "tile", tabs: [{ name: "logs", command: "tail -f logs/app.log" }] },
      },
    },
  },
},
```

`LayoutNodeConfig`は`kind`で2種類に分かれる。

- `{ kind: "split", orientation: "horizontal" | "vertical", ratio?: number, first: LayoutNodeConfig, second: LayoutNodeConfig }` — タイルを2分割する。既存のタイル分割（`niwaterm tile split`）と同じく`horizontal`は上下、`vertical`は左右に並べる。`ratio`は`first`が占める比率(0〜1、省略時0.5)。**N分割の配列指定は無く、3分割以上はネストで表現する**（上の例の`second`側を参照）
- `{ kind: "tile", tabs: LayoutTabConfig[], activeTab?: number }` — タイル1枚とその中のタブ一覧。`tabs`は最低1つ必要。`activeTab`はアクティブにするタブのindex（省略時は最後のタブ）

各タブ（`LayoutTabConfig`）のフィールドはすべて省略可。

| フィールド | 型 | 意味 |
|---|---|---|
| `name` | `string` | タブ名（サイドバー・タブバー表示用） |
| `shellProfile` | `string` | 使用するシェルプロファイルのid（`niwaterm shell-profiles`で確認）。省略時はデフォルトシェル |
| `cwd` | `string` | 作業ディレクトリ。省略時は`niwaterm layout apply`を実行したディレクトリ（`--cwd`で上書き可） |
| `command` | `string` | タブ作成後に流し込むコマンド（`tab send-keys`相当、末尾にEnterを自動送信する） |
| `delay` | `number` | `command`を送信するまでの追加の待ち時間(ms)。省略時は0。シェルが入力を受け付けられるようになるまでの待ちはniwaterm側が自動で行う（下記）ため、通常は指定不要 |
| `vars` | `Record<string, string>` | タブ変数（`tab var set`相当で注入） |
| `focus` | `boolean` | このタブに最終フォーカスを当てる。プリセット全体で1つまで指定できる |

`command`はPTY（シェル）が入力を受け付けられるようになってから送られる。分割で作ったタイルのタブはPTYの起動自体がwebview側の実測サイズ到達まで保留されるうえ、起動直後のシェルは初期化中に流し込まれた入力を取りこぼす（コマンドの先頭が欠けて途中から実行される）ため、niwatermは「PTYが最初の出力を返し、そこから出力が止まった＝プロンプトを出し終えた」時点まで送信を遅らせる。それでも足りない場合（プロンプト表示後も初期化が続くシェル等）は`delay`で追加の待ちを指定する。

`command`はそのタブ自身にしか作用せず、vde-layoutの`{{pane_id:name}}`のような「同じプリセット内の別タブを参照するテンプレート構文」は無い（タブIDは適用のたびに再採番されるため、プリセット定義時点では固定できない）。同じプリセット内の別タブ（例: `role`変数で`claude`と印を付けたタブ）へ向けてコマンドを送りたい場合は、`command`の中で`niwaterm tab var find`（`docs/guide/cli.md`「タブ変数」節参照）を使い、実行時に対象タブのtabIdを検索する。`tab var find`は既定で「自分自身が属するBoard」の中だけを検索する。`layout apply`の適用先がBoard単位（ADR 0006）なので、同じプリセットを何度適用しても、同じrole名を持つ別Boardのタブと混線しない。

```ts
layout: {
  kind: "split",
  orientation: "vertical",
  first: {
    kind: "tile",
    tabs: [{ name: "claude", command: "claude", vars: { role: "claude" } }],
  },
  second: {
    kind: "tile",
    tabs: [
      {
        name: "editprompt",
        vars: { role: "editprompt" },
        command:
          'editprompt="editprompt open --editor nvim --always-copy"; ' +
          'target=$(niwaterm tab var find role claude | head -n1); ' +
          '[ -n "$target" ] && $editprompt --target-pane "$target" || $editprompt',
        focus: true,
      },
    ],
  },
},
```

`claude`タブの`vars`は作成直後（`command`送信より前）に反映されるため、ツリー内で先に定義した兄弟タイルのタブは、後から作成されるタブの`command`から`tab var find`で確実に見つけられる。

適用はCLIから行う。

```sh
niwaterm layout list
niwaterm layout apply dev
niwaterm layout apply dev --replace
niwaterm layout apply dev --startup
```

`niwaterm layout apply <name>`は既定で新規Boardとして適用する（適用先はBoard単位、ADR 0006）。`--replace`を指定すると既存Boardを単一タイルへ畳んでから適用し直す（**既存タブ・PTYは無条件でcloseされる**ため、実行前にy/n確認プロンプトが表示される。確認なしで実行したい場合は`--replace-force`を使う）。`shellProfile`が未知のid・`focus:true`が2つ以上、といった不正なプリセットはBoardに一切手を触れずエラーになる。詳細・エラー時の挙動は`docs/guide/cli.md`参照。

`--startup`を付けると、そのBoardは次回以降の**起動時にもこのプリセットで組み直される**。niwatermは通常、終了時のレイアウト骨格（タイル構成・タブ名・シェル・cwd・タブ変数）を保存して復元するが、`command`は再実行しない。起動時レイアウトにしたBoardは骨格の復元ではなくプリセットの再適用になるため、`command`ごと毎回同じ状態で立ち上がる。Boardごとに別のプリセットを紐づけられるので、「開発用Boardは`dev`、メモ用Boardは`notes`」のような使い分けができる。後から切り替える・解除するには`niwaterm board startup layout|restore|clear`を使う（`docs/guide/cli.md`「起動時レイアウト」節）。起動時にタブが開くディレクトリは`--startup`を付けて実行したディレクトリが記録されて使われる（プロジェクトローカルのプリセットならその解決元）。

## ワークツリー

`worktree`は、`niwaterm worktree`系コマンドの挙動を指定するオブジェクト。コマンド側の挙動を含めた全体像は`docs/guide/worktree.md`を参照。

| フィールド | 型 | 意味 | 未指定時 |
|---|---|---|---|
| `dir` | `string` | 新規ワークツリーの置き場所テンプレート | `../${repo}@${branch}` |
| `open` | `"board"` \| `"board-switch"` \| `"current-tab"` \| `"none"` | `worktree new`の`--open`の既定値 | `"board"` |
| `layout` | `string` | Boardへ適用するレイアウトプリセット名（`--layout`の既定値） | なし（適用しない） |
| `onCreate` | `(ctx) => void \| Promise<void>` | ワークツリーを新規作成した直後に走るフック | なし |

```ts
worktree: {
  dir: ".worktrees/${branch}",
  open: "board-switch",
  layout: "dev",
  onCreate: async (ctx) => {
    await Bun.$`bun install`.cwd(ctx.worktreePath);
  },
},
```

`open`は作成したワークツリーをniwatermのどこで開くか。`board`は新規Boardとして開くが遷移せず、`board-switch`は遷移まで行う。`current-tab`はコマンドを実行したタブをそのワークツリーへ`cd`し、`none`は開かない。既定を`board`にしているのは、作業中のBoardを奪わずに次のブランチを仕込めるようにするため。

テンプレートでは`${repo}`（メインワークツリーのディレクトリ名）と`${branch}`（ブランチ名）が展開される。ブランチ名の`/`は`-`へ潰されるため、`feat/worktree`は意図しない階層にならず`niwaterm@feat-worktree`のような単一のディレクトリ名になる。値は`~/`始まり・絶対パス・メインワークツリー基準の相対パスのいずれでも書ける。

`layout`は`layouts`のキー（「レイアウト」節参照）。Boardを**新規に作ったときだけ**適用され、既にそのワークツリーのBoardが開いていれば既存のタブは壊さない。プリセットはメインワークツリーの`.niwaterm/`から引き、タブはそのワークツリーで開く。詳細は`docs/guide/worktree.md`「レイアウトプリセットの適用」節。

`onCreate`は`repoRoot`・`worktreePath`・`branch`を受け取り、niwaterm CLIのプロセスでBoardを開く前にawaitされる。失敗するとワークツリーを残したままコマンドが終了コード1で止まり、Boardは開かない。既存のワークツリーを開き直した場合は走らない。詳細は`docs/guide/worktree.md`「作成後フック」節。

ここで定義するのは全リポジトリ共通の方針。リポジトリ固有の方針は`<repoRoot>/.niwaterm/config.ts`にも書け、**項目ごとに**そちらが優先される（`dir`はグローバル、`layout`はリポジトリ固有、という混ぜ方ができる）。ただし`onCreate`だけは上書きではなく、グローバル→プロジェクトの順に**両方**走る（値と違ってフックは行動なので、片方を捨てるのが不自然なため）。

プロジェクトローカル設定はリポジトリにコミットされることを想定しているため、**承認したリポジトリでしか読まれない**（`worktree new`の初回に確認が出る）。レイアウトプリセットの適用も同じ承認で門番する（プリセットの解決でそのリポジトリの設定が評価されるため）。詳細は`docs/guide/worktree.md`「プロジェクトローカル設定の承認」節。

```ts
// <repoRoot>/.niwaterm/config.ts
import type { NiwatermProjectConfig } from "@niwaterm/config";

export default {
  worktree: { dir: ".worktrees/${branch}" },
} satisfies NiwatermProjectConfig;
```

どちらにも書かれていない項目はgit configの`niwaterm.worktree.*`も見に行く（`git config niwaterm.worktree.dir '.worktrees/${branch}'`）。niwatermを入れていない環境とも設定を共有したい場合の補助口で、優先順位はniwatermの設定より下。解決順の全体像は`docs/guide/worktree.md`「ワークツリーの置き場所」節を参照。

レイアウトプリセットと違い、プロジェクトローカル設定はcwdから上向きに探さずメインワークツリー直下だけを見る。置き場所・開き方はリポジトリ全体の方針であって、ワークツリーごとに変わるものではないため。

## ホットリロード

`~/.config/niwaterm/niwaterm.config.ts`を保存すると、アプリを再起動せずに変更が反映される（キーバインド・外観・customViewいずれも）。`~/.config/niwaterm/`ディレクトリをサブディレクトリ含めて監視しており、エディタのatomic save（一時ファイル書き込み→rename）方式でも検知できる。保存直後の複数回のファイルイベントは短時間でまとめられる（デバウンス）。

設定を複数ファイルへ分割している場合（「複数ファイルへの分割」節参照）、エントリファイル以外の`.ts`/`.js`等の変更もホットリロード対象になる。読み込みのたびに`~/.config/niwaterm/`配下のソースファイルを一時ディレクトリへコピーしてからimportし直すことで、importツリー全体を最新の内容に差し替えている（`node_modules`は巨大になりうるためコピーせずシンボリックリンクで参照する）。

構文エラーのある内容を保存した場合は、コンソールに警告ログが出た上でデフォルト設定（キーバインド・外観とも）にフォールバックする。「直前の有効な設定を保持する」のではなく、初回読み込み時と同様に毎回デフォルトから解決し直す設計のため、エラーを直して再保存すれば元通り反映される。

`~/.config/niwaterm/`ディレクトリ自体が存在しない場合（未セットアップ）は監視そのものがスキップされ、コンソールにログが出るだけでアプリは通常通り起動する。

ファイル監視による自動リロードのほか、`reload-config`アクション（コマンドパレット、または`niwa.keybind`で割り当てたキー）から同じ処理を手動で呼び出すこともできる。挙動は保存時の自動リロードと同一（毎回デフォルトから解決し直すため、`niwa.keybind`/`niwa.unbind`で加えた変更をconfigファイルから削除して再読み込みすれば、その分は未設定またはデフォルトの割り当てに戻る）。

## 現在の設定値を確認する

マージ後の実際に効いている値は、アプリ内のモーダル（prefix + `i`の`show-config`アクション、またはコマンドパレットの「Show Settings」）か、CLIの`niwaterm config show`で確認できる。設定ファイルに書いていない項目も既定値として出るため、「書いたつもりが反映されていない」の切り分けに使える。

キーバインドの個々の割り当てはここには出ない（件数のみ）。一覧は`niwaterm keybind list`で確認する。関数で書く設定（`mouse.selectionMenu`・`worktree.onCreate`・`niwa.on`のハンドラ）も値として表示できないため含まない。

## 既知の制約

- **`ctrl`修飾子は未対応**。既存機能がcmd/shift/altしか使っていないため、今回の型・パーサでは対象外（将来Ctrl系のキーバインドが必要になったら拡張する）
- **macOSのOption+英数字キーは英数字・数字キーのみ対応している**。Optionを押しながら文字キーを押すと`e.key`がUnicode記号やデッドキーに変わる（`Option+P`→`π`、`Option+N`→`˜`）が、`alt+n`のような英数字（`a`〜`z`）・数字（`0`〜`9`）のバインドは物理キー位置(`e.code`)から復元しているため`noPrefix`/`direct`でもそのまま動く。一方、記号キー（`alt+;`等）はレイアウトでキー位置がずれるため復元対象外で、macOSでは意図通りマッチしない可能性がある。詳細: `docs/known-issues/macos-option-key-breaks-alt-keybindings.md`
