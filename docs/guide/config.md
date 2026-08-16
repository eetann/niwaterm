---
type: Reference
title: 設定ファイル
description: niwatermのTypeScript設定ファイル（キーバインド・外観など）のセットアップと書き方
---

# 設定ファイル

niwatermの設定はTypeScriptで書く。設定ディレクトリ（`~/.config/niwaterm/`）を小さなNodeプロジェクトとして扱い、型定義・ヘルパー関数は`@niwaterm/config`パッケージから提供する。これによりTypeScript LSPの標準機能（型補完・定義ジャンプ）がそのまま使える。

キーバインドに加えて、フォント・カラーテーマなどの外観も設定できる。設定ファイルの変更は再起動なしで反映される（ホットリロード）。`niwaterm init`によるセットアップ自動化は未実装（roadmap参照）。

## セットアップ（手動、`niwaterm init`実装までの暫定手順）

```sh
mkdir -p ~/.config/niwaterm
```

`~/.config/niwaterm/`に以下の3ファイルを配置する（`packages/config/examples/`のコピーがベース）。

**`~/.config/niwaterm/package.json`**

```json
{
  "name": "niwaterm-user-config",
  "private": true,
  "type": "module",
  "dependencies": {
    "@niwaterm/config": "file:/path/to/niwaterm/packages/config"
  }
}
```

`file:`のパスは、このリポジトリをcloneした先の絶対パス（例: `/Users/you/ghq/github.com/eetann/niwaterm/packages/config`）に書き換える。実際にnpm registryへ公開されたら、このfile参照はバージョン範囲指定（例: `^0.1.0`）に差し替わる想定。

`file:`の代わりに`bun link`を使う方法もある。`packages/config`で`bun link`を実行後、`~/.config/niwaterm/`で`bun link @niwaterm/config`を実行するとリンクできる。

**`~/.config/niwaterm/tsconfig.json`**

```json
{
  "compilerOptions": {
    "lib": ["ESNext"],
    "target": "ESNext",
    "module": "ESNext",
    "moduleDetection": "force",
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "strict": true,
    "skipLibCheck": true,
    "noEmit": true
  },
  "include": ["*.ts"]
}
```

**`~/.config/niwaterm/niwaterm.config.ts`**

```ts
import { defaultAppearance, defaultKeybindings, defineConfig } from "@niwaterm/config";

export default defineConfig({
  keybindings: {
    ...defaultKeybindings,
    bindings: {
      ...defaultKeybindings.bindings,
      d: "split-horizontal",
      "shift+d": "split-vertical",
    },
  },
  appearance: {
    ...defaultAppearance,
    fontSize: 14,
  },
});
```

最後に依存をインストールする。

```sh
cd ~/.config/niwaterm && bun install
```

`node_modules/`はDotfilesで管理する場合、Git管理対象外にする想定。

## キーバインドDSL

niwatermのキーバインドはtmux風の**prefix方式**。まずprefixキー（既定`ctrl+b`）を押し、離してから2打目のキー（例: `d`）を押すとアクションが発火する（タイムアウトは無く、2打目キーの入力があるまで待ち続ける。`Escape`または割り当てのないキーでキャンセルできる）。コピー・ペーストのような頻用操作だけは、prefixを介さず即座に発火する`direct`ショートカットとして別枠を持てる。

`keybindings`は次の3フィールドを持つオブジェクト。いずれも未指定のフィールドは`defaultKeybindings`の値のまま有効（`defaultKeybindings`をspreadしてから一部だけ上書きするのが基本の書き方）。

| フィールド | 型 | 意味 |
|---|---|---|
| `prefix` | `KeyBindingString` | prefixキー本体。既定は`"ctrl+b"`（tmux標準を踏襲。macOS/Windowsで共通） |
| `bindings` | `Record<string, KeybindAction>` | prefix入力後に押す2打目キー→アクションのマップ |
| `direct` | `Record<KeyBindingString, KeybindAction>` | prefixを介さず即座に発火する直接ショートカット。既定はWindowsのみコピー・ペーストが入っている（macOSはApplicationMenu経由でCmd+C/Vが既に機能するため空） |

**`prefix` / `direct` の書式**: `修飾子+...+キー本体`（`+`区切り）

- 修飾子は `cmd` / `ctrl` / `shift` / `alt`。**`cmd`または`ctrl`のいずれかを含む必要がある**（含まないキーは通常のターミナル入力に予約されているため、割り当てても無視される）
- 例: `"ctrl+b"`, `"cmd+shift+c"`

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
| `c` | new-tab |
| `shift+t` | new-browser-tab |
| `n` / `p` | next-tab / prev-tab |
| `shift+n` | new-workspace |
| `]` / `[` | next-workspace / prev-workspace |
| `b` | toggle-sidebar |
| `` ` `` | toggle-popup |
| `pageup` / `pagedown` | scroll-page-up / scroll-page-down |
| `home` / `end` | scroll-to-top / scroll-to-bottom |

**KeybindAction の一覧**（23種類）:

| アクション | 意味 |
|---|---|
| `split-vertical` / `split-horizontal` | タイルを垂直/水平分割 |
| `close-tile` | フォーカス中のタブ/タイルを閉じる |
| `focus-up` / `focus-down` / `focus-left` / `focus-right` | 隣接タイルへフォーカス移動 |
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

不正なバインド文字列（`prefix`/`direct`で未知の修飾子・`cmd`と`ctrl`をどちらも含まない、`bindings`で`cmd`/`ctrl`を含む等）や未知のアクション名を指定した場合、そのエントリだけが無視され、警告がコンソールに出力される（起動時にターミナルから`bun run start`した場合に見える）。設定ファイル自体が読み込めない場合（構文エラー、`node_modules`未インストール等）はデフォルトキーバインド全体にフォールバックする。

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

`browser`は新規ブラウザタブ（`new-browser-tab`キーバインド、または`niwaterm new-tab`のCLIで`--url`省略時）を開いた際のデフォルトURLを指定するオブジェクト。

| フィールド | 型 | 意味 |
|---|---|---|
| `defaultUrl` | `string` | 新規ブラウザタブの初期表示URL。未指定時は`about:blank` |

```ts
browser: {
  defaultUrl: "https://example.com",
},
```

不正な値（空文字列等）を指定した場合、警告付きで`about:blank`にフォールバックする。CLIから`niwaterm new-tab --tile <tileId> --url <url>`のように`--url`を指定した場合は、この設定に関わらず指定したURLが優先される。

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
  keybindings: {
    ...defaultKeybindings,
    bindings: {
      ...defaultKeybindings.bindings,
      "shift+u": "new-custom-view-tab",
    },
  },
  ```
- CLI: `niwaterm new-tab --tile <tileId> --custom-view`（`--url`と同時指定は不可）

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
| `id` | `string` | 一意識別子。英数字・`_`・`-`・`.`のみ、1〜64文字。CLIの`niwaterm new-tab --shell <id>`やRPCでの指定に使う |
| `name` | `string` | ドロップダウン・`niwaterm shell-profiles`に表示する名前 |
| `command` | `string` | 実行コマンド（PATHから解決される。スペース区切りで単純分割） |

Windows環境では起動時に`wsl.exe --list --quiet`相当でインストール済みのWSLディストロを自動検出し、`id: "wsl-<ディストロ名>"`のプロファイルとして追加する（PowerShellは`id: "powershell"`の固定プロファイルとして常に追加される）。macOS/Linuxでは自動検出は行われず、`shell.profiles`で指定した分のみが有効。

`shell.profiles`と自動検出プロファイルは`id`単位でマージされ、**同じidの場合は`shell.profiles`側が優先**される（自動検出結果の名前・コマンドを上書きしたい場合に使える）。不正なプロファイル（`id`/`name`/`command`のいずれかが欠けている、`id`が形式不正）は警告付きでスキップされる。

利用可能なプロファイル一覧はCLIの`niwaterm shell-profiles`で確認できる（詳細: `docs/guide/cli.md`）。

## ワークスペース設定

`workspace`は、新規ワークスペース作成時（アプリ起動時の最初のワークスペース・`niwaterm new-workspace`）の最初のタブに使うデフォルトcwdを指定するオブジェクト。**未指定ならOS標準のホームディレクトリ**が使われる（niwaterm自体をWSL/Linux環境で動かしている場合は、そのホームディレクトリが自然にデフォルトになる）。

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

- `{ kind: "split", orientation: "horizontal" | "vertical", ratio?: number, first: LayoutNodeConfig, second: LayoutNodeConfig }` — タイルを2分割する。既存のタイル分割（`niwaterm split-tile`）と同じく`horizontal`は上下、`vertical`は左右に並べる。`ratio`は`first`が占める比率(0〜1、省略時0.5)。**N分割の配列指定は無く、3分割以上はネストで表現する**（上の例の`second`側を参照）
- `{ kind: "tile", tabs: LayoutTabConfig[], activeTab?: number }` — タイル1枚とその中のタブ一覧。`tabs`は最低1つ必要。`activeTab`はアクティブにするタブのindex（省略時は最後のタブ）

各タブ（`LayoutTabConfig`）のフィールドはすべて省略可。

| フィールド | 型 | 意味 |
|---|---|---|
| `name` | `string` | タブ名（サイドバー・タブバー表示用） |
| `shellProfile` | `string` | 使用するシェルプロファイルのid（`niwaterm shell-profiles`で確認）。省略時はデフォルトシェル |
| `cwd` | `string` | 作業ディレクトリ。省略時は`niwaterm layout apply`を実行したディレクトリ（`--cwd`で上書き可） |
| `command` | `string` | タブ作成後に流し込むコマンド（`send-keys`相当、末尾にEnterを自動送信する） |
| `delay` | `number` | `command`を送信するまでの待ち時間(ms)。シェル起動直後の取りこぼし防止用。省略時は0 |
| `vars` | `Record<string, string>` | タブ変数（`set-var`相当で注入） |
| `focus` | `boolean` | このタブに最終フォーカスを当てる。プリセット全体で1つまで指定できる |

適用はCLIから行う。

```sh
niwaterm layout list
niwaterm layout apply dev
niwaterm layout apply dev --replace
```

`niwaterm layout apply <name>`は既定で新規ワークスペースとして適用する（`--new-workspace`を明示してもよい）。`--replace`を指定すると現在のワークスペースを単一タイルへ畳んでから適用し直す（**既存タブ・PTYは無条件でcloseされる**、確認プロンプト等は無い）。`shellProfile`が未知のid・`focus:true`が2つ以上、といった不正なプリセットはワークスペースに一切手を触れずエラーになる。詳細・エラー時の挙動は`docs/guide/cli.md`参照。

## ホットリロード

`~/.config/niwaterm/niwaterm.config.ts`を保存すると、アプリを再起動せずに変更が反映される（キーバインド・外観・customViewいずれも）。`~/.config/niwaterm/`ディレクトリを監視しており、エディタのatomic save（一時ファイル書き込み→rename）方式でも検知できる。保存直後の複数回のファイルイベントは短時間でまとめられる（デバウンス）。

構文エラーのある内容を保存した場合は、コンソールに警告ログが出た上でデフォルト設定（キーバインド・外観とも）にフォールバックする。「直前の有効な設定を保持する」のではなく、初回読み込み時と同様に毎回デフォルトから解決し直す設計のため、エラーを直して再保存すれば元通り反映される。

`~/.config/niwaterm/`ディレクトリ自体が存在しない場合（未セットアップ）は監視そのものがスキップされ、コンソールにログが出るだけでアプリは通常通り起動する。

## 既知の制約

- **`ctrl`修飾子は未対応**。既存機能がcmd/shift/altしか使っていないため、今回の型・パーサでは対象外（将来Ctrl系のキーバインドが必要になったら拡張する）
- **macOSのOption+文字キーはレイアウト依存でずれる場合がある**。Optionキーを押しながら文字キーを押すと、`e.key`がUnicode記号に変換されることがある（キーボードレイアウト依存）。矢印キーと角括弧（`code`で判定）は影響を受けないが、`cmd+alt+d`のような「Alt+文字キー」の組み合わせは型上書けても実行時に意図通りマッチしない可能性がある
- **ホットリロードのキャッシュバスティングはエントリファイルのみ**。`niwaterm.config.ts`自体の変更は毎回最新の内容を読み込むが、そのファイルが（将来）importする他のヘルパーファイルまで再帰的にキャッシュを無効化するわけではない。設定を複数ファイルに分割している場合、エントリファイル以外の変更はホットリロードで拾えず、アプリの再起動が必要

## スコープ外（roadmap参照）

- `niwaterm init`コマンドによるセットアップ自動化
