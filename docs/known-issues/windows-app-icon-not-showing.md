---
type: Known Issue
title: "Windows実機: アプリアイコンをexeへ埋め込んでもタイトルバー・タスクバーに反映されない（electrobun 2.0.1で解消）"
description: electrobun 1.18.1のWindows向けビルドには独立した2つの既知バグがあり、rcedit解決失敗とネイティブウィンドウクラス登録失敗が重なって、exeファイル自体のアイコンは正しく書き換わってもタイトルバー/タスクバーには表示されなかった。electrobun 2.0.1へのアップグレード（TASK-0050）で両方解消済み
---

# Windows実機: アプリアイコンをexeへ埋め込んでもタイトルバー・タスクバーに反映されない（electrobun 2.0.1で解消）

## 解消済み（2026-08-25、electrobun 2.0.1）

electrobun 1.18.1→2.0.1へのアップグレード後、以下を実機確認した。

- ビルドログに`embedded Windows icon in launcher.exe` / `embedded Windows icon in bun.exe`が出力される（electrobun本体が自前でアイコン埋め込みに成功している）
- `[System.Drawing.Icon]::ExtractAssociatedIcon()`で`launcher.exe`のアイコンを抽出すると、niwaterm独自のアイコンが正しく埋め込まれている
- 実機のウィンドウタイトルバーにもniwaterm独自のアイコンが反映されている

これにより、niwaterm側で追加していた回避策（`scripts/embed-windows-icon.ts`のpostBuildフック、`rcedit`への依存）は不要になったため削除した。以下は1.18.1時代の記録として残す。

## （旧）症状

`electrobun.config.ts`の`build.win.icon`（`.ico`）・`build.mac.icons`（`.iconset`）にniwaterm独自のアイコンを設定してビルドしても、Windows実機ではタイトルバー・タスクバーの表示が変わらない。`.NET`の`[System.Drawing.Icon]::ExtractAssociatedIcon()`やExplorerのファイル一覧で`build/dev-win-x64/niwaterm-dev/bin/bun.exe`を直接確認すると正しいアイコンに書き換わっているにもかかわらず、実際に起動して開いたウィンドウのタイトルバー・タスクバーだけは別の（webviewの汎用アイコンらしき）画像のままになる。

## （旧）根本原因

electrobun 1.18.1のWindows向けビルドパイプラインに、互いに独立した2つの既知バグが存在し、これが重なっている。

### 1. rcedit解決失敗（対処済み） — [electrobun#429](https://github.com/blackboardsh/electrobun/issues/429)

electrobun 1.18.1のCLIは`bun build --compile`で単一exeにコンパイルして配布されている。そのコンパイル時、アイコン埋め込みステップの`require.resolve("rcedit/package.json")`がメンテナのCIランナー上の絶対パス（`D:\a\electrobun\electrobun\package\node_modules\rcedit\package.json`）としてバイナリへ焼き込まれてしまっており、実行時は必ず解決に失敗して警告付きでスキップされる（`dev`・`build`いずれのログにも`Warning: Failed to embed icon into launcher.exe: ResolveMessage: Cannot find module '...'`が出る）。

上流では修正済み（[#433](https://github.com/blackboardsh/electrobun/issues/433) → 2026-08-02クローズ）だが、npmの`latest`タグは本稿執筆時点でもまだ`1.18.1`のまま（修正は`2.0.1-beta.*`のみに存在し、そちらは別の破壊的変更が報告されている）。

### 2. カスタムウィンドウクラス登録失敗（未対処、上流待ち） — [electrobun#458](https://github.com/blackboardsh/electrobun/issues/458)

Windowsのネイティブラッパー（`libNativeWrapper.dll`）は、メインウィンドウ生成時に独自のウィンドウクラスを`RegisterClassExW`で登録しようとする。しかしDLL自身の`hInstance`と`CreateWindowExW`に渡す`hInstance`が一致しないバグ（`ERROR_CANNOT_FIND_WND_CLASS`、Win32エラー1407）により登録が失敗し、Win32標準の`STATIC`クラスへフォールバックする。devログに出る`Custom class failed, falling back to STATIC class`がこれにあたる。

`STATIC`クラスはUSER32の共有システムクラスであり、Electrobunのカスタム`WndProc`（アイコン・フォーカス・カスタムフレーム等のハンドリング）を経由しない。そのため、**exeファイル自体のアイコンリソースは正しく書き換わっていても、ウィンドウ自体がそのリソースを参照しない**状態になり、タイトルバー・タスクバーには反映されない。

上流では[PR #464](https://github.com/blackboardsh/electrobun/pull/464)で修正済み（2026-08-02クローズ、rcedit修正と同日）だが、これもnpmの`latest`にはまだ含まれていない。ネイティブDLLの問題のため、niwaterm側からビルド後に上書き修正できない（1のrceditと違い、後からリソースを差し替えて回避する手段がない）。

## （旧）1.18.1時代の対処方法

- **1のrcedit解決失敗**: `rcedit`をniwaterm自身の`devDependencies`に追加し、`scripts/embed-windows-icon.ts`を`postBuild`フックとして登録して自前でアイコンを埋め込み直していた（electrobun 2.0.1化に伴い削除）。
- **2のウィンドウクラス問題**: ネイティブDLLのバグのため、npmパッケージの外側から回避する手段がなく、上流の修正待ちだった。

## 関連

- [Windowsでのビルド・実行手順](/build/windows-build.md)
- `electrobun.config.ts` — `build.mac.icons` / `build.win.icon` / `build.linux.icon`
- `assets/icon/` — `icon.iconset`（macOS）・`icon.ico`（Windows）・`icon.png`（Linux）・元データは`docs/brand/logo.svg`
- [electrobun#429](https://github.com/blackboardsh/electrobun/issues/429) — rcedit解決失敗
- [electrobun#458](https://github.com/blackboardsh/electrobun/issues/458) — カスタムウィンドウクラス登録失敗
