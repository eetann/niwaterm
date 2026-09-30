---
title: セットアップ
description: niwaterm CLIのリンクと設定ディレクトリの作成、設定ファイルのホットリロードと現在値の確認
---

niwatermを使い始めるには、`niwaterm`コマンド（CLI）を使えるようにしてから、設定ファイルを置くディレクトリを作る。アプリのビルドと起動がまだなら、先に[インストール](/niwaterm/installation/)を済ませる。

## CLIを使えるようにする

リポジトリのルートで次を実行する。

```sh
cd packages/cli
bun link
```

`bin`フィールド経由で`niwaterm`コマンドがグローバル（`~/.bun/bin`）に登録される。`~/.bun/bin`がPATHに含まれていない場合は追加する。

このリポジトリの絶対パスに依存するシンボリックリンクになるため、リポジトリを移動・削除すると`niwaterm`コマンドは壊れる。

アプリが起動していれば、`niwaterm ping`で繋がるか確かめられる。`pong (pid …)`が返れば使える状態になっている。

### Windowsの場合

Windowsでは、[インストール](/niwaterm/installation/#windows)でコピーした先（`%USERPROFILE%\niwaterm-worktrees\niwaterm`）の`packages\cli`で、PowerShellから`bun link`を実行する。niwatermのタブで開くPowerShellからはこれで使える。

WSLのディストロをタブで開いて使う場合、ディストロの中はWindowsとは別の環境なので、WSL側のリポジトリでも同じように`bun link`する。WSL側からも、Windowsで動いているniwatermへそのまま繋がる。

## 設定ディレクトリを作る

niwatermの設定はTypeScriptで書く。設定ディレクトリ（`~/.config/niwaterm/`）を小さなNodeプロジェクトとして扱い、型定義・ヘルパー関数は`@niwaterm/config`パッケージから提供する。これによりTypeScript LSPの標準機能（型補完・定義ジャンプ）がそのまま使える。

キーバインドに加えて、フォント・カラーテーマなどの外観も設定できる。設定ファイルの変更は再起動なしで反映される（ホットリロード）。

`niwaterm init`を実行する。

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

## ホットリロード

`~/.config/niwaterm/niwaterm.config.ts`を保存すると、アプリを再起動せずに変更が反映される（キーバインド・外観・customViewsいずれも）。`~/.config/niwaterm/`ディレクトリをサブディレクトリ含めて監視しており、エディタのatomic save（一時ファイル書き込み→rename）方式でも検知できる。保存直後の複数回のファイルイベントは短時間でまとめられる（デバウンス）。

設定を複数ファイルへ分割している場合（[「複数ファイルへの分割」節](/niwaterm/keybindings/#複数ファイルへの分割)参照）、エントリファイル以外の`.ts`/`.js`等の変更もホットリロード対象になる。読み込みのたびに`~/.config/niwaterm/`配下のソースファイルを一時ディレクトリへコピーしてからimportし直すことで、importツリー全体を最新の内容に差し替えている（`node_modules`は巨大になりうるためコピーせずシンボリックリンクで参照する）。

読み込めない内容（構文エラー、存在しないモジュールのimport等）を保存した場合は、**直前に読み込めた設定のまま動き続ける**。デスクトップ通知で理由を知らせ、`niwaterm config show`と設定モーダルの「読み込みエラー」にも同じ内容が出る。エラーを直して再保存すればその時点の内容が反映され、復帰したことも通知される（通知はエラーの内容が変わったときだけ出るので、直し途中の保存で繰り返し鳴ることはない）。

デフォルトへ落ちるのは、まだ一度も設定を適用できていない場合（＝起動直後の初回読み込みから失敗している場合）だけ。設定ファイルの一部の誤りでprefixもテーマもカスタムビューも同時に消えると、編集を戻すための操作すら効かなくなるため、適用済みの設定を優先して残す。

`~/.config/niwaterm/`ディレクトリ自体が存在しない場合（未セットアップ）は監視そのものがスキップされ、コンソールにログが出るだけでアプリは通常通り起動する。

ファイル監視による自動リロードのほか、`reload-config`アクション（コマンドパレット、または`niwa.keybind`で割り当てたキー）から同じ処理を手動で呼び出すこともできる。挙動は保存時の自動リロードと同一（読み込めた場合は毎回デフォルトから解決し直すため、`niwa.keybind`/`niwa.unbind`で加えた変更をconfigファイルから削除して再読み込みすれば、その分は未設定またはデフォルトの割り当てに戻る）。

## 現在の設定値を確認する

マージ後の実際に効いている値は、アプリ内のモーダル（prefix + `i`の`show-config`アクション、またはコマンドパレットの「Show Settings」）か、CLIの`niwaterm config show`で確認できる。設定ファイルに書いていない項目も既定値として出るため、「書いたつもりが反映されていない」の切り分けに使える。

設定値の一覧より前に、直近の読み込みが失敗していればその理由（「読み込みエラー」）と、既定値へ落とした項目・無視した項目の一覧（「無視した設定」）が出る。不正な値はその項目だけを落として残りは活かす設計のため、「書いたのに効かない」ときはまずここを見る。

キーバインドの個々の割り当てはここには出ない（件数のみ）。一覧は`niwaterm keybind list`で確認する。関数で書く設定（`mouse.selectionMenu`・`worktree.onCreate`・`worktree.onOpen`・`worktree.onBeforeRemove`・`worktree.onRemove`・`niwa.on`のハンドラ）も値として表示できないため含まない。
