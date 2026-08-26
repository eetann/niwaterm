# niwaterm

ターミナル・マルチプレクサ・ワークスペース統合デスクトップアプリ。
Electrobun + libghostty-vt (bun:ffi) + 自前描画(webview) 構成。

- コンセプト: docs/planning/mvp.md
- 進行計画: .rrmap/
- 意思決定記録: docs/adr/
- ビルド・実行手順（macOS/Windowsのプラットフォーム差分・実機確認済み範囲を含む）: docs/build/
- 既知の問題・ハマりどころの記録: docs/known-issues/（何かに詰まったら先にここをgrepする）

## セットアップ・コマンド

- `mise run start` — 現在のブランチに応じてniwatermをdevモードで起動する（`main`ブランチなら普段遣いビルドniwaterm-daily、それ以外（`dev`等）なら開発中ビルドniwaterm-wipとして扱う。WSLならWindows実機へ同期して起動、Macならローカルで起動。GUIアプリなのでbackgroundで実行する）。`NIWATERM_APP_NAME`環境変数でdevチャンネルのままアプリ名だけ変える方式（stable/canaryチャンネルを避けている理由はdocs/known-issues/参照）。electrobun 2.0.1のプロジェクトビルドロックが同一ディレクトリ配下だと同時起動を許さないため（TASK-0056）、wip用はgtrで追加したgit worktree（devブランチ）、daily用はこのリポジトリ本体（mainブランチ、gitのメインワークツリー）という別々の実体で動かす運用にしている。appSupportDir・IPCソケット・WSLブリッジポートもアプリ名別に分離されているため（src/bun/app-paths.ts・ipc-server.ts参照）、実体分離と合わせて両者は干渉しない。**niwaterm-wip（作業・動作確認対象）とniwaterm-daily（ユーザーの常用インスタンス。動作確認では絶対に触らない）を混同しないこと**。Windows実機の停止は現在のブランチに対応する方だけなら`mise run win:stop:mine`、両方まとめてなら`win:stop`。dev側の変更をdaily側へ取り込むにはdaily側（mainブランチ）で`mise run daily:merge-dev`（ff-onlyマージ+`bun install`）。**ただしproject_root分離だけでは`electrobun dev`自体の同時起動はできない**（Hutchが`~/.hutch/state/locks/graph.lock`というユーザー単位のグローバルロックも持つため、TASK-0058）。wip・dailyを本当に同時に動かしたい場合は、両方を順番にビルドしてから`mise run win:start:built`でビルド済みlauncher.exeをHutch非経由で直接起動する（詳細: docs/build/windows-build.md）
- `bun run build:native` — Cシム（src/native/shim.c）をmacOS向けにビルド
- `bun run build:vendor:win` / `bun run build:native:win` — Windows向けのlibghostty-vt / シムをLinux・WSLからクロスビルド（詳細: docs/build/windows-build.md）
- `bun run lint` / `bun run lint:fix` — oxlintによる静的解析（チェックのみ / 自動修正あり）
- `bun run format` / `bun run format:check` — oxfmtによるフォーマット（書き込みあり / チェックのみ）
- `vendor/libghostty/` はgitignore。再現手順・vendorの更新が必要かの見分け方: docs/build/macos-build.md
  （要点: `mise exec zig@0.16.0 -- zig build -Demit-lib-vt --prefix <repo>/vendor/libghostty`。ghosttyソースは `opensrc path ghostty-org/ghostty` で取得。**Zig 0.16.0以上が必要**）

## アーキテクチャ

```
PTY(Bun.Terminal) → libghostty-vt(bun:ffi) → formatter(HTML) → RPC → webview表示
キー入力: webview keydown → RPC(input) → PTY
```

- src/bun/ghostty.ts — libghostty-vtのFFIラッパー（createGhosttyTerminalファクトリ関数）
- src/bun/pty.ts — Bun.Terminal（Bun 1.3.5+）ベースのPTY（createPtyファクトリ関数）
- src/bun/terminal-session.ts — PTY+GhosttyTerminalを束ねる薄い層。index.tsはこれ経由でのみターミナルを扱う
- src/bun/index.ts — メインプロセス。RPCスキーマ(NiwaRPC)もここ
- src/bun/ipc-server.ts — CLI(`niwaterm`コマンド)からの接続を受け付けるunix socket IPCサーバー（`Bun.serve({unix, fetch})` + Hono、createIpcServerファクトリ関数）。ソケットパスはmacOSが`~/Library/Application Support/niwaterm/niwaterm.sock`、Windowsが`%APPDATA%\niwaterm\niwaterm.sock`（src/bun/app-paths.tsで解決）。このパス解決はpackages/cli/src/ipc-client.tsに**意図的に重複**しているので、変更時は両方揃えること
- packages/cli（`@niwaterm/cli`） — `niwaterm` CLI本体。gunshiのsubCommands構成（詳細: docs/guide/cli.md、CLIからも`niwaterm docs show cli`で参照可能。AIエージェント向け操作ガイドは.claude/skills/niwaterm-cli/SKILL.md）。コマンドの命名規則は.claude/rules/cli-command-naming.md参照（コマンド追加・変更時は必読）
- src/mainview/ — webview側（描画・キー入力・セル計測）
- libghostty-vt APIリファレンス: https://libghostty.tip.ghostty.org/ （APIは未安定。ヘッダは vendor/libghostty/include/ghostty/vt/）

## Electrobunのハマりどころ（実測済み）

- **アプリコードはBun Workerで実行される**。node-ptyはWorker内でonDataが発火しないため使えない → `Bun.Terminal`はWorker内でも`data`/`exit`コールバックが正常発火する（src/bun/pty.ts）。ネイティブモジュール全般はWorkerでの動作確認が必要
- **`index.html` に `<script type="module" src="index.js"></script>` を自分で書く**。electrobun.config.tsのviews設定だけではJSが実行されない（hello-worldテンプレはこれが抜けている）
- **webviewのconsole.logはdev出力に出ない**。デバッグはRPCの `log` メッセージでbun側consoleへ転送する（実装済み）
- **キーボード入力には明示的なフォーカスが必要**: bun側 `mainWindow.activate()` + webview側 `tabIndex=-1` と `focus()`（実装済み）
- electrobun.config.ts の `copy` の出力先は `Resources/app/` 基準の相対パス
- bundlerは依存の `__dirname` をリポジトリ絶対パス（node_modules内）に焼き込む。実行時のファイル解決に注意
- devアプリのプロセス名は "bun"（osascriptでの操作時）。停止は `pkill -f 'niwaterm-wip-dev.app'`。他の自作Electrobunアプリも同時に動いていると同名"bun"プロセスが複数存在し、さらに1プロセスが名前なしヘルパーウィンドウ＋本体ウィンドウの複数を持つことがある。正確な絞り込み方はmacos-gui-testingスキル参照
- **アプリメニューが無いとCmd+C/Cmd+V等がWebViewに届かない**（macOSのkey equivalentはメニュー経由）。`ApplicationMenu.setApplicationMenu` でEditメニューを `role: "copy"/"paste"` + `accelerator: "Command+C"` 形式で設定する（実装済み、src/bun/index.ts冒頭）
- **`buildFolder`配下は"{channel}-{os}-{arch}"単位でビルドの度に丸ごと削除・作り直される（アプリ名は含まれない）**。同じ`build/`のまま別アプリ名（開発中ビルドniwaterm-wip-devと普段遣いビルドniwaterm-daily-dev等）を同時にビルドすると、片方のビルド中にもう片方の成果物ごと削除され、起動中プロセスがファイルをロックしているとEACCESで失敗する。アプリ名ごとに`build.buildFolder`自体を分けて回避する（実装済み、electrobun.config.ts）

## プラットフォーム対応

macOSとWindows（x64）に対応する。Windowsは起動・ターミナル・タイル分割・IPC/CLI・ブラウザタブ・
customViewまで実機確認済み（`browser screenshot`のみBun本体側の既知issueで動作しない）。
OS差分（ネイティブ成果物の配置、DLL依存解決順、キーバインドテーブル等）・実機確認済み範囲の詳細は
docs/build/windows-build.md、既知の不具合は docs/known-issues/ 参照。

## bun:ffiのハマりどころ

- **構造体の値渡し非対応**。値渡しAPI（ghostty_formatter_terminal_new等）はsrc/native/shim.cでスカラー引数に展開する。値渡しAPIが増えたらシムに追加
  （`ghostty_terminal_new`はlibghostty-vt側がスカラー引数化したためシム不要になった。代わりにスクロールバック上限は`ghostty_terminal_set(OPT_SCROLLBACK_MAX_LINES)`で設定する）
- コールバックはJSCallbackで渡せる（ghostty_terminal_setのWRITE_PTYで使用中）
- libghostty-vtのAPIは未安定。シンボルが消えることがある（例: `ghostty_terminal_mode_get`は廃止され、`ghostty_terminal_get(DATA_MODE)`に`GhosttyTerminalModeConfig`を渡す形になった）。
  dlopen時に存在しないシンボルを要求すると起動時に落ちるため、vendor更新後は`nm -D --defined-only`でエクスポートを確認する

## 既知の未対応（roadmap参照）

- 全角文字は描画後に `<span class="wide">` ラップで2セル幅を強制している（src/mainview/index.ts fixWideChars）。絵文字のグラフェムクラスタ（結合絵文字）は未対応
- 描画中（連続出力中）のinnerHTML置換でマウス選択が消える（アイドル時の選択コピーは動く）
