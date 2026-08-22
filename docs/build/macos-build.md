---
type: Runbook
title: macOSでのビルド・実行手順
description: macOS実機でniwatermをビルド・実行するための手順（ネイティブライブラリのローカルビルド含む）
---

# macOSでのビルド・実行手順

macOSでniwatermをビルド・実行するための手順。

## 全体像

macOSはWindowsと違い、アプリ本体もネイティブライブラリ（libghostty-vt / shim）もすべて
**ローカル環境だけでビルドが完結する**（クロスコンパイル不要）。

```
opensrc でghosttyソース取得
  └─ zig build (ローカル) ──▶ vendor/libghostty/lib/libghostty-vt.dylib
                          └─▶ vendor/libghostty/include/
cc (shimビルド) ──▶ vendor/libghostty/lib/libniwashim.dylib
electrobun dev  ← アプリ起動
```

## 1. 前提を整える

| ツール                       | 用途                                   | 確認コマンド    |
| ----------------------------- | -------------------------------------- | --------------- |
| Bun                            | ランタイム                             | `bun --version` |
| Xcode Command Line Tools（`cc`） | shim（`src/native/shim.c`）のビルド    | `cc --version`  |
| mise                           | Zigのバージョン管理                    | `mise --version`|
| Zig 0.16.0以上                 | libghostty-vtのビルド（`build.zig` が `minimum_zig_version = 0.16.0` を要求する） | `mise exec zig@0.16.0 -- zig version` |

Zigはmiseがオンデマンドでインストールしてくれるので、事前に個別インストールする必要はない
（`mise exec zig@0.16.0 -- ...` の初回実行時に自動で入る）。

## 2. ネイティブライブラリをビルドする

`vendor/` は `.gitignore` 対象なので、**各環境・各clone先で自分でビルドする**必要がある。

### 2-1. ghosttyのソースを取得する

```bash
opensrc path ghostty-org/ghostty   # 取得先パスが返る
```

初回は数分かかる（ghosttyリポジトリはそこそこ大きい）。

> **キャッシュが古いと気づかず古いAPIのままビルドしてしまう**。
> `opensrc path` は一度取得済みだとキャッシュされたパスを即座に返すだけで、
> 最新化はしてくれない。libghostty-vt側でAPI変更があった後にvendorを再生成したい場合は、
> 先にキャッシュを消してから取り直す:
>
> ```bash
> opensrc remove ghostty-org/ghostty
> opensrc path ghostty-org/ghostty
> ```

### 2-2. libghostty-vt をビルドする（vendor生成）

取得したghosttyソースのディレクトリに移動して実行する:

```bash
cd $(opensrc path ghostty-org/ghostty)
mise exec zig@0.16.0 -- zig build -Demit-lib-vt --prefix <このリポジトリの絶対パス>/vendor/libghostty
```

生成物:

```
vendor/libghostty/lib/libghostty-vt.dylib   ← 実行時に必要
vendor/libghostty/include/                  ← ヘッダ（shimのビルドに必要）
```

### 2-3. shim をビルドする

```bash
bun run build:native
```

中身は次のコマンド（`package.json` 参照）:

```bash
cc -dynamiclib -Ivendor/libghostty/include src/native/shim.c \
  -Lvendor/libghostty/lib -lghostty-vt -Wl,-rpath,@loader_path \
  -o vendor/libghostty/lib/libniwashim.dylib
```

生成物: `vendor/libghostty/lib/libniwashim.dylib`

## 3. 起動する

```bash
bun run start
```

GUIアプリなのでフォアグラウンドで実行するとブロックする。バックグラウンド実行や
別ターミナルからの起動が扱いやすい。終了は `pkill -f 'niwaterm-dev.app'`。

### 普段遣い用ビルドを同時に動かす

niwaterm自体の開発中は上記のdevビルド（appフォルダ名`niwaterm-dev`）を使う一方、
日常の作業には別途起動した普段遣い用ビルド（appフォルダ名`niwaterm-daily-dev`）を使うと、
開発中の不具合や再起動で普段の作業が巻き込まれない。

普段遣い用も**devチャンネルのままアプリ名だけ`NIWATERM_APP_NAME`環境変数で変える**方式を採る
（stable/canaryチャンネルは配布用インストーラ作成が目的でビルド後すぐ直接実行できるappバンドルを
作らないため採用していない。詳細: [Windowsのstable/canaryビルドはそのまま直接実行できる展開済みappバンドルを作らない](/known-issues/windows-stable-build-not-directly-runnable.md)、
macOSでも同じ設計上の制約が該当する）。設定ファイル・IPCソケットはアプリ名別に分離されている
（`src/bun/app-paths.ts`参照）ため、devビルドと同時に起動しても干渉しない。

```bash
mise run start:daily   # NIWATERM_APP_NAME=niwaterm-daily bun x electrobun dev と同義
```

## vendorの更新が必要かどうかの見分け方

`src/bun/ghostty.ts` や `src/native/shim.c` がlibghostty-vtの新しいAPIに追随するコミットの後、
**手元の `vendor/libghostty` を再生成し忘れる**とコードとdylibのAPIがズレる。
`dlopen` は型チェックをしないため、ズレていても `build:native` 自体はエラーなく通ってしまい、
実行時のFFI呼び出しでクラッシュ・不正な値になって初めて気づく、という事故が起きやすい。

再生成が必要かどうかは、廃止/変更されたシンボルが手元のdylibにまだ残っているかで判断できる:

```bash
nm -gU vendor/libghostty/lib/libghostty-vt.0.1.0.dylib | grep ghostty_terminal
```

例えば `ghostty_terminal_mode_get` は将来的に `ghostty_terminal_get(DATA_MODE)` へ統合されて
廃止されている。このシンボルがまだ残っている＝手元のvendorがコードより古い、という合図になる。
併せてヘッダの関数シグネチャも確認できる:

```bash
grep -n -A3 "ghostty_terminal_new" vendor/libghostty/include/ghostty/vt/terminal.h
```

疑わしい場合は「1. 前提を整える」〜「2. ネイティブライブラリをビルドする」を最初からやり直す。

## トラブルシューティング

| 症状                                                              | 原因・対処                                                                                                       |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| `zig build` が `does not meet the required build version of v0.16.0` で失敗 | Zig 0.15系を使っている。`mise exec zig@0.16.0 --` を使う                                                          |
| `cc: command not found`                                            | Xcode Command Line Toolsが未導入。`xcode-select --install`                                                        |
| `vendor/libghostty/lib が見つからない`（`ghostty.ts` の起動時エラー） | `build:native` の前に「2-2. libghostty-vt をビルドする」が未実施                                                  |
| 起動はするがターミナル入出力がおかしい・即クラッシュする           | vendorがコードより古い可能性が高い。上記「vendorの更新が必要かどうかの見分け方」で確認する                        |
| `opensrc path` が古いバージョンのソースを返しているように見える    | キャッシュ済みで最新化されていない。`opensrc remove ghostty-org/ghostty` してから取り直す                         |

## 参考

- Windows向けのビルド手順: [docs/windows-build.md](./windows-build.md)（WSL/Linux側からのクロスビルドが必要な点が異なる）
