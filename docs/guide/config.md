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
| `niwa.keybind(key, action, opts?)` | キーにアクションを割り当てる。`action`は既存アクション名の文字列、または関数ハンドラ`(niwa) => void \| Promise<void>`。`opts.noPrefix: true`でprefix不要の即時発火（directと同じ扱い。この場合`key`はcmd/ctrl/altのいずれかを含むKeyBindingString表記）。`opts.repeat: true`で発火後`repeatTimeoutMs`以内はprefix無しで連打できる（tmuxの`bind-key -r`相当。`bindings`側のみ有効、`noPrefix`併用時は効果を持たない） |
| `niwa.unbind(key, opts?)` | `niwa.keybind`で割り当てたバインドを解除する |
| `niwa.sleep(ms)` | 明示的な待ち時間(ms)。下記「非同期処理について」参照 |
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
| `niwa.workspace.create(cwd?)` | 新規ワークスペースを作成し、そのidを返す |
| `niwa.workspace.switch(workspaceId)` | ワークスペースを切り替える |
| `niwa.workspace.swap(workspaceIdA, workspaceIdB)` | 2つのワークスペースの表示順（サイドバー・ウィンドウタイトルの番号）を入れ替える（tmuxの`swap-window`相当）。中身は変更しない |
| `niwa.workspace.list()` | 全ワークスペースを表示順で`{ id, name, active }[]`として返す。`name`は未設定なら`null` |
| `niwa.workspace.current()` | 現在アクティブなワークスペースのidを返す（tmuxの`switch-client`が参照する`current-window`相当） |
| `niwa.clipboard.write(text)` / `niwa.clipboard.read()` | クリップボードの読み書き |

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
| `shift+n` | new-workspace |
| `]` / `[` | next-workspace / prev-workspace |
| `b` | toggle-sidebar |
| `` ` `` | toggle-popup |
| `:` | command-palette |
| `=` / `-` / `0` | increase-font-size / decrease-font-size / reset-font-size |
| `pageup` / `pagedown` | scroll-page-up / scroll-page-down |
| `home` / `end` | scroll-to-top / scroll-to-bottom |

**KeybindAction の一覧**（32種類。関数ベースAPIでは`niwa.keybind(key, "アクション名")`のように文字列そのまま渡せる）:

| アクション | 意味 |
|---|---|
| `split-vertical` / `split-horizontal` | タイルを垂直/水平分割 |
| `close-tile` | フォーカス中のタブ/タイルを閉じる |
| `focus-up` / `focus-down` / `focus-left` / `focus-right` | 隣接タイルへフォーカス移動 |
| `resize-up` / `resize-down` / `resize-left` / `resize-right` | フォーカス中タイルを既定の1ステップ分拡大（`niwa.tile.resize`相当）。既定キーは無いため使うには自分で割り当てる必要がある。`repeat: true`と組み合わせるとtmuxの`-r`風に連打できる（上記「repeatによる連打」参照） |
| `toggle-zoom` | フォーカス中タイルの一時的なズーム表示を切り替える（`niwa.tile.zoom()`相当。tmuxの`resize-pane -Z`相当。他のタイルを隠し画面全体に表示、再実行で解除） |
| `new-tab` | 新規タブ作成 |
| `new-browser-tab` | 新規ブラウザタブ作成（表示URLは`browser.defaultUrl`を参照） |
| `new-custom-view-tab` | `customView`設定を開くタブを作成（`customView`未設定時は何もしない。既定キーは無いため使うには自分で割り当てる必要がある） |
| `next-tab` / `prev-tab` | タブ切替 |
| `new-workspace` | 新規ワークスペース作成 |
| `next-workspace` / `prev-workspace` | ワークスペース切替 |
| `toggle-sidebar` | サイドバーの表示/非表示切替 |
| `toggle-popup` | ポップアップの表示/非表示切替 |
| `copy-selection` | 選択範囲をクリップボードへコピー（既定は`direct`にWindowsのみ`ctrl+shift+c`が割り当て済み。macOSはApplicationMenu経由でCmd+Cが既に機能する） |
| `paste-clipboard` | クリップボードの内容をペースト（既定は`direct`にWindowsのみ`ctrl+shift+v`が割り当て済み。macOSはApplicationMenu経由でCmd+Vが既に機能する） |
| `scroll-page-up` / `scroll-page-down` | スクロールバックを1ページ分スクロール |
| `scroll-to-top` / `scroll-to-bottom` | スクロールバックの先頭/最新行へジャンプ |
| `command-palette` | コマンドパレットを開く |
| `increase-font-size` / `decrease-font-size` / `reset-font-size` | フォントサイズの拡大/縮小/リセット |

不正なバインド文字列（`prefix`/`direct`で未知の修飾子・`cmd`/`ctrl`/`alt`のいずれも含まない、`bindings`で`cmd`/`ctrl`を含む等）や未知のアクション名を指定した場合、そのエントリだけが無視され、警告がコンソールに出力される（起動時にターミナルから`bun run start`した場合に見える）。設定ファイル自体が読み込めない場合（構文エラー、`node_modules`未インストール等）はデフォルトキーバインド全体にフォールバックする。

## 外観設定

`appearance`はフォント・カラーテーマを指定するオブジェクト。全フィールドoptionalで、指定しなかったフィールドは`defaultAppearance`の値のまま有効（`defaultAppearance`をspreadしてから一部だけ上書きするのが基本の書き方）。

| フィールド | 型 | 意味 |
|---|---|---|
| `fontFamily` | `string` | CSSの`font-family`値をそのまま文字列で指定する（複数フォント列挙・クォートはユーザー側の責務） |
| `fontSize` | `number` | フォントサイズ（px） |
| `lineHeight` | `number` | 行高（px） |
| `foreground` | `string` | 前景色（CSSカラー値） |
| `background` | `string` | 背景色（CSSカラー値） |
| `ansiColors` | `readonly string[]` | ANSI標準16色（index 0-7:通常、8-15:bright）。16色すべてを書く必要はなく、書いたindexだけ上書きされる |

```ts
appearance: {
  ...defaultAppearance,
  fontSize: 16,
  ansiColors: [
    ...defaultAppearance.ansiColors,
    "#ff0000", // index 0（黒相当）だけ赤に変更する例
  ],
},
```

不正な値（`fontSize`に文字列を渡す、色に空文字列を渡す等）を指定した場合、そのフィールド（`ansiColors`はそのindex）だけ警告付きでデフォルトにフォールバックする。256色のうち16-231（6x6x6カラーキューブ）・232-255（グレースケール）は固定の計算式でユーザー設定の対象外。

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

## ユーザー定義HTML UI（customView）

`customView`は、ユーザーが用意したHTMLをniwaterm内（サイドバー・タブ）に表示するための設定。**未指定なら機能自体がオフ**になり、サイドバーの見た目・挙動は変化しない。

| フィールド | 型 | 意味 |
|---|---|---|
| `name` | `string` | サイドバーの切替ボタンに表示する名前。未指定時は`"Custom View"` |
| `path` | `string` | ローカルHTMLファイルへのパス。`~/.config/niwaterm/`（設定ファイルのあるディレクトリ）からの相対 or 絶対パス。`file://`として読み込む |
| `url` | `string` | 任意URL。`path`未指定時のみ使われる（`path`優先） |

`path`と`url`のどちらも指定しなかった場合は警告付きで機能オフになる。

```ts
customView: {
  name: "Notes",
  path: "./notes.html",
},
```

設定すると、サイドバーの上部にワークスペース一覧との切替スイッチャーが表示され、クリックで一覧表示とcustomViewパネルを切り替えられる。同じHTMLはタブとしても開ける:

- キーバインド: `new-custom-view-tab`アクションを自分で割り当てる（既定キーは無い）
  ```ts
  keybindings: (niwa) => {
    niwa.keybind("shift+u", "new-custom-view-tab");
  },
  ```
- CLI: `niwaterm tab new --tile <tileId> --custom-view`（`--url`と同時指定は不可）

内部的には既存のブラウザタブ機構（`<electrobun-webview>`）をそのまま使っており、`customView`のHTMLからniwatermのAPI（タイル・タブ操作等）を呼び出す仕組みは未実装（roadmap参照）。

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

## レイアウト

`layouts`は、あらかじめ定義したタイル構成をCLI（`niwaterm layout apply <name>`）から名前指定して適用できるようにするプリセット集（[vde-layout](https://github.com/yuki-yano/vde-layout)ライク）。**未指定なら機能オフ**で、`niwaterm layout list`は空一覧を返す。

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
| `delay` | `number` | `command`を送信するまでの待ち時間(ms)。シェル起動直後の取りこぼし防止用。省略時は0 |
| `vars` | `Record<string, string>` | タブ変数（`tab var set`相当で注入） |
| `focus` | `boolean` | このタブに最終フォーカスを当てる。プリセット全体で1つまで指定できる |

適用はCLIから行う。

```sh
niwaterm layout list
niwaterm layout apply dev
niwaterm layout apply dev --replace
```

`niwaterm layout apply <name>`は既定で新規ワークスペースとして適用する（`--new-workspace`を明示してもよい）。`--replace`を指定すると現在のワークスペースを単一タイルへ畳んでから適用し直す（**既存タブ・PTYは無条件でcloseされる**、確認プロンプト等は無い）。`shellProfile`が未知のid・`focus:true`が2つ以上、といった不正なプリセットはワークスペースに一切手を触れずエラーになる。詳細・エラー時の挙動は`docs/guide/cli.md`参照。

## ホットリロード

`~/.config/niwaterm/niwaterm.config.ts`を保存すると、アプリを再起動せずに変更が反映される（キーバインド・外観・customViewいずれも）。`~/.config/niwaterm/`ディレクトリをサブディレクトリ含めて監視しており、エディタのatomic save（一時ファイル書き込み→rename）方式でも検知できる。保存直後の複数回のファイルイベントは短時間でまとめられる（デバウンス）。

設定を複数ファイルへ分割している場合（「複数ファイルへの分割」節参照）、エントリファイル以外の`.ts`/`.js`等の変更もホットリロード対象になる。読み込みのたびに`~/.config/niwaterm/`配下のソースファイルを一時ディレクトリへコピーしてからimportし直すことで、importツリー全体を最新の内容に差し替えている（`node_modules`は巨大になりうるためコピーせずシンボリックリンクで参照する）。

構文エラーのある内容を保存した場合は、コンソールに警告ログが出た上でデフォルト設定（キーバインド・外観とも）にフォールバックする。「直前の有効な設定を保持する」のではなく、初回読み込み時と同様に毎回デフォルトから解決し直す設計のため、エラーを直して再保存すれば元通り反映される。

`~/.config/niwaterm/`ディレクトリ自体が存在しない場合（未セットアップ）は監視そのものがスキップされ、コンソールにログが出るだけでアプリは通常通り起動する。

## 既知の制約

- **`ctrl`修飾子は未対応**。既存機能がcmd/shift/altしか使っていないため、今回の型・パーサでは対象外（将来Ctrl系のキーバインドが必要になったら拡張する）
- **macOSのOption+文字キーはレイアウト依存でずれる場合がある**。Optionキーを押しながら文字キーを押すと、`e.key`がUnicode記号に変換されることがある（キーボードレイアウト依存）。矢印キーと角括弧（`code`で判定）は影響を受けないが、`cmd+alt+d`のような「Alt+文字キー」の組み合わせは型上書けても実行時に意図通りマッチしない可能性がある。`alt+h`のような`noPrefix`/`direct`のalt単独バインドも同じ理由でずれうる（US配列など、レイアウトによって記号化されないキーを選ぶと安定する）
