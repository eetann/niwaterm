---
type: Known Issue
title: "Windows実機: アプリアイコンをexeへ埋め込んでもタイトルバー・タスクバーに反映されない"
description: electrobun 1.18.1のWindows向けビルドには独立した2つの既知バグがあり、rcedit解決失敗（対処済み）とネイティブウィンドウクラス登録失敗（未対処、上流の次期安定版待ち）が重なって、exeファイル自体のアイコンは正しく書き換わってもタイトルバー/タスクバーには表示されない
---

# Windows実機: アプリアイコンをexeへ埋め込んでもタイトルバー・タスクバーに反映されない

## 症状

`electrobun.config.ts`の`build.win.icon`（`.ico`）・`build.mac.icons`（`.iconset`）にniwaterm独自のアイコンを設定してビルドしても、Windows実機ではタイトルバー・タスクバーの表示が変わらない。`.NET`の`[System.Drawing.Icon]::ExtractAssociatedIcon()`やExplorerのファイル一覧で`build/dev-win-x64/niwaterm-dev/bin/bun.exe`を直接確認すると正しいアイコンに書き換わっているにもかかわらず、実際に起動して開いたウィンドウのタイトルバー・タスクバーだけは別の（webviewの汎用アイコンらしき）画像のままになる。

## 根本原因

electrobun 1.18.1のWindows向けビルドパイプラインに、互いに独立した2つの既知バグが存在し、これが重なっている。

### 1. rcedit解決失敗（対処済み） — [electrobun#429](https://github.com/blackboardsh/electrobun/issues/429)

electrobun 1.18.1のCLIは`bun build --compile`で単一exeにコンパイルして配布されている。そのコンパイル時、アイコン埋め込みステップの`require.resolve("rcedit/package.json")`がメンテナのCIランナー上の絶対パス（`D:\a\electrobun\electrobun\package\node_modules\rcedit\package.json`）としてバイナリへ焼き込まれてしまっており、実行時は必ず解決に失敗して警告付きでスキップされる（`dev`・`build`いずれのログにも`Warning: Failed to embed icon into launcher.exe: ResolveMessage: Cannot find module '...'`が出る）。

上流では修正済み（[#433](https://github.com/blackboardsh/electrobun/issues/433) → 2026-08-02クローズ）だが、npmの`latest`タグは本稿執筆時点でもまだ`1.18.1`のまま（修正は`2.0.1-beta.*`のみに存在し、そちらは別の破壊的変更が報告されている）。

### 2. カスタムウィンドウクラス登録失敗（未対処、上流待ち） — [electrobun#458](https://github.com/blackboardsh/electrobun/issues/458)

Windowsのネイティブラッパー（`libNativeWrapper.dll`）は、メインウィンドウ生成時に独自のウィンドウクラスを`RegisterClassExW`で登録しようとする。しかしDLL自身の`hInstance`と`CreateWindowExW`に渡す`hInstance`が一致しないバグ（`ERROR_CANNOT_FIND_WND_CLASS`、Win32エラー1407）により登録が失敗し、Win32標準の`STATIC`クラスへフォールバックする。devログに出る`Custom class failed, falling back to STATIC class`がこれにあたる。

`STATIC`クラスはUSER32の共有システムクラスであり、Electrobunのカスタム`WndProc`（アイコン・フォーカス・カスタムフレーム等のハンドリング）を経由しない。そのため、**exeファイル自体のアイコンリソースは正しく書き換わっていても、ウィンドウ自体がそのリソースを参照しない**状態になり、タイトルバー・タスクバーには反映されない。

上流では[PR #464](https://github.com/blackboardsh/electrobun/pull/464)で修正済み（2026-08-02クローズ、rcedit修正と同日）だが、これもnpmの`latest`にはまだ含まれていない。ネイティブDLLの問題のため、niwaterm側からビルド後に上書き修正できない（1のrceditと違い、後からリソースを差し替えて回避する手段がない）。

## 対処方法

- **1のrcedit解決失敗は対処済み**: `rcedit`をniwaterm自身の`devDependencies`に追加し（`assets/icon/icon.ico`とバージョンが確実に解決できるようにするため）、`scripts/embed-windows-icon.ts`を`postBuild`フックとして登録した。electrobun本体のアイコン埋め込みが失敗した直後に、このフックが`launcher.exe`・`bun.exe`へ自前でアイコンを埋め込み直す。exeファイル単体としては正しいアイコンになる（Explorerのファイル一覧やショートカット作成時などで確認可能）。
- **2のウィンドウクラス問題は現状未対処**: ネイティブDLLのバグのため、npmパッケージの外側から回避する手段が見つかっていない。electrobunが`latest`タグでこの修正を含む安定版をリリースするまで、Windows実機のタイトルバー・タスクバーには反映されない。
- **macOSは影響を受けない**: `build.mac.icons`（`.iconset` → `iconutil`で`.icns`変換）の経路はこの2つのバグと無関係で、Windowsのrcedit/ネイティブDLLとは別の仕組みのため、macOS実機ビルドでは通常通りアイコンが反映される見込み（未実機検証）。
- electrobunが新しい安定版（1.18.1より新しいバージョン）をリリースしたら、まず`bun update electrobun`してWindows実機で再検証する。その時点で2が解消していれば、`scripts/embed-windows-icon.ts`と`postBuild`フックの設定はもう不要になる可能性が高い（1のrceditバグ自体も直っているはずなので）。

## 関連

- [Windowsでのビルド・実行手順](/build/windows-build.md)
- `electrobun.config.ts` — `build.mac.icons` / `build.win.icon` / `build.linux.icon` / `scripts.postBuild`
- `scripts/embed-windows-icon.ts` — rcedit解決失敗の回避スクリプト
- `assets/icon/` — `icon.iconset`（macOS）・`icon.ico`（Windows）・`icon.png`（Linux）・元データは`docs/brand/logo.svg`
- [electrobun#429](https://github.com/blackboardsh/electrobun/issues/429) — rcedit解決失敗
- [electrobun#458](https://github.com/blackboardsh/electrobun/issues/458) — カスタムウィンドウクラス登録失敗
