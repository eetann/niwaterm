# niwaterm

ターミナル・マルチプレクサ・ワークスペース統合デスクトップアプリ。
Electrobun + libghostty-vt (bun:ffi) + 自前描画(webview) 構成。

- コンセプト: docs/planning/mvp.md
- 進行計画: .rrmap/
- 意思決定記録: docs/adr/
- ビルド・実行手順（macOS/Windowsのプラットフォーム差分）: docs/build/
- 既知の問題・ハマりどころの記録: docs/known-issues/（何かに詰まったら先にここをgrepする）

## セットアップ・コマンド

- `mise run start` — 現在のブランチに応じてniwatermをdevモードで起動する（`main`ならniwaterm-daily、それ以外ならniwaterm-wip）。WSLならWindows実機へ同期、Macならローカルで起動する（GUIアプリなのでbackgroundで実行する）
  - **niwaterm-wip（作業・動作確認対象）とniwaterm-daily（ユーザーの常用インスタンス。動作確認では絶対に触らない）を混同しないこと**
  - wip/dailyの同時起動の制約・停止・daily側への取り込み手順の詳細: docs/build/windows-build.md
- `mise run cli:link` — 現在のワークツリーのniwaterm CLIをリンクする。**`main`（daily側）なら`niwaterm`、それ以外（devワークツリー＝wip）なら`niwaterm-dev`**という別名になる
  - **wipの動作確認では必ず`niwaterm-dev`を使う**。`niwaterm`はdaily側のソースを指すため、devブランチでCLIを直しても反映されない（`bun link`はパッケージ名が同じで`niwaterm`を奪い合うので、別名のラッパーで棲み分けている）
  - `niwaterm-dev`は接続先もniwaterm-wipが既定。タブ内から叩く場合はアプリが注入した自インスタンスが優先される
- `bun run build:native` — Cシム（src/native/shim.c）とPTYの制御端末ラッパー（src/native/ptyexec.c）をmacOS向けにビルド
- `bun run build:vendor:win` / `bun run build:native:win` — Windows向けのlibghostty-vt / シムをLinux・WSLからクロスビルド（詳細: docs/build/windows-build.md）
- `bun run lint` / `bun run lint:fix` — oxlintによる静的解析（チェックのみ / 自動修正あり）
- `bun run format` / `bun run format:check` — oxfmtによるフォーマット（書き込みあり / チェックのみ）
- `vendor/libghostty/` はgitignore。再現手順・vendorの更新が必要かの見分け方: docs/build/macos-build.md（**Zig 0.16.0以上が必要**）

## アーキテクチャ

```
PTY(Bun.Terminal) → libghostty-vt(bun:ffi) → formatter(HTML) → RPC → webview表示
キー入力: webview keydown → RPC(input) → PTY
```

- src/bun/ghostty.ts — libghostty-vtのFFIラッパー（createGhosttyTerminalファクトリ関数）
- src/bun/pty.ts — Bun.Terminal（Bun 1.3.5+）ベースのPTY（createPtyファクトリ関数）
- src/bun/terminal-session.ts — PTY+GhosttyTerminalを束ねる薄い層。index.tsはこれ経由でのみターミナルを扱う
- src/bun/index.ts — メインプロセス。RPCスキーマ(NiwaRPC)もここ
- src/bun/ipc-server.ts — CLI(`niwaterm`コマンド)からの接続を受け付けるunix socket IPCサーバー（`Bun.serve({unix, fetch})` + Hono、createIpcServerファクトリ関数）。ソケットパスはアプリ名(APP_VARIANT)別に分かれ、macOSが`~/Library/Application Support/<APP_VARIANT>/niwaterm.sock`、Windowsが`%APPDATA%\<APP_VARIANT>\niwaterm.sock`（src/bun/app-paths.tsで解決）。**APP_VARIANTはappフォルダ名(`niwaterm-wip-dev`)ではなくelectrobun.config.tsのapp.nameそのもの(`niwaterm-wip`/`niwaterm-daily`)で、"-dev"は付かない**。このパス解決はpackages/cli/src/ipc-client.tsに**意図的に重複**しているので、変更時は両方揃えること
- packages/cli（`@niwaterm/cli`） — `niwaterm` CLI本体。gunshiのsubCommands構成（詳細: docs/guide/cli.md、CLIからも`niwaterm docs show cli`で参照可能。AIエージェント向け操作ガイドは.claude/skills/niwaterm-cli/SKILL.md）。コマンドの命名規則は.claude/rules/cli-command-naming.md参照（コマンド追加・変更時は必読）
- src/mainview/ — webview側（描画・キー入力・セル計測）
- libghostty-vt APIリファレンス: https://libghostty.tip.ghostty.org/ （APIは未安定。ヘッダは vendor/libghostty/include/ghostty/vt/）

## Electrobunのハマりどころ

- **アプリコードはBun Workerで実行される**。ネイティブモジュールはWorker内でコールバックが無言で発火しないことがあるため、採用前に動作確認する
- **キーボード入力には明示的なフォーカスが必要**（ウィンドウのフォアグラウンド化とwebview内DOM要素への`focus()`は別物）
- electrobun.config.ts の `copy` の出力先は `Resources/app/` 基準の相対パス
- bundlerは依存の `__dirname` をリポジトリ絶対パス（node_modules内）に焼き込む。実行時のファイル解決に注意
- devアプリのプロセス名は "bun"（osascriptでの操作時）。停止は `pkill -f 'niwaterm-wip-dev.app'`。他の自作Electrobunアプリも同時に動いていると同名"bun"プロセスが複数存在し、さらに1プロセスが名前なしヘルパーウィンドウ＋本体ウィンドウの複数を持つことがある。正確な絞り込み方はmacos-gui-testingスキル参照

## プラットフォーム対応

macOSとWindows（x64）に対応する。`browser screenshot`のみBun本体側の既知issueでWindowsでは動作しない。
OS差分（ネイティブ成果物の配置、DLL依存解決順、キーバインドテーブル等）の詳細は
docs/build/windows-build.md、既知の不具合は docs/known-issues/ 参照。

## bun:ffiのハマりどころ

- **構造体の値渡し非対応**。値渡しAPI（ghostty_formatter_terminal_new等）はsrc/native/shim.cでスカラー引数に展開する。値渡しAPIが増えたらシムに追加
- **引数10個以上の関数は正しく呼べない**（9個まで。10個目以降がゴミ値になり、ポインタ引数ならセグフォで落ちる）。項目が多いAPIはint32を並べた構造体をポインタ1つで渡す（`niwa_dump_selection`がこの形）。詳細: docs/known-issues/bun-ffi-breaks-with-ten-or-more-args.md
- コールバックはJSCallbackで渡せる（ghostty_terminal_setのWRITE_PTYで使用中）
- libghostty-vtのAPIは未安定でシンボルが消えることがある。dlopen時に存在しないシンボルを要求すると
  起動時に落ちるため、vendor更新後は`nm -D --defined-only`でエクスポートを確認する

## 既知の未対応（roadmap参照）

- 描画後のHTMLはsrc/mainview/index.ts fixGlyphsで補正している。全角文字は `<span class="wide">` ラップで2セル幅を強制（絵文字のグラフェムクラスタ＝結合絵文字は未対応）、罫線・ブロック文字は `<span class="cell-glyph">` ラップ＋transformで行の高さいっぱいへ引き伸ばす（フォントのグリフのままだと行間の分だけ上下に隙間ができるため。判定と変換の計算はsrc/mainview/cell-glyph.ts）
- 描画中（連続出力中）のinnerHTML置換でマウス選択が消える（アイドル時の選択コピーは動く）
