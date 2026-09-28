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

### 設定ディレクトリを変える（`NIWATERM_CONFIG_DIR`）

環境変数`NIWATERM_CONFIG_DIR`に絶対パスを設定して起動すると、`~/.config/niwaterm/`の代わりにそのディレクトリを設定ディレクトリとして読む。niwatermを複数のビルドで使い分けていて、片方だけ別の設定で動かしたいとき（開発中のビルドで設定まわりを試しても普段遣いの設定を壊さないようにする等）に使う。未設定なら従来どおり`~/.config/niwaterm/`を読む。

切り替わるのはディレクトリ単位で、設定ファイル1つだけを差し替えることはできない。`customViews`の`path`のような相対パスの基準も、ホットリロードの監視対象もそのディレクトリへ移るため、`niwaterm.config.ts`だけでなく`package.json`・`node_modules/`（`@niwaterm/config`の解決に必要）まで一式が要る。雛形は`NIWATERM_CONFIG_DIR=<パス> niwaterm init`で作れる。

この変数はniwatermが開いたタブのシェルへは引き継がれない。タブの中から別のniwatermを起動したときに、起動元インスタンスの設定ディレクトリを巻き込まないようにするため。

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
| `niwa.notify(opts)` | OSのデスクトップ通知を出す。`opts: { title, body?, subtitle?, silent?, tabId? }`（`title`のみ必須）。macOSでは`tabId`を渡すと、通知のクリックでそのタブへ遷移する（Windowsはクリックしても遷移しない） |
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
| `niwa.tab.show(tabId)` | 指定タブへフォーカスを移す。所属ワークスペースへの切替・タイルフォーカス・タブのアクティブ化をまとめて行う（tmuxの`select-pane`、CLIの`niwaterm tab focus`相当）。対象タブが存在しない場合は`false` |
| `niwa.tab.var.get(tabId, key)` / `niwa.tab.var.set(tabId, key, value)` | タブ変数の読み書き（`niwaterm tab var get/set`相当） |
| `niwa.tab.var.find(key, value)` | 全ワークスペース・タイル・タブを横断して、`key`の値が`value`と一致するタブの`tabId`配列を返す（tmuxの`list-panes -F "#{pane_id} #{@role}"` + `awk`相当） |
| `niwa.popup.open(opts?)` | ポップアップを開く。`opts: { cwd?, command?, width?, height? }` |
| `niwa.popup.run(command, opts?)` | ポップアップで`command`を実行し、閉じるまで待って標準出力を返す（CLIの`popup open --capture-stdout`相当）。`opts: { cwd?, width?, height? }`。fzf等の対話UIはポップアップ内に表示したまま、選択結果だけをハンドラ側で受け取れる。既にポップアップが開いている場合は`null`、コマンドが何も出力しなかった場合は空文字列 |
| `niwa.board.create(cwd?)` | アクティブなワークスペースに新規Boardを作成してアクティブにし、そのidを返す（tmuxの`new-window`相当。BoardはADR 0006の「1ワークスペース内の複数タイルレイアウト」でtmuxのWindowに対応する）。`cwd`は最初のタブの作業ディレクトリで、省略時はOS標準（`tab.create`等と違いフォーカス中タブのcwdは引き継がない） |
| `niwa.board.move(boardId, index)` | Boardを所属ワークスペース内の表示順（サイドバーの並び）の`index`番目（0始まり）へ移動する。範囲外のindexは先頭・末尾へクランプする。中身とアクティブなBoardは変更しない。別のワークスペースへ移すのは`niwa.board.moveToWorkspace`（CLIの`niwaterm board move --up/--down`、サイドバーのドラッグ&ドロップと同じ並び替え） |
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
niwa.keybind("t", async () => {
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
| `c` | new-board |
| `t` | new-tab |
| `shift+t` | new-browser-tab |
| `u` | focus-url-bar |
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
| `shift+up` / `shift+down` | jump-prompt-up / jump-prompt-down |

**KeybindAction の一覧**（62種類。関数ベースAPIでは`niwa.keybind(key, "アクション名")`のように文字列そのまま渡せる）:

| アクション | 意味 |
|---|---|
| `split-vertical` / `split-horizontal` | タイルを垂直/水平分割 |
| `close-tile` | フォーカス中のタブ/タイルを閉じる |
| `focus-up` / `focus-down` / `focus-left` / `focus-right` | 隣接タイルへフォーカス移動 |
| `resize-up` / `resize-down` / `resize-left` / `resize-right` | フォーカス中タイルを既定の1ステップ分拡大（`niwa.tile.resize`相当）。既定キーは無いため使うには自分で割り当てる必要がある。`repeat: true`と組み合わせるとtmuxの`-r`風に連打できる（上記「repeatによる連打」参照） |
| `toggle-zoom` | フォーカス中タイルの一時的なズーム表示を切り替える（`niwa.tile.zoom()`相当。tmuxの`resize-pane -Z`相当。他のタイルを隠し画面全体に表示、再実行で解除。タブを右クリックして「ズーム表示」／「ズームを解除」を選んでも同じことができる） |
| `new-tab` | 新規タブ作成（既定は prefix + `t`。ブラウザタブの`shift+t`と対になる） |
| `new-browser-tab` | 新規ブラウザタブ作成（既定は prefix + `shift+t`。表示URLは`browser.defaultUrl`を参照）。開いた直後はURL欄にフォーカスが入り全選択されるので、URLを打ってEnterするだけで遷移できる（Escapeで元のURLへ戻す） |
| `new-custom-view-tab` | `customViews`の先頭のビューを開くタブを作成（`customViews`未設定時は何もしない。既定キーは無いため使うには自分で割り当てる必要がある。ビューを選んで開くにはCLIの`niwaterm tab new --custom-view --view <id>`を使う） |
| `focus-url-bar` | 表示中のブラウザタブのURL欄へフォーカスし、全選択して打ち替えられる状態にする（既定は prefix + `u`。ブラウザのCmd+L相当だが、`l`をhjklのタイル移動に充てる設定と衝突しないようURLの頭文字にしている。Enterで遷移、Escapeで元のURLへ戻してターミナルへフォーカスを返す。ターミナルタブでは何もしない） |
| `next-tab` / `prev-tab` | タブ切替 |
| `rename-tab` | フォーカス中タブの名前を入力ダイアログで変更する（既定は prefix + `r`。Enterで確定、Escapeでキャンセル。空のまま確定すると既定の連番ラベルへ戻る。タブバーのタブを右クリックして「名前を変更」を選んでも同じことができる） |
| `restart-tab` | フォーカス中タブのプロセスを強制終了し、同じ`tabId`のまま再起動する（`niwa.tab.respawn`相当。tmuxの`respawn-pane -k`相当だが既定バインドは無く、実行前にy/nの確認ダイアログを挟む。使うには自分で割り当てる必要がある） |
| `new-board` | アクティブなワークスペースにBoardを追加する（既定は prefix + `c`。tmuxの`new-window`相当で、キーも`bind-key c`を踏襲する。CLIの`niwaterm board new`と同じ）。サイドバーのワークスペース見出しを右クリックしても同じことができる |
| `close-board` | アクティブなBoardを中のタブごと削除する（CLIの`niwaterm board close`と同じ。実行前にy/nの確認ダイアログを挟む。ワークスペースが1つだけのときの最後の1つは閉じられない。サイドバーのBoard行を右クリックしても同じことができる）。既定キーは無いため使うには自分で割り当てる必要がある |
| `next-board` / `prev-board` | 同じワークスペース内のBoard切替（tmuxの`next-window` / `previous-window`相当）。既定キーは無いため使うには自分で割り当てる必要がある |
| `rename-board` | アクティブなBoardの名前を入力ダイアログで変更する（tmuxの`rename-window`相当。既定は prefix + `,`。Enterで確定、Escapeでキャンセル。空のまま確定すると自動で付く名前（下記「Board設定」の`board.naming`）へ戻る。サイドバーのBoard行をダブルクリック・右クリックしても同じことができる） |
| `set-board-worktree` | アクティブなBoardに紐づくワークツリーを入力ダイアログで設定する（CLIの`niwaterm board worktree set`と同じ。入力欄にはそのBoardのカレントディレクトリが入った状態で開き、空のまま確定すると紐づけを解除する。サイドバーのBoard行を右クリックしても同じことができる）。既定キーは無いため使うには自分で割り当てる必要がある |
| `set-board-phase` | アクティブなBoardの作業フェーズを、候補（下記「Board設定」の`board.phases`）から選ぶピッカーを開く。色付きの候補が並び、今のフェーズにはチェックが付く。↑↓のほかTab / Shift+Tabでも候補を移動でき、Enterで確定、Escapeでキャンセル。フェーズが付いているBoardでは末尾に「フェーズを解除」も並ぶ。既定キーは無いため使うには自分で割り当てる必要がある |
| `set-board-phase:<id>` | アクティブなBoardに作業フェーズを直接設定する（`<id>`は下記「Board設定」の`board.phases`のid）。ピッカーを挟まず1打で切り替えたいとき向けで、設定側にしか書けないアクションなので既定キーは無い |

| `clear-board-phase` | アクティブなBoardの作業フェーズを解除する（既定キーは無いため使うには自分で割り当てる必要がある） |
| `clear-board-startup` | アクティブなBoardの起動時レイアウトの紐づけを解除する（CLIの`niwaterm board startup clear`と同じ。今のレイアウトはそのまま残り、次回起動時は保存した骨格を復元する既定の挙動に戻る。サイドバーのBoard行を右クリック →「起動時レイアウト」からも同じことができる）。既定キーは無いため使うには自分で割り当てる必要がある |
| `new-workspace` | 新規ワークスペース作成 |
| `rename-workspace` | アクティブなワークスペースの名前を入力ダイアログで変更する（`rename-board`と同じ操作感で、空のまま確定すると既定の連番ラベルへ戻る。サイドバーの見出しをダブルクリック・右クリックしても同じことができる）。既定キーは無いため使うには自分で割り当てる必要がある |
| `close-workspace` | アクティブなワークスペースを中のBoardごと削除する（CLIの`niwaterm workspace close`と同じ。実行前にy/nの確認ダイアログを挟む。最後の1つは閉じられない。サイドバーの見出しを右クリックしても同じことができる）。既定キーは無いため使うには自分で割り当てる必要がある |
| `new-window` | 新しいOSウィンドウを開く（既定は prefix + `shift+w`。CLIの`niwaterm window new`と同じ。前回の状態は復元されず、閉じても何も残らない一時ウィンドウになる。詳細は[CLIガイド](/guide/cli.md)の「ウィンドウ」節） |
| `close-window` | このniwatermのOSウィンドウを閉じる（CLIの`niwaterm window close`と同じ。中のPTYはすべて終了するため実行前にy/nの確認ダイアログを挟む。最後の1枚を閉じるとniwaterm自体が終了する）。既定キーは無いため使うには自分で割り当てる必要がある |
| `next-workspace` / `prev-workspace` | ワークスペース切替 |
| `move-board-up` / `move-board-down` | アクティブなBoardの表示順をワークスペース内で1つ上/下へ移動する（サイドバーのドラッグ&ドロップ、CLIの`niwaterm board move --up/--down`と同じ並び替え）。端では何もしない。既定キーは無いため使うには自分で割り当てる必要がある |
| `move-board-to-workspace` | アクティブなBoardを別のワークスペースへ移す（tmuxの`move-window`相当。CLIの`niwaterm board move --to-workspace`と同じ）。移動先はピッカーで選ぶ（Escapeでキャンセル）。移すとワークスペースが空になる場合は確認ダイアログを挟む。既定キーは無いため使うには自分で割り当てる必要がある |
| `move-workspace-up` / `move-workspace-down` | アクティブなワークスペースの表示順を1つ上/下へ移動する（サイドバーのドラッグ&ドロップ、CLIの`niwaterm workspace move`と同じ並び替え）。端では何もしない。既定キーは無いため使うには自分で割り当てる必要がある |
| `toggle-sidebar` | サイドバーの表示/非表示切替 |
| `next-sidebar-view` / `prev-sidebar-view` | サイドバーに出すビュー（ワークスペース一覧と各`customViews`パネル）を循環で切り替える（既定はnext側のみ prefix + `shift+b`。ビューが2つの間はnextだけで往復できるため、prevを使うには自分で割り当てる必要がある。`customViews`未設定時はビューが1つしかないので何もしない。サイドバーを閉じている場合は開いた上で切り替える） |
| `show-sidebar-view:<id>` | サイドバーに出すビューをidで直接指定する（`<id>`は`customViews`のidか、ワークスペース一覧の`workspaces`。ビューが増えたときに循環で辿らず1打で届かせるためのもの。既定キーは無いため使うには自分で割り当てる必要がある。サイドバーを閉じている場合は開いた上で切り替える） |
| `toggle-popup` | ポップアップの表示/非表示切替 |
| `promote-popup` | 開いているポップアップの中身を、フォーカス中タイルへ通常タブとして編入する（CLIの`niwaterm popup promote`と同じでPTYは維持される。ポップアップのツールバーの↑ボタンでも同じことができる）。既定キーは無いため使うには自分で割り当てる必要がある |
| `jump-hint` | ジャンプ先へラベルを出し、打ったラベルの場所へ飛ぶ（既定は prefix + `f`。vimiumの`f`相当。操作は下記「ジャンプヒント」参照） |
| `copy-selection` | 選択範囲をクリップボードへコピー（既定は`direct`にWindowsのみ`ctrl+shift+c`が割り当て済み。macOSはApplicationMenu経由でCmd+Cが既に機能する） |
| `copy-mode` | vi風コピーモードに入る（既定は prefix + `v`。キーボードだけでスクロールバックを移動・選択・コピーできる。操作キーは下記「コピーモード」参照） |
| `paste-clipboard` | クリップボードの内容をペースト（既定は`direct`にWindowsのみ`ctrl+shift+v`が割り当て済み。macOSはApplicationMenu経由でCmd+Vが既に機能する） |
| `scroll-page-up` / `scroll-page-down` | スクロールバックを1ページ分スクロール |
| `scroll-to-top` / `scroll-to-bottom` | スクロールバックの先頭/最新行へジャンプ |
| `jump-prompt-up` / `jump-prompt-down` | 1つ前/次のシェルプロンプトへジャンプする（既定は prefix + `shift+up` / `shift+down`。見つけたプロンプト行が画面の一番上に来るようスクロールするので、そのコマンドの出力を頭から読める。下記「プロンプトジャンプ」参照） |
| `command-palette` | コマンドパレットを開く（既定は prefix + `:`。この表のアクションに加えて、シェルプロファイルごとの`New Tab: <名前>`と、名前で選んで飛べる`Switch to Board: <名前>`・`Switch to Workspace: <名前>`も並ぶ。後者はワークスペースをまたいで全Boardが並ぶため、サイドバーを閉じていても目的のBoardへ届く） |
| `increase-font-size` / `decrease-font-size` / `reset-font-size` | フォントサイズの拡大/縮小/リセット |
| `reload-config` | 設定ファイルを手動で再読み込みする（ファイル保存時の自動リロードと同じ処理。既定キーは無いため使うには自分で割り当てる必要がある） |
| `show-config` | 現在有効な設定値の一覧をモーダルで表示する（既定は prefix + `i`。CLIの`niwaterm config show`と同じ内容。Escapeで閉じる） |
| `quit-app` | niwaterm自体を終了する（すべてのウィンドウが閉じ、中のPTYはすべて終了する。レイアウトはOSのCmd+Q・×ボタンで閉じたときと同じように保存され、次回起動時に復元される）。取り返しのつかない操作のため実行前にy/nの確認ダイアログを挟み、コマンドパレットでも警告アイコン付き（「アプリ」カテゴリの`Quit niwaterm`）で並ぶ。既定キーは無いため使うには自分で割り当てる必要がある |

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

### プロンプトジャンプ（コマンド単位で遡る）

prefix + `shift+up` / `shift+down`（`jump-prompt-up` / `jump-prompt-down`アクション）で、1つ前・次のシェルプロンプトへ飛ぶ。見つけたプロンプト行が画面の一番上に来るようスクロールするため、そのコマンドの出力を頭から読める。長いビルドログを遡って「どのコマンドの出力だったか」を探すときに、1ページずつスクロールせずに済む。

コピーモード中は同じ操作を `{` / `}` で行う。こちらはビューポートではなくカーソルが動き、飛び先は**コマンドを打った行**（プロンプトブロックの最終行）になる。出力の途中で `{` を押せば、その出力を出したコマンドの上に止まる。

`V`で行選択してから `}` を押すと、コマンド行から次のコマンド行までが選択される。出力だけが欲しいときは最後に `k` で1行戻す。

プロンプトの先頭行とコマンド行を区別しているのは、OSC 133のマークが付くのがプロンプトの**1行目**だから。powerlevel10kのように区切りの空行から始まるプロンプトでは、その1行目は前のコマンドの出力の末尾に見えてしまい、カーソルを置かれても何のコマンドか分からない。逆にビューポートを動かす側はプロンプトの装飾ごと見せたいので、ブロックの1行目を画面の一番上に置く。

カーソルが止まるのはコマンド行の**最初の非空白**（`> ` のようなプロンプト記号があればその上）。記号を飛ばしてコマンド本体の先頭へ寄せるにはシェルがOSC 133のB（入力の開始）を出している必要があり、出していても補完やプロンプトの描き直しで桁がぶれるため、位置を安定させる側を採っている。

**シェル統合（[CLIガイド](/guide/cli.md)の「シェル統合」）の導入が前提**。プロンプトの位置はシェルがOSC 133というエスケープシーケンスで報告するもので、報告が無ければniwatermからはどこがプロンプトか分からない。`contrib/shell-integration/`のスクリプトを入れていればそのまま動く（starship・powerlevel10kのように自前でOSC 133を出すプロンプトを使っている場合は、シェル統合を入れていなくても動くことがある）。マークが1つも無い状態でコピーモードから `{` / `}` を押すと、画面下端にその旨のメッセージが出る。

代替画面を使うTUI（vim・lazygit等）の表示中はプロンプトのマークが無いため、ジャンプしても何も起きない。

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
| `{` / `}` | 1つ前 / 次のシェルプロンプトへジャンプする（下記「プロンプトジャンプ」参照） |
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

不正なバインド文字列（`prefix`/`direct`で未知の修飾子・`cmd`/`ctrl`/`alt`のいずれも含まない、`bindings`で`cmd`/`ctrl`を含む等）や未知のアクション名を指定した場合、そのエントリだけが無視される。無視した内容は`niwaterm config show`・設定モーダルの「無視した設定」に出る（コンソールにも同じ内容が出るので、ターミナルから`mise run start`していればそちらでも見える）。

関数形式（`KeybindingsFn`）の中で例外が出た場合は、そこまでに済んだ`niwa.prefix`/`niwa.keybind`の登録を残したまま以降の行だけが飛ぶ。例外の内容は「無視した設定」に出る。設定ファイル自体を読み込めない場合（構文エラー、存在しないモジュールのimport、`node_modules`未インストール等）の扱いは「ホットリロード」節を参照。

## ベル

ターミナルがBEL文字（`0x07`）を出力すると、そのタブに「ベル」の印が付く。長いビルドの終わり（`make && printf '\a'`）やエージェントの応答待ちを、別のタブ・別のワークスペースを見ている間でも取りこぼさないための仕組み。

既定の挙動は2つ。

- **タブへのマーク**: タブバーとサイドバーのBoard行にベルのアイコンが出る。そのタブが画面に出た時点で自動的に消える（ウィンドウがフォーカスされていない間は、画面に出ていても消えない）
- **デスクトップ通知**: そのタブが今まさに画面に出ている時以外に出す（別Board・別ワークスペース・非アクティブタブ、またはniwatermのウィンドウが後ろにある場合）。目の前に出ているタブならマークだけで気づけるため通知しない。同じタブでベルが続く場合、通知は5秒間隔まで間引く（マークは常に付く）。macOSでは通知をクリックするとベルが鳴ったタブへ遷移する

ただし、そのタブの`agent_status`が`working`の間はマークも通知も出さない。エージェントは手が要らない途中経過でもBELを鳴らすため（Claude Codeは長いコマンドが一定時間を超えると鳴らす）、そのまま扱うと作業中ずっとベルが積もる。手が要る場面では`agent_status`が`blocked`（応答待ち）・`idle`（完了）へ変わり、サイドバーのバッジで分かる。`agent_status`は[エージェント統合](cli.md)のhooksが書き込むタブ変数で、hooksを入れていなければこの間引きは働かない。

### 処理を差し替える（`niwa.on("bell", ...)`）

`keybindings`の関数の中で`niwa.on("bell", handler)`を呼ぶと、**既定の処理の代わりに**そのハンドラが走る。

```ts
import { defineConfig } from "@niwaterm/config";

export default defineConfig({
  keybindings: (niwa) => {
    niwa.on("bell", (event) => {
      // 今見ていないワークスペースで鳴ったベルだけ通知する
      if (event.workspaceId !== niwa.workspace.current()) {
        niwa.notify({ title: "ベル", body: event.tabName ?? event.tabId, tabId: event.tabId });
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
| `agentStatus` | `string \| null` | 鳴った時点のタブ変数`agent_status`（`idle` / `working` / `blocked`）。エージェントが動いていないタブは`null` |

`agentStatus`を見れば、既定の処理と同じ間引きを自前のハンドラでも書ける。逆に作業中のベルも拾いたい場合は、`niwa.bell.default(event)`を呼ばず`niwa.bell.mark(event.tabId)`を直接呼ぶ。

### `niwa.bell`

| メソッド | 意味 |
|---|---|
| `default(event)` | 既定の処理（マーク＋画面に出ていないタブなら通知。`agentStatus`が`working`なら何もしない）を実行する |
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
| `tileBorderRadius` | `number` | タイルの角の丸み（px、既定`6`）。各タイルの枠（フォーカス中・ズーム中の枠を含む）がこの丸みで引かれる。`0`で角張った四角になる。丸みを大きくすると、角に中身が食い込まないようタイル内側の余白も広がる |
| `tileGap` | `number` | タイル同士の間と、タイルと画面の端の間の隙間（px、既定`4`） |
| `inactiveTileDim` | `number` | フォーカスしていないタイルを暗くする度合い（0〜1、既定`0`＝暗くしない） |
| `tileShadow` | `string` | タイルに付ける影。CSSの`box-shadow`値（既定`"none"`＝影なし） |
| `ui` | `UiColorsConfig` | ターミナル本体以外のUI（枠線・バッジ等）の配色。下記「UIの配色（`appearance.ui`）」参照 |

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

### UIの配色（`appearance.ui`）

タイルの枠・境界線・各種バッジといった、ターミナルの文字以外の配色。部品ごとではなく役割ごとに色を持ち、同じ役割の部品は同じ色を共有する。

| フィールド | 既定値 | 使われる場所 |
|---|---|---|
| `border` | `#313244` | サイドバー・タブバー・ブラウザツールバー・ポップアップの境界線、フォーカスしていないタイルの枠 |
| `accent` | `#89b4fa` | フォーカス中タイルの枠、タブD&Dのドロップ先、コピーモードの選択範囲、コピーモードのバッジ・検索プロンプト |
| `warning` | `#f9e2af` | ズーム中タイルの枠、検索の一致箇所、コピーモードのカーソル、スクロールバックのバッジ、ジャンプヒントのラベル |
| `success` | `#a6e3a1` | コピー完了のバッジ |
| `danger` | `#f38ba8` | 検索失敗などのエラーメッセージ |
| `badgeForeground` | `#1e1e2e` | 上記4色を地に敷くバッジ・メッセージの文字色 |
| `scrollbar` | `#45475a` | スクロールバーのつまみ |

```ts
appearance: {
  ...defaultAppearance,
  ui: {
    // 書いたフィールドだけ上書きされる（...defaultAppearance.ui は不要）
    accent: "#7aa2f7",
    border: "#2a2a2a",
  },
},
```

サイドバー・ダイアログ・コマンドパレットの地と文字色はここには無く、`foreground`・`background`から派生する（中間色は両者を混ぜて作る）。テーマ全体の明暗を変えるときはまずその2つを変え、`ui`は差し色の調整に使う。

- 値はCSSのカラー値ならなんでもよい（`#rgb`・`rgb()`・`hsl()`・色名など）。不正な値はそのフィールドだけ警告付きで既定値に戻る
- `background`が明るい色のときは、フォームコントロールとスクロールバーのOS既定配色もライト側へ自動で切り替わる
- 既定値は暗い地の上に載せる前提の明度なので、明るいテーマにするときは`accent`・`warning`も暗めの色へ振り直す（とくに`warning`はタイルの枠線に使うため、明るい地の上ではほとんど見えない）
- 半透明の陰影（タブバー・ポップアップの覆い）と影は`background`へ黒を重ねて作っているため、`ui`の対象外

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

### タイルの見た目

各タイルは角丸の枠で囲まれ、隙間を挟んで並ぶ。既定では影を付けず、フォーカスしていないタイルも暗くしない。
隙間を広げて影を付け、フォーカスしていないタイルを暗くすると、タイルがカードのように並んだ見た目になる。

```ts
appearance: {
  ...defaultAppearance,
  tileGap: 6,
  tileShadow: "0 1px 4px rgba(0, 0, 0, 0.4)",
  inactiveTileDim: 0.2,
  // 角張った枠にするなら0
  // tileBorderRadius: 0,
},
```

- 枠の色は、フォーカスしていないタイルが`ui.border`、フォーカス中が`ui.accent`、ズーム中が`ui.warning`
- ブラウザタブ・カスタムビュータブは`inactiveTileDim`で暗くならない（ネイティブのwebviewがHTMLより手前に描かれるため）
- タイルの上端へマウスを寄せて出すタブバーとホバーボタンは、フォーカスしていないタイルでも暗くしない
- 背景を透過させている（`backgroundOpacity` < 1）ときは、暗くしたタイルのぶん背後のウィンドウが透けにくくなる

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

キーバインド・コマンドパレットから開いた場合だけ、開いた直後のURL欄にフォーカスが入る（`defaultUrl`を設定していても全選択された状態なので、そのまま別のURLを打てる）。CLIの`tab new --url`ではフォーカスを奪わないため、エージェントからタブを生やしてもターミナルへの入力が逸れない。

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

## リンク設定

ターミナル出力の中のURLは、**修飾キーを押しながらクリック**すると開ける。修飾キーを押している間だけ、マウスが乗っているURLに下線が出る。

対象は2種類。

- **OSC 8ハイパーリンク**: プログラムが明示的にリンクとして出力したもの（`gh`・`eza --hyperlink`等）。表示テキストとURLが違うことがある
- **素のURL**: `link.rules`の正規表現で画面の文字列から見つけたもの。ただの`https://...`という出力がそのままクリックできる

修飾キーを要求するのは、TUIアプリへのマウス操作の転送・テキスト選択と同じ左クリックを取り合わないため。修飾キーを押しながらのクリックはリンクの上でだけ横取りされ、リンクが無い場所ではこれまで通りアプリ側・選択側へ渡る。

| フィールド | 型 | 意味 |
|---|---|---|
| `modifier` | `"cmd" \| "ctrl" \| "alt" \| "shift"` | リンクを開くのに押しておく修飾キー。未指定時はmacOSが`cmd`、Windowsが`ctrl` |
| `open` | `"external" \| "browser-tab"` | 開き先。`external`はOS既定のブラウザ、`browser-tab`はniwaterm内のブラウザタブ。未指定時は`external` |
| `rules` | `LinkRule[]` | 素のURLとみなすパターン。指定すると既定のルールを**置き換える**（追加ではない） |

```ts
link: {
  modifier: "alt",
  open: "browser-tab",
},
```

macOSの既定が`cmd`なのは、macOSではctrl+クリックがOSレベルで右クリック扱いになりリンクを開く操作に使えないため（iTerm2・Terminal.appと同じ）。

`open: "browser-tab"`にすると、クリックしたタブと同じタイルへブラウザタブが足される。`mailto:`のようにブラウザタブで扱えないURLはこの設定でも外部で開く。

### URLとみなすパターン（`link.rules`）

各ルールは`regex`（正規表現。`RegExp`でも文字列でもよい）と`format`（マッチから開くURLを組み立てるテンプレート。`$0`がマッチ全体、`$1`以降がキャプチャ。省略時は`$0`）を持つ。

既定では次の3つが有効。

| パターン | 開くURL |
|---|---|
| `https?://...` | マッチした文字列そのもの |
| `mailto:...` | マッチした文字列そのもの |
| メールアドレス（`user@example.com`） | `mailto:`を頭に付けたもの |

URLの直後に置かれただけの句読点・閉じ括弧（`.` `,` `)` 等）はマッチに含めない。

チケット番号のような独自の記法をリンクにしたい場合は、既定のルールごと書き直す。

```ts
import { defaultLinkRules, defineConfig } from "@niwaterm/config";

export default defineConfig({
  link: {
    rules: [
      ...defaultLinkRules,
      { regex: /\bISSUE-(\d+)\b/, format: "https://example.com/issues/$1" },
    ],
  },
});
```

`defaultLinkRules`は設定ファイルに書くのと同じ形（`{ regex, format }`）で公開しているので、上のように既定へ足す書き方でそのまま混ぜられる。ルールは先に書いたものが優先で、クリック位置を含むマッチが最初に見つかったルールが使われる。

素のURLの検出を止めてOSC 8のリンクだけを残したい場合は`rules: []`を指定する。

実際に開けるスキームは`http` / `https` / `mailto`に限られる（PTY越しの出力はリモートホスト由来のこともあるため、`file:`・`javascript:`等は開かない）。ルールで他のスキームを拾っても開く直前に弾かれるので、その場合は`format`で開けるURLへ組み替える。

パターンは1行ずつに当てるため、**折り返して2行にまたがったURLは検出できない**（OSC 8のリンクは折り返しても1つのリンクとして扱われる）。

正規表現として不正なルールは警告付きで無視され、残りのルールで動く。書いたルールが全滅した場合だけ既定のルールへ戻る。

### 開く処理を差し替える（`niwa.on("open-link", ...)`）

`keybindings`の関数の中で`niwa.on("open-link", handler)`を呼ぶと、**`link.open`の処理の代わりに**そのハンドラが走る。

```ts
import { defineConfig } from "@niwaterm/config";

export default defineConfig({
  keybindings: (niwa) => {
    niwa.on("open-link", (event) => {
      // 社内のリンクだけniwaterm内のブラウザタブで開き、他は外部ブラウザへ渡す
      if (event.url.startsWith("https://internal.example.com/")) {
        niwa.tab.create();
        return;
      }
      niwa.link.openExternal(event.url);
    });
  },
});
```

`link.open`の設定どおりの処理へ戻したいときは`niwa.link.default(event)`を呼ぶ。

ハンドラは`async`にでき、`niwa`のAPI（`shell.run`・`notify`・`popup.open`等）をそのまま使える。

ハンドラに渡る値（`NiwaLinkEvent`）は次の通り。

| フィールド | 型 | 意味 |
|---|---|---|
| `url` | `string` | 開こうとしているURL（`format`を適用した後の値） |
| `text` | `string` | 画面上でマッチした文字列そのもの。`format`でURLへ組み替えた場合は元の見た目が残る |
| `tabId` / `tileId` | `string` | クリックされたタブとその所在 |
| `cwd` | `string \| undefined` | そのタブが報告している作業ディレクトリ。シェル統合（OSC 7）を入れていないタブでは`undefined` |

`niwa.link`のメソッドは2つ。

| メソッド | 意味 |
|---|---|
| `default(event)` | `link.open`の設定に従って開く（既定の処理と同じもの） |
| `openExternal(url)` | `link.open`の設定に関わらずOS既定のブラウザで開く |

## ユーザー定義HTML UI（customViews）

`customViews`は、ユーザーが用意したHTMLをniwaterm内（サイドバー・タブ）に表示するための設定。配列に並べた順でサイドバーのビュー切替に並ぶ。**未指定・空配列なら機能自体がオフ**になり、サイドバーの見た目・挙動は変化しない。

| フィールド | 型 | 意味 |
|---|---|---|
| `id` | `string` | キーバインド（`show-sidebar-view:<id>`）・CLI（`niwaterm sidebar switch --view <id>`）から指すためのid。未指定時は`name`から作られる（小文字化し、英数字以外は`-`へ。`Worktrees` → `worktrees`） |
| `name` | `string` | サイドバーの切替タブに表示する名前。未指定時は`"Custom View 1"`のような並び順の連番 |
| `path` | `string` | ローカルHTMLファイルへのパス。`~/.config/niwaterm/`（設定ファイルのあるディレクトリ）からの相対 or 絶対パス。`file://`として読み込む |
| `url` | `string` | 任意URL。`path`未指定時のみ使われる（`path`優先） |
| `handlers` | `Record<string, (payload, niwa) => unknown>` | HTML側から`niwaterm.call`で呼べる関数。後述 |

`path`と`url`のどちらも指定しなかった要素は、警告付きで飛ばされる（他の要素は有効なまま）。`path`が実在しないファイルを指している場合は、ビューは残したまま警告だけが出る（サイドバーには空白のビューが出る）。飛ばさないのは、ファイルの有無でid採番が変わると、HTMLを置いた途端にキーバインド・CLIから指す`id`がずれてしまうため。

```ts
customViews: [
  { name: "Notes", path: "./notes.html" },
  { id: "wt", name: "Worktrees", path: "./worktrees.html" },
],
```

idは全ビューで一意になるよう解決される。重複した場合・`name`から英数字を拾えない場合（日本語名など）・ワークスペース一覧の予約id`workspaces`と衝突した場合は、末尾に連番が付く（`notes-2`・`custom-view-1`）。解決後のidは`niwaterm config show`で確認できる。

設定すると、サイドバーの上部にビュー切替のタブが表示され、クリックでワークスペース一覧と各パネルを切り替えられる。ビューが増えてタブが収まらなくなったら、タブ列は横スクロールする。切り替え方は他にもある。

- キーバインド: 順送りは`next-sidebar-view`（既定は prefix + `shift+b`）、id指定は`show-sidebar-view:<id>`（既定キーは無い）
  ```ts
  keybindings: (niwa) => {
    niwa.keybind("1", "show-sidebar-view:workspaces");
    niwa.keybind("2", "show-sidebar-view:wt");
  },
  ```
- コマンドパレット: 「Next Sidebar View」と、ビューごとの「Show Sidebar View: <名前>」
- CLI: `niwaterm sidebar switch --view <id>`

同じHTMLはタブとしても開ける。

- キーバインド: `new-custom-view-tab`アクションを自分で割り当てる（既定キーは無い。開くのは常に先頭のビュー）
  ```ts
  keybindings: (niwa) => {
    niwa.keybind("shift+u", "new-custom-view-tab");
  },
  ```
- CLI: `niwaterm tab new --tile <tileId> --custom-view [--view <id>]`（`--url`と同時指定は不可）

内部的には既存のブラウザタブ機構（`<electrobun-webview>`）をそのまま使っている。サイドバーのパネルは初めてそのビューを表示したときに読み込まれるため、登録しただけで開いていないビューのHTMLは起動時に読まれない。

**ビューごとに別のHTMLを指すこと**。同じURLを2つのビューへ登録すると、後から開いた方のパネルが空のまま何も描画されない（`docs/known-issues/electrobun-duplicate-url-webview-stays-blank.md`）。同じUIを使い回したい場合は、本体を`<script src>`等で共有した薄いHTMLをビューの数だけ用意する。

### HTMLからniwatermを操作する（handlers）

HTMLはniwaterm本体とは別プロセス（webview）で動くため、そこから直接niwatermやOSを操作することはできない。
代わりに、`handlers`へ書いた関数をHTML側から名前で呼ぶ。

```ts
customViews: [
  {
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
],
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
- ハンドラ名はビューごとに独立している。別のビューに同じ名前があっても互いに影響しない
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

## タブのホバーボタン（hoverButtons）

タブの表示領域の端に、そのタブ専用のボタンを置ける。`hoverButtons`は「1つの位置に置く枠」の配列で、端に出た取っ手を押すと枠が開き、`items`が組み立てた項目が並ぶ。項目が1つならただのボタン、複数なら目次のように並ぶ。

```ts
hoverButtons: [
  {
    position: "bottom-right",
    items: (tab, niwa) => [
      { label: "git", run: () => niwa.popup.open({ command: "lazygit", cwd: tab.cwd }) },
    ],
  },
],
```

| フィールド | 型 | 意味 |
|---|---|---|
| `id` | `string` | CLI（`niwaterm tab hover reveal`）から指すためのid。省略時は`position`（重複時は`right-2`のような連番付き） |
| `position` | `string` | 置く位置。`top-left` / `top` / `top-right` / `left` / `right` / `bottom-left` / `bottom` / `bottom-right` |
| `show` | `function` | そのタブに出すかの判定。省略時は全てのターミナルタブに出る |
| `items` | `function` | 枠を開いた時に並べる項目を組み立てる |
| `css` | `string` | `items`の`html`・取っ手の見た目を変えるCSS |
| `handle` | `object \| false` | 取っ手の見た目（後述）。`false`なら取っ手を出さず、端へマウスを寄せた間だけ枠を出す |
| `trigger` | `number` | `handle: false`のときの呼び出しの帯の太さ(px)。省略時は24。2〜200へ丸める |

基準は**タブの表示領域**（タイルの内側）で、ウィンドウ全体ではない。タイルを分割していれば、それぞれのタイルの端に出る。同じ位置に複数の枠を置いた場合は設定に並べた順に繋がって出る。上下の辺・四隅に置いた枠は横並び、左右の辺に置いた枠は縦並びになる（変えたい場合は`css`で`.hover-panel`の`flex-direction`を上書きする）。

### 取っ手（handle）

取っ手は常に出ていて、押すと枠が開く。もう一度取っ手を押す・枠の外を押す・Escのどれかで閉じる。取っ手のぶんだけターミナルの端が隠れるので、邪魔なら`position`で置き場所を変えるか`handle: false`にする。

| フィールド | 型 | 意味 |
|---|---|---|
| `style` | `string` | `"edge"`（端に貼り付く形。省略時） / `"floating"`（端から少し離れて浮く丸いアイコンボタン） |
| `shape` | `string` | `"edge"`の形。`"round"`（省略時） / `"rect"` / `"diamond"` |
| `icon` | `string` | `"floating"`のボタンに差し込むHTML。省略時は`☰` |

`"edge"`の形は置いた位置に合わせて切り取られる。

| `shape` | 辺（`right`・`top`等） | 角（`bottom-right`等） |
|---|---|---|
| `round` | 内側へ膨らむ半円 | 1/4円 |
| `rect` | 細長い長方形 | 正方形 |
| `diamond` | 三角（ひし形の半分） | 直角三角形（ひし形の1/4） |

```ts
{
  position: "bottom-right",
  handle: { style: "floating", icon: "📑" },
  items: ...,
},
```

これ以上の見た目は`css`で変えられる。取っ手は`.hover-handle`で、`data-button-id`・`data-position`・`data-style`・`data-shape`を持ち、開いている間は`data-open`が付く。大きさは`--hover-handle-size`（既定12px）から導いているので、これを変えれば形を保ったまま伸縮する。枠は取っ手の実寸を測って重ならない位置に開く。

```ts
css: `
.hover-handle[data-button-id="toc"] { --hover-handle-size: 18px; background: #f0c070; }
`,
```

同じ位置に取っ手ありの枠が複数あれば、取っ手は1つだけ出て（見た目は設定で先に並べた枠のもの）、押すと全部が並ぶ。

### 取っ手を出さない（handle: false）

`handle: false`の枠は、端へマウスを寄せた間だけ開く。呼び出しの帯は端から24px（`trigger`で変えられる）で、左右の辺は縦方向の中央半分（四隅は上下の辺が持つ）でだけ反応する。帯はDOM要素ではないため、出ていない間のクリック・選択・マウスレポートは奪わない。マウスを離すと閉じる（Escでも閉じる）。

### 出すタブを絞る（show）

`show`はタブ変数・cwdでタブを絞る同期の関数。タブの状況が変わったときに評価されるので、非同期処理や重い処理は書かない（重い処理は`items`側に置く）。

```ts
{
  position: "right",
  // エージェント統合のhookが書き込むタブ変数を見て、Claudeを動かしているタブにだけ出す
  show: (tab) => tab.vars["agent_status"] !== undefined,
  items: () => [...],
},
```

`show`・`items`の第1引数には、そのタブの状況が渡る。

| フィールド | 型 | 意味 |
|---|---|---|
| `tabId` | `string` | そのタブのid |
| `cwd` | `string \| undefined` | そのタブが報告している作業ディレクトリ。シェル統合（OSC 7）を入れていないタブでは`undefined` |
| `vars` | `Record<string, string>` | そのタブのタブ変数（`niwaterm tab var set`・シェル統合・エージェント統合のhookが書き込む）。`cwd`もこの中の`"cwd"`に入っている |
| `tabName` | `string \| undefined` | サイドバーから設定したタブ名。未設定は`undefined` |

`show`を使わずタブを絞りたい場合は、`niwaterm tab var set`で目印の変数を立てて`show`から読むのが手軽（シェルのフック・エージェントのhookから叩ける）。

### 項目を組み立てる（items）

`items`は枠を開くたびに呼ばれるので、ファイルの読み直し・コマンド実行を伴う動的な項目も書ける。第2引数は[キーバインドの関数ハンドラ](#キーバインド)と同じ`niwa`。

| フィールド | 型 | 意味 |
|---|---|---|
| `label` | `string` | 表示するテキスト |
| `html` | `string` | `label`の代わりに差し込むHTML |
| `tooltip` | `string` | マウスを載せた時に出る説明。省略時は`label` |
| `run` | `function` | 押した時の処理。非同期でもよい |

`html`を使うと、文字ではなく印だけを並べるような見た目も作れる。クリックの拾い方・並べ方はniwaterm側が持つので、`a`要素や`button`要素にする必要はない。

```ts
{
  id: "toc",
  position: "right",
  css: `.toc-tick { width: 14px; height: 2px; background: currentColor; opacity: 0.5 }`,
  items: async (tab) => {
    const prompts = await readPrompts(tab.cwd);
    return prompts.map((prompt) => ({
      html: '<span class="toc-tick"></span>',
      tooltip: prompt.text,
      run: () => jumpTo(prompt),
    }));
  },
},
```

`html`はniwaterm本体のwebviewへそのまま入る。コマンド出力・ファイルの中身のような外から来た文字列を埋め込むときは、自分でエスケープすること。`css`はwebviewの`<style>`へそのまま入るので、class名に`id`を含める等でniwaterm本体や他のボタンと衝突しないようにする。

関数が例外を投げた場合・配列以外を返した場合・`label`も`html`も持たない項目は、警告付きで無視される。

そのまま使える例が`contrib/agent-integration/claude-code/prompt-jump/`にある（Claude Codeのプロンプトを線の目次として並べ、クリックしたプロンプトへClaude Code側の表示を移す）。

### 制約

- **ターミナルタブにだけ出る**。ブラウザタブ・customViewタブはネイティブのオーバーレイがHTMLより手前に描かれるため、重ねても見えずマウスも拾えない
- **ポップアップには出ない**（ポップアップは独自のツールバーを持つため）
- `appearance.tabBar`が`"auto"`のタイルでは、上辺の取っ手・呼び出し帯がオーバーレイ表示のタブバーと同じ場所にある。上辺の帯へマウスを寄せるとタブバーと枠が同時に出て、枠はタブバーの下へ並ぶ
- 画面右上に出るバッジ（`COPIED`・`SCROLLBACK`）と`top-right`の取っ手・枠は重なる

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
| `name` | `string` | ドロップダウン・`niwaterm shell-profile list`に表示する名前 |
| `command` | `string` | 実行コマンド（PATHから解決される。スペース区切りで単純分割） |

Windows環境では起動時に`wsl.exe --list --quiet`相当でインストール済みのWSLディストロを自動検出し、`id: "wsl-<ディストロ名>"`のプロファイルとして追加する（PowerShellは`id: "powershell"`の固定プロファイルとして常に追加される）。macOS/Linuxでは自動検出は行われず、`shell.profiles`で指定した分のみが有効。

`shell.profiles`と自動検出プロファイルは`id`単位でマージされ、**同じidの場合は`shell.profiles`側が優先**される（自動検出結果の名前・コマンドを上書きしたい場合に使える）。不正なプロファイル（`id`/`name`/`command`のいずれかが欠けている、`id`が形式不正）は警告付きでスキップされる。

コマンドパレット（既定 prefix + `:`）にもプロファイルごとに`New Tab: <name>`という項目が並ぶため、ドロップダウンを開かずキーボードだけでも同じ操作ができる。

利用可能なプロファイル一覧はCLIの`niwaterm shell-profile list`で確認できる（詳細: `docs/guide/cli.md`）。

## ターミナル設定

`terminal`は、ターミナル本体の挙動を指定するオブジェクト。現在はスクロールバック（画面から流れた行をどれだけ遡れるか）の保持行数のみを持つ。

| フィールド | 型 | 意味 |
|---|---|---|
| `scrollback` | `number` | スクロールバックとして保持する行数の上限（既定`10000`） |

```ts
terminal: {
  scrollback: 50000,
},
```

指定できるのは0以上の整数のみで、負数・小数・数値以外は警告付きで既定値にフォールバックする。無制限にする手段は用意していない（長時間動かすタブのメモリ使用量に上限が無くなるため）。メモリ使用量は行数×桁数に比例し、80桁50000行でタブあたり30MB強になる。

実際に遡れる行数は指定値より数十〜数百行多くなる。libghostty側が履歴を「ページ」単位でしか刈り込まないためで、1ページに入る行数は桁数や使っている色・絵文字の種類で変わる（80桁なら350行前後）。上限は目安として扱うこと。`0`を指定しても1ページ分は残るため、スクロールバックを完全に無くすことはできない。

設定はホットリロード対象で、保存すると既存タブにも即座に反映される。行数を減らした場合、上限を超えている分の履歴はその場で破棄される（元には戻せない）。

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

`board`は、新しいタブを開くときのcwdの決め方、名前を付けていないBoardに自動で付く名前、Boardへ付けられる作業フェーズの候補を指定するオブジェクト。

| フィールド | 型 | 意味 |
|---|---|---|
| `newTabCwd` | `"inherit"` \| `"worktree"` | 新しいタブのcwd。`"inherit"`（既定）は今のタブのcwdを引き継ぐ、`"worktree"`はそのBoardに紐づくワークツリーを使う |
| `naming` | `"directory"` \| `"directory-follow"` \| `"sequential"` | 名前を付けていないBoardの自動命名。`"directory"`（既定）は開いた時点のディレクトリ名で固定、`"directory-follow"`はフォーカス中タブのcwdへ追従、`"sequential"`は`Board 1`のような連番 |

```ts
board: {
  newTabCwd: "worktree",
},
```

`"worktree"`が効くのはタブ追加・タイル分割・ポップアップの3つ。CLI・設定APIで`cwd`を明示した場合はそちらが優先される。Boardにワークツリーが紐づいていない場合と、紐づけ先のディレクトリが存在しない場合は`"inherit"`と同じ挙動になる（存在しないcwdではPTYの起動自体が失敗するため）。紐づけの付け方は`docs/guide/worktree.md`「Boardに紐づくワークツリー」節を参照。

### 自動命名（`board.naming`）

Boardに名前を付けていないとき、サイドバーへ何を出すかを決める。

```ts
board: {
  naming: "directory-follow",
},
```

- `"directory"`（既定）: Boardを開いたディレクトリ名で固定する。以後`cd`しても変わらない
- `"directory-follow"`: フォーカス中タイルのアクティブタブのcwdのディレクトリ名。`cd`のたびに付け替わり、タイル移動・タブ切り替えでも追従する（tmuxの`automatic-rename`相当）
- `"sequential"`: `Board 1`のような連番。番号はBoardを作った時点で決まるので、サイドバーで並び替えても動かない。閉じて空いた番号は次のBoardが引き継ぐ

いずれの方式でも、**明示的に付けた名前の方が優先される**。`niwaterm board rename`・サイドバーのBoard行のダブルクリック・キーバインドの`rename-board`で付けた名前と、`niwaterm worktree new`／`worktree open`がBoardへ付けるブランチ名がこれにあたる。名前を空にして確定すると自動命名へ戻る。

ディレクトリ名を使う2つの方式は、タブのcwdが分からないと名前を決められない。この場合はサイドバーの並び順による連番（`Board 1`）が出る。

cwdの出どころは2つある。`niwaterm board new --cwd`や`worktree open`のようにniwaterm自身が開く場所を決めた場合は、Boardができた時点で名前が付く。それ以外（`board new`をcwd無しで叩く・キーバインドからBoardを作る等、シェルがOS標準のディレクトリで起動する場合）は、**シェルがOSC 7でcwdを報告するまで分からない**ので、報告が届いた時点で名前が決まる。`"directory"`はこの最初の報告で固定し、以後の`cd`では変わらない。

つまりどちらの方式も追従にはシェルのOSC 7報告が要るため、**OSC 7を送らないシェル（Windowsの`cmd`・PowerShell等）のタブでは、`--cwd`等で開く場所を指定しない限り連番のままになる**。

設定を書き換えると既に開いているBoardにも反映される（明示的に付けた名前はそのまま残る）。

### 作業フェーズ（`board.phases`）

`phases`は、Boardへ付けられる作業フェーズの候補。サイドバーのBoard行にバッジとして出るので、
「このワークツリーは今どの段階か」を一覧のまま把握できる。**未指定なら候補なし**で、
サイドバーの右クリックメニューは候補を定義する旨の案内だけを出す。

| フィールド | 型 | 意味 |
|---|---|---|
| `id` | `string` | CLI（`niwaterm board phase set <id>`）・キーバインド（`set-board-phase:<id>`）から指す識別子。英数字と`_` `-` `.` `:`のみ、1〜64文字 |
| `label` | `string` | バッジ・メニューに出す表示名（省略時は`id`をそのまま表示） |
| `color` | `string` | バッジの地の色（CSSカラー）。省略時は`appearance.ui.accent`と同じ色 |

```ts
board: {
  phases: [
    { id: "plan", label: "プラン作成", color: "#89b4fa" },
    { id: "plan-review", label: "プラン人間レビュー", color: "#f9e2af" },
    { id: "implement", label: "実装", color: "#a6e3a1" },
    { id: "ai-review", label: "AIレビュー", color: "#94e2d5" },
    { id: "human-review", label: "人間レビュー", color: "#f5c2e7" },
  ],
},
```

切り替えはサイドバーのBoard行の右クリック →「フェーズ」、コマンドパレット、キーバインド
（上記「キーバインド」節の`set-board-phase`でピッカーを開くか、`set-board-phase:<id>`で直接指定）、
CLIの`niwaterm board phase`（[CLIガイド](/guide/cli.md)の「Board」節）から行う。

候補に無い文字列もCLIからは設定でき、その場合は文字列がそのまま既定色のバッジになる
（決まった段階に収まらない一時的なメモ用）。値はBoard名・ワークツリーの紐づけと同じく
アプリを閉じても保存され、次回起動時に復元される。候補から`id`を消した場合、そのidが
付いたままのBoardはidを文字どおりのラベルとして表示する。

## サイドバー設定

`sidebar`は、サイドバーのワークスペース一覧の見た目を指定するオブジェクト。今のところ持っているのは、Board行のステータスライン（Board名の下に出る行）の構成だけ。

### Board行のステータスライン（`sidebar.boardStatus`）

`boardStatus`は、ステータスラインへ並べる項目の配列。**並べた順にそのまま上から出て、書かなかった項目は出ない**。未指定時は`["builtin:phase", "builtin:branch", "builtin:agent"]`と同じ（フェーズのバッジ・`on <branch>`・エージェントの状態テキスト）。空配列`[]`にするとステータスラインごと消え、Board行はBoard名だけの1行になる。

| 値 | 出るもの |
|---|---|
| `"builtin:phase"` | 作業フェーズのバッジ（上記「作業フェーズ」節） |
| `"builtin:branch"` | タブ変数`branch`（既定では`on main`のように接頭辞付きで出る） |
| `"builtin:agent"` | エージェントの状態テキスト（タブ変数`agent_status_text`） |
| `"tab-var:<name>"` | 任意のタブ変数の値をそのまま1行 |

出す値が無い項目は行を作らずに詰める。フェーズを付けていないBoard・変数が空のBoardで空行が空くことはない。

文字列の代わりにオブジェクトを書くと、値の前に出すラベルと文字色を指定できる。

| フィールド | 型 | 意味 |
|---|---|---|
| `source` | `string` | 上の表の値 |
| `prefix` | `string` | 値の前に出す短いラベル。空文字列を指定するとビルトインの既定ラベル（`builtin:branch`の`on`、`builtin:agent`の`❯`）を消せる |
| `color` | `string` | 値の文字色（CSSカラー） |

```ts
sidebar: {
  boardStatus: [
    "builtin:agent",
    { source: "builtin:branch", prefix: "" },
    { source: "tab-var:ticket", prefix: "#", color: "#f9e2af" },
  ],
},
```

`builtin:phase`だけはバッジとして出るため`prefix`・`color`が効かない（バッジの配色は`board.phases`の`color`で指定する）。

### 値の入れ方

`tab-var:<name>`と`builtin:branch`が読むのはBoard専用の変数ではなく**タブ変数**で、`niwaterm tab var set <key> <value>`（[CLIガイド](/guide/cli.md)の「タブ」節）で書き込む。Board行に出るのはフォーカス中タイルのアクティブタブ（代表タブ）の値なので、Board内でタブを切り替えると表示も切り替わる。

ブランチ名（`branch`）とエージェント状態（`agent`・`agent_status`・`agent_status_text`）は`contrib/shell-integration/`・`contrib/agent-integration/`のスクリプトが自動で書き込む。自前の値を出したい場合も、シェルのフックやエージェントのhookから同じように`tab var set`で入れる。

エージェント状態だけはBoard内の全タブから「応答待ち > 作業中」の順で1つ選ぶ（フォーカスしていないタイルで止まっているエージェントを取りこぼさないため）。

なお、この設定が効くのはステータスラインだけ。**Board名の左のドット（エージェントの状態色）・ベル・ズーム・起動時レイアウト・ワークツリー欠損のアイコンは対象外**で、常に出る。

## レイアウト

`layouts`は、あらかじめ定義したタイル構成をCLI（`niwaterm layout apply <name>`）から名前指定して適用できるようにするプリセット集（[vde-layout](https://github.com/yuki-yano/vde-layout)ライク）。**未指定なら機能オフ**で、`niwaterm layout list`にはビルトインのプリセット（`empty`。`docs/guide/cli.md`「ビルトインのプリセット」節）だけが並ぶ。ビルトインと同名のプリセットをここで定義すると、そちらが優先されてビルトイン側は隠れる。

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
| `shellProfile` | `string` | 使用するシェルプロファイルのid（`niwaterm shell-profile list`で確認）。省略時はデフォルトシェル |
| `cwd` | `string` | 作業ディレクトリ。省略時は`niwaterm layout apply`を実行したディレクトリ（`--cwd`で上書き可） |
| `command` | `string` | タブ作成後に流し込むコマンド（末尾にEnterを自動送信する）。改行を含む場合は1行ずつ実行される |
| `delay` | `number` | `command`を送信するまでの追加の待ち時間(ms)。省略時は0。シェルが入力を受け付けられるようになるまでの待ちはniwaterm側が自動で行う（下記）ため、通常は指定不要 |
| `vars` | `Record<string, string>` | タブ変数（`tab var set`相当で注入） |
| `focus` | `boolean` | このタブに最終フォーカスを当てる。プリセット全体で1つまで指定できる |

`command`はPTY（シェル）が入力を受け付けられるようになってから送られる。分割で作ったタイルのタブはPTYの起動自体がwebview側の実測サイズ到達まで保留されるうえ、起動直後のシェルは初期化中に流し込まれた入力を取りこぼす（コマンドの先頭が欠けて途中から実行される）ため、niwatermは「PTYが最初の出力を返し、そこから出力が止まった＝プロンプトを出し終えた」時点まで送信を遅らせる。それでも足りない場合（プロンプト表示後も初期化が続くシェル等）は`delay`で追加の待ちを指定する。

`command`はキー入力としてではなく**ペーストとして**流し込まれる。1文字ずつのキー入力で送ると、zshのZLEのような行編集機能が文字ごとにシンタックスハイライト・補完の先読み・スニペット展開を走らせるため、コマンドが長いほど流し込みの完了が遅れる（プラグイン次第で1コマンドに数秒かかる）。ペーストなら行全体が1回の挿入として扱われるので待ち時間はほぼ無くなる代わりに、スニペット展開のような「入力中に働く」機能は`command`には効かない。bracketed paste（DEC 2004）を有効にしないシェルへは従来どおり1文字ずつの入力として送られる。

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
| `fetch` | `boolean` | ワークツリーを作る前にリモートをfetchするか（`--fetch`／`--no-fetch`の既定値） | `true` |
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

`fetch`は、リモートのブランチをワークツリーとして開くときに手元のリモート追跡ブランチが古いままにならないよう、**ワークツリーを新規に作る前**に`git fetch`を打つかどうか。既存のワークツリーを開き直すだけのときと`--track local`のときは、`true`でもfetchしない。作成のたびのネットワーク待ちが気になる場合は`false`にして、必要なときだけ`--fetch`を付ける。詳細は`docs/guide/worktree.md`「リモートのブランチから作る」節。

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

`~/.config/niwaterm/niwaterm.config.ts`を保存すると、アプリを再起動せずに変更が反映される（キーバインド・外観・customViewsいずれも）。`~/.config/niwaterm/`ディレクトリをサブディレクトリ含めて監視しており、エディタのatomic save（一時ファイル書き込み→rename）方式でも検知できる。保存直後の複数回のファイルイベントは短時間でまとめられる（デバウンス）。

設定を複数ファイルへ分割している場合（「複数ファイルへの分割」節参照）、エントリファイル以外の`.ts`/`.js`等の変更もホットリロード対象になる。読み込みのたびに`~/.config/niwaterm/`配下のソースファイルを一時ディレクトリへコピーしてからimportし直すことで、importツリー全体を最新の内容に差し替えている（`node_modules`は巨大になりうるためコピーせずシンボリックリンクで参照する）。

読み込めない内容（構文エラー、存在しないモジュールのimport等）を保存した場合は、**直前に読み込めた設定のまま動き続ける**。デスクトップ通知で理由を知らせ、`niwaterm config show`と設定モーダルの「読み込みエラー」にも同じ内容が出る。エラーを直して再保存すればその時点の内容が反映され、復帰したことも通知される（通知はエラーの内容が変わったときだけ出るので、直し途中の保存で繰り返し鳴ることはない）。

デフォルトへ落ちるのは、まだ一度も設定を適用できていない場合（＝起動直後の初回読み込みから失敗している場合）だけ。設定ファイルの一部の誤りでprefixもテーマもカスタムビューも同時に消えると、編集を戻すための操作すら効かなくなるため、適用済みの設定を優先して残す。

`~/.config/niwaterm/`ディレクトリ自体が存在しない場合（未セットアップ）は監視そのものがスキップされ、コンソールにログが出るだけでアプリは通常通り起動する。

ファイル監視による自動リロードのほか、`reload-config`アクション（コマンドパレット、または`niwa.keybind`で割り当てたキー）から同じ処理を手動で呼び出すこともできる。挙動は保存時の自動リロードと同一（読み込めた場合は毎回デフォルトから解決し直すため、`niwa.keybind`/`niwa.unbind`で加えた変更をconfigファイルから削除して再読み込みすれば、その分は未設定またはデフォルトの割り当てに戻る）。

## 現在の設定値を確認する

マージ後の実際に効いている値は、アプリ内のモーダル（prefix + `i`の`show-config`アクション、またはコマンドパレットの「Show Settings」）か、CLIの`niwaterm config show`で確認できる。設定ファイルに書いていない項目も既定値として出るため、「書いたつもりが反映されていない」の切り分けに使える。

設定値の一覧より前に、直近の読み込みが失敗していればその理由（「読み込みエラー」）と、既定値へ落とした項目・無視した項目の一覧（「無視した設定」）が出る。不正な値はその項目だけを落として残りは活かす設計のため、「書いたのに効かない」ときはまずここを見る。

キーバインドの個々の割り当てはここには出ない（件数のみ）。一覧は`niwaterm keybind list`で確認する。関数で書く設定（`mouse.selectionMenu`・`worktree.onCreate`・`niwa.on`のハンドラ）も値として表示できないため含まない。

## 既知の制約

- **`ctrl`修飾子は未対応**。既存機能がcmd/shift/altしか使っていないため、今回の型・パーサでは対象外（将来Ctrl系のキーバインドが必要になったら拡張する）
- **macOSのOption+英数字キーは英数字・数字キーのみ対応している**。Optionを押しながら文字キーを押すと`e.key`がUnicode記号やデッドキーに変わる（`Option+P`→`π`、`Option+N`→`˜`）が、`alt+n`のような英数字（`a`〜`z`）・数字（`0`〜`9`）のバインドは物理キー位置(`e.code`)から復元しているため`noPrefix`/`direct`でもそのまま動く。一方、記号キー（`alt+;`等）はレイアウトでキー位置がずれるため復元対象外で、macOSでは意図通りマッチしない可能性がある。詳細: `docs/known-issues/macos-option-key-breaks-alt-keybindings.md`
- **Shiftで入力する記号は`shift+`を付けずに書く**。`|`・`:`・`+`のようにShiftを押して打つ記号は、押した結果の文字そのもので`niwa.keybind("|", ...)`と書けば一致する（Shiftの要否はキーボード配列で変わるため、Shift付きで一致するバインドが無ければShift無しの表記でも引き直している）。英字は従来どおり`d`と`shift+d`を区別する。なおmacOSのJIS配列では`¥`キーの既定入力が`¥`なので、`\`のバインドは`Option+¥`で打つか、入力ソースの設定で`¥`キーを`\`に切り替える必要がある
