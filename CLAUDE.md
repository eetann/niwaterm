# niwaterm

ターミナル・マルチプレクサ・ワークスペース統合デスクトップアプリ。
Electrobun + libghostty-vt (bun:ffi) + 自前描画(webview) 構成。

- コンセプト: docs/planning/mvp.md
- 進行計画: docs/planning/roadmap.md（h2セクション1つ = 1セッションの作業単位。完了したらチェックを付ける）
- 意思決定記録: docs/adr/

## セットアップ・コマンド

- `bun run start` — devモードでアプリ起動（GUIアプリなのでbackgroundで実行する）
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
- src/bun/ipc-server.ts — CLI(`niwaterm`コマンド)からの接続を受け付けるunix socket IPCサーバー（`Bun.serve({unix, fetch})` + Hono、createIpcServerファクトリ関数）。ソケットパスはmacOSが`~/Library/Application Support/niwaterm/niwaterm.sock`、Windowsが`%APPDATA%\niwaterm\niwaterm.sock`（src/bun/app-paths.tsで解決）
- packages/cli（`@niwaterm/cli`） — `niwaterm` CLI本体。gunshiのsubCommands構成（詳細: docs/guide/cli.md、CLIからも`niwaterm docs show cli`で参照可能。AIエージェント向け操作ガイドは.claude/skills/niwaterm-cli/SKILL.md）
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

## プラットフォーム対応

macOSとWindows（x64）に対応する。Windowsは起動・ターミナル・タイル分割・IPC/CLI・ブラウザタブ・
customViewまで実機確認済み。`browser-screenshot`のみBun本体側の既知issue（Windows上でChrome/Edgeの
自動起動に失敗する、oven-sh/bun#29102）により動作しない。手順とハマりどころ: docs/build/windows-build.md

- **Electrobunはクロスビルド不可**。アプリ本体はWindows実機でビルドする。一方ネイティブ成果物（libghostty-vt / シム）はzigでLinux・WSLからクロスコンパイルできるため、Windows側にzigやMSVCは要らない
- **ネイティブ成果物の命名・配置がOSで異なる**: macOS `lib/libghostty-vt.dylib`・`lib/libniwashim.dylib` / Windows `bin/ghostty-vt.dll`・`bin/niwashim.dll`（zigはWindowsのみDLL本体をbin/へ出し、lib/にはリンク用の.libを置く）。分岐はsrc/bun/ghostty.tsの`nativeLayout`
- **WindowsのDLL依存解決順に注意**。`niwashim.dll`は`ghostty-vt.dll`に依存するが、WindowsのローダーはDLL自身と同じディレクトリを依存解決の対象にしない（`@loader_path`相当が無い）。ghostty.tsは**ghostty-vtを先にdlopenする**ことで解決している。順序を戻すと`error code 126`（ERROR_MOD_NOT_FOUND）で起動時に落ちる
- **Bun.TerminalのWindows対応（ConPTY）はBun 1.3.14+**。ここで効くのは開発機のBunではなく**Electrobunがアプリへ同梱するBun**で、1.18.1の同梱版は1.3.13。`electrobun.config.ts` の `build.bunVersion` で上書きしている（外すと`PTY not supported on this platform`で落ちる）
- **キーバインドはOSで別テーブル**: macOSはcmd系、Windowsはctrl+shift系（`defaultKeybindings` / `defaultWindowsKeybindings`）。ctrl単独はCtrl+C/Ctrl+D/Ctrl+B等ターミナルの制御文字と衝突するため必ずshiftかaltを伴わせる
- Windowsにはプロセスグループもシグナルも無いため、pty.tsのSIGINT/SIGWINCH補完はmacOSのみ実行する
- IPCサーバーは`Bun.serve({unix})`のままWindowsでも動く（named pipeへの移行は不要だった）。ソケットパスの解決はsrc/bun/app-paths.tsとpackages/cli/src/ipc-client.tsに**意図的に重複**しているので、変更時は両方揃えること
- **既知の重大バグ: PTY出力の直後にプロセスが終了するとBunがネイティブクラッシュする**（Windows実機、Bun 1.3.14）。send-keys・レイアウトやpopupの`command`実行など、PTYへ書き込みを行う機能全般が対象。詳細・再現条件・回避策: docs/build/windows-build.md「既知の差異・制約」

## bun:ffiのハマりどころ

- **構造体の値渡し非対応**。値渡しAPI（ghostty_formatter_terminal_new等）はsrc/native/shim.cでスカラー引数に展開する。値渡しAPIが増えたらシムに追加
  （`ghostty_terminal_new`はlibghostty-vt側がスカラー引数化したためシム不要になった。代わりにスクロールバック上限は`ghostty_terminal_set(OPT_SCROLLBACK_MAX_LINES)`で設定する）
- コールバックはJSCallbackで渡せる（ghostty_terminal_setのWRITE_PTYで使用中）
- libghostty-vtのAPIは未安定。シンボルが消えることがある（例: `ghostty_terminal_mode_get`は廃止され、`ghostty_terminal_get(DATA_MODE)`に`GhosttyTerminalModeConfig`を渡す形になった）。
  dlopen時に存在しないシンボルを要求すると起動時に落ちるため、vendor更新後は`nm -D --defined-only`でエクスポートを確認する

## 既知の未対応（roadmap参照）

- 全角文字は描画後に `<span class="wide">` ラップで2セル幅を強制している（src/mainview/index.ts fixWideChars）。絵文字のグラフェムクラスタ（結合絵文字）は未対応
- 描画中（連続出力中）のinnerHTML置換でマウス選択が消える（アイドル時の選択コピーは動く）
