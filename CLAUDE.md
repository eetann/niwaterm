# niwaterm

ターミナル・マルチプレクサ・ワークスペース統合デスクトップアプリ。
Electrobun + libghostty-vt (bun:ffi) + 自前描画(webview) 構成。

- コンセプト: docs/mvp.md
- 進行計画: .mywork/tmp/roadmap.md（h2セクション1つ = 1セッションの作業単位。完了したらチェックを付ける）
- アーキテクチャ決定の経緯: .mywork/work-log/、意思決定記録: docs/adr/

## セットアップ・コマンド

- `bun run start` — devモードでアプリ起動（GUIアプリなのでbackgroundで実行する）
- `bun run build:native` — Cシム（src/native/shim.c）をビルド
- `vendor/libghostty/` はgitignore。再現手順:
  `mise exec zig@0.15.2 -- zig build -Demit-lib-vt --prefix <repo>/vendor/libghostty`（ghosttyソースは `opensrc path ghostty-org/ghostty` で取得）

## アーキテクチャ

```
PTY(shim.c forkpty) → libghostty-vt(bun:ffi) → formatter(HTML) → RPC → webview表示
キー入力: webview keydown → RPC(input) → PTY
```

- src/bun/ghostty.ts — libghostty-vtのFFIラッパー（GhosttyTerminalクラス）
- src/bun/pty.ts — シムベースのPTY（Ptyクラス）
- src/bun/index.ts — メインプロセス。RPCスキーマ(NiwaRPC)もここ
- src/mainview/ — webview側（描画・キー入力・セル計測）
- libghostty-vt APIリファレンス: https://libghostty.tip.ghostty.org/ （APIは未安定。ヘッダは vendor/libghostty/include/ghostty/vt/）

## Electrobunのハマりどころ（実測済み）

- **アプリコードはBun Workerで実行される**。node-ptyはWorker内でonDataが発火しないため使えない → シムのforkpty + node:fsのread/writeで自前実装済み。ネイティブモジュール全般はWorkerでの動作確認が必要
- **`index.html` に `<script type="module" src="index.js"></script>` を自分で書く**。electrobun.config.tsのviews設定だけではJSが実行されない（hello-worldテンプレはこれが抜けている）
- **webviewのconsole.logはdev出力に出ない**。デバッグはRPCの `log` メッセージでbun側consoleへ転送する（実装済み）
- **キーボード入力には明示的なフォーカスが必要**: bun側 `mainWindow.activate()` + webview側 `tabIndex=-1` と `focus()`（実装済み）
- electrobun.config.ts の `copy` の出力先は `Resources/app/` 基準の相対パス
- bundlerは依存の `__dirname` をリポジトリ絶対パス（node_modules内）に焼き込む。実行時のファイル解決に注意
- devアプリのプロセス名は "bun"（osascriptでの操作時）。停止は `pkill -f 'niwaterm-dev.app'`
- **アプリメニューが無いとCmd+C/Cmd+V等がWebViewに届かない**（macOSのkey equivalentはメニュー経由）。`ApplicationMenu.setApplicationMenu` でEditメニューを `role: "copy"/"paste"` + `accelerator: "Command+C"` 形式で設定する（実装済み、src/bun/index.ts冒頭）

## bun:ffiのハマりどころ

- **構造体の値渡し非対応**。値渡しAPI（ghostty_terminal_new等）はsrc/native/shim.cでスカラー引数に展開する。値渡しAPIが増えたらシムに追加
- コールバックはJSCallbackで渡せる（ghostty_terminal_setのWRITE_PTYで使用中）

## 既知の未対応（roadmap参照）

- 全角文字は描画後に `<span class="wide">` ラップで2セル幅を強制している（src/mainview/index.ts fixWideChars）。絵文字のグラフェムクラスタ（結合絵文字）は未対応
- 描画中（連続出力中）のinnerHTML置換でマウス選択が消える（アイドル時の選択コピーは動く）
