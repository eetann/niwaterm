# niwaterm

ターミナル・マルチプレクサ・ワークスペース統合デスクトップアプリ。
Electrobun + libghostty-vt (bun:ffi) + 自前描画(webview) 構成。

- コンセプト: docs/mvp.md
- 意思決定記録: docs/adr/

## セットアップ・コマンド

- `bun run start` — devモードでアプリ起動（GUIアプリなのでbackgroundで実行する）
- `bun run build:native` — Cシム（src/native/shim.c）をビルド
- `bun run lint` / `bun run lint:fix` — oxlintによる静的解析（チェックのみ / 自動修正あり）
- `bun run format` / `bun run format:check` — oxfmtによるフォーマット（書き込みあり / チェックのみ）
- `vendor/libghostty/` はgitignore。再現手順:
  `mise exec zig@0.15.2 -- zig build -Demit-lib-vt --prefix <repo>/vendor/libghostty`（ghosttyソースは `opensrc path ghostty-org/ghostty` で取得）

## アーキテクチャ

```
PTY(Bun.Terminal) → libghostty-vt(bun:ffi) → formatter(HTML) → RPC → webview表示
キー入力: webview keydown → RPC(input) → PTY
```

- src/bun/ghostty.ts — libghostty-vtのFFIラッパー（createGhosttyTerminalファクトリ関数）
- src/bun/pty.ts — Bun.Terminal（Bun 1.3.5+）ベースのPTY（createPtyファクトリ関数）
- src/bun/terminal-session.ts — PTY+GhosttyTerminalを束ねる薄い層。index.tsはこれ経由でのみターミナルを扱う
- src/bun/index.ts — メインプロセス。RPCスキーマ(NiwaRPC)もここ
- src/bun/ipc-server.ts — CLI(`niwaterm`コマンド)からの接続を受け付けるunix socket IPCサーバー（`Bun.serve({unix, fetch})` + Hono、createIpcServerファクトリ関数）。ソケットパスは`~/Library/Application Support/niwaterm/niwaterm.sock`固定
- packages/cli（`@niwaterm/cli`） — `niwaterm` CLI本体。gunshiのsubCommands構成（詳細: docs/cli.md、CLIからも`niwaterm docs show cli`で参照可能。AIエージェント向け操作ガイドは.claude/skills/niwaterm-cli/SKILL.md）
- src/mainview/ — webview側（描画・キー入力・セル計測）
- libghostty-vt APIリファレンス: https://libghostty.tip.ghostty.org/ （APIは未安定。ヘッダは vendor/libghostty/include/ghostty/vt/）

## Electrobunのハマりどころ（実測済み）

- **アプリコードはBun Workerで実行される**。node-ptyはWorker内でonDataが発火しないため使えない → `Bun.Terminal`はWorker内でも`data`/`exit`コールバックが正常発火する（src/bun/pty.ts）。ネイティブモジュール全般はWorkerでの動作確認が必要
- **`index.html` に `<script type="module" src="index.js"></script>` を自分で書く**。electrobun.config.tsのviews設定だけではJSが実行されない（hello-worldテンプレはこれが抜けている）
- **webviewのconsole.logはdev出力に出ない**。デバッグはRPCの `log` メッセージでbun側consoleへ転送する（実装済み）
- **キーボード入力には明示的なフォーカスが必要**: bun側 `mainWindow.activate()` + webview側 `tabIndex=-1` と `focus()`（実装済み）
- electrobun.config.ts の `copy` の出力先は `Resources/app/` 基準の相対パス
- bundlerは依存の `__dirname` をリポジトリ絶対パス（node_modules内）に焼き込む。実行時のファイル解決に注意
- devアプリのプロセス名は "bun"（osascriptでの操作時）。停止は `pkill -f 'niwaterm-dev.app'`。他の自作Electrobunアプリも同時に動いていると同名"bun"プロセスが複数存在し、さらに1プロセスが名前なしヘルパーウィンドウ＋本体ウィンドウの複数を持つことがある。正確な絞り込み方はmacos-gui-testingスキル参照
- **アプリメニューが無いとCmd+C/Cmd+V等がWebViewに届かない**（macOSのkey equivalentはメニュー経由）。`ApplicationMenu.setApplicationMenu` でEditメニューを `role: "copy"/"paste"` + `accelerator: "Command+C"` 形式で設定する（実装済み、src/bun/index.ts冒頭）

## bun:ffiのハマりどころ

- **構造体の値渡し非対応**。値渡しAPI（ghostty_terminal_new等）はsrc/native/shim.cでスカラー引数に展開する。値渡しAPIが増えたらシムに追加
- コールバックはJSCallbackで渡せる（ghostty_terminal_setのWRITE_PTYで使用中）

## 既知の未対応（roadmap参照）

- 全角文字は描画後に `<span class="wide">` ラップで2セル幅を強制している（src/mainview/index.ts fixWideChars）。絵文字のグラフェムクラスタ（結合絵文字）は未対応
- 描画中（連続出力中）のinnerHTML置換でマウス選択が消える（アイドル時の選択コピーは動く）
