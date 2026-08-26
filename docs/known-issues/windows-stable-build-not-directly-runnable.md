---
type: Known Issue
title: "Windowsのstable/canaryビルドはそのまま直接実行できる展開済みappバンドルを作らない"
description: electrobun build --env=stable/canaryはappバンドルをtar圧縮した後にディレクトリごと削除し、配布用インストーラ(self-extractor)を同じ場所に作り直す設計になっている。bin/launcher.exeが消える現象の原因調査と、niwaterm側でstable/canaryを使わない方針にした経緯を記録する
---

# Windowsのstable/canaryビルドはそのまま直接実行できる展開済みappバンドルを作らない

## 症状

Windows実機で`electrobun build --env=stable`（canaryでも同様）を実行してビルドした後、`build/stable-win-x64/niwaterm/bin/launcher.exe`を直接起動しようとすると次のエラーになる。

```
用語 'C:\Users\<ユーザー名>\niwaterm\build\stable-win-x64\niwaterm\bin\launcher.exe' は、コマンドレット、
関数、スクリプト ファイル、または操作可能なプログラムの名前として認識されません。
```

実際にディレクトリを見ると`bin/`配下のファイルはほぼ全て消え、`launcher`という拡張子なしファイルだけが残っている。`electrobun dev`（devビルド）ではこの問題は起きない。

## 根本原因

Electrobun 1.18.1のビルドパイプライン（`node_modules/electrobun/src/cli/index.ts`）は、`buildEnvironment !== "dev"`のとき（stable/canary）次の処理を行う（3730行目付近のコメントに設計意図が書かれている）。

```js
// steps:
// 1. build the app bundle, code sign, notarize, staple.
// 2. tar and zstd the app bundle (two separate files)
// 3. build another app bundle for the self-extracting app bundle with the zstd in Resources
// ...
```

つまり **1回目に組み立てた本来のappバンドル（`bin/launcher.exe`を含む）はtar圧縮された後、ディレクトリごと削除される**（3763行目付近）。

```js
// Tar the app bundle for all platforms
createTar(tarPath, buildFolder, [basename(appBundleFolderPath)]);
// Remove the app bundle folder after tarring
if (targetOS !== "linux" || buildEnvironment !== "dev") {
  rmSync(appBundleFolderPath, { recursive: true });
```

その直後、**同じ`bundleName`・`buildFolder`で`createAppBundle()`が再度呼ばれ**（3996行目付近）、今度は配布用インストーラ（self-extractor、`niwaterm-Setup.exe`と同一の実行ファイル）を`bin/launcher`という名前で書き込む。実機で`bin/launcher`と`niwaterm-Setup.exe`のMD5ハッシュが完全一致することを確認し、これを裏付けた。

```
df432878a7529a9913dea5544c4f3dec  niwaterm/bin/launcher
df432878a7529a9913dea5544c4f3dec  niwaterm-Setup.exe
```

**これはバグではなくElectrobunの意図した設計**である。`stable`/`canary`チャンネルは「配布用インストーラ（self-extractor）を作ること」が目的であり、「ビルド後すぐに直接実行できる展開済みappバンドルを残すこと」は想定されていない。エンドユーザーは`niwaterm-Setup.exe`を実行してインストールし、インストール先に展開された本物のランチャーを使うことが前提になっている。

devビルドでこの一連の処理が起きないのは、`buildEnvironment !== "dev"`のガードでこの処理自体がスキップされるため。

GitHub上の[blackboardsh/electrobun](https://github.com/blackboardsh/electrobun) issueを検索したが、この設計そのものについて「ビルド後すぐ直接実行できると誤解した」という報告は見当たらなかった（2026-08時点）。

## 対処方法（方針転換）

当初、`postBuild`で本物の`launcher.exe`を退避し`postPackage`で復元する回避策を試みたが、これは**Electrobunの正規の設計（1.と2.の間でディレクトリが削除される）を無理やり捻じ曲げるもの**であり、保守性が低く不適切と判断して撤回した。

代わりに、**niwatermは普段遣い用ビルドにstable/canaryチャンネルを使わない方針にした**。devチャンネルのままアプリ名だけを変えることで、開発中ビルドと普段遣いビルドを別インスタンスとして共存させる。

- `electrobun.config.ts`の`app.name`を`process.env.NIWATERM_APP_NAME || "niwaterm-wip"`にして環境変数で切り替え可能にした
- 普段遣い用は`NIWATERM_APP_NAME=niwaterm-daily`を指定して`electrobun dev`（devチャンネル）でビルド・起動する（`mainブランチ`で`mise run start`を実行すると自動的にこちらになる）。実際のappフォルダ名は`niwaterm-daily-dev`になる
- devチャンネルはtar圧縮・インストーラ作成処理を通らないため、この問題の影響を受けない
- `src/bun/app-paths.ts`の`appSupportDir()`は、ビルドチャンネルではなく実際に使われたアプリ名（`APP_VARIANT`、`scripts/write-app-variant.ts`が`preBuild`フックで焼き込む）でディレクトリを分岐させている

stable/canaryチャンネル自体を将来使う可能性がある場合（例えば本当に配布物を作りたくなった場合）は、`niwaterm-Setup.exe`を実行してインストールし、インストール先の本物のランチャーを使う運用にする必要がある。

## 関連

- [Windowsでのビルド・実行手順](/build/windows-build.md) — 普段遣い用ビルドの起動手順
- `electrobun.config.ts` — `app.name`の環境変数切り替え
- `scripts/write-app-variant.ts` — アプリ名(`APP_VARIANT`)の焼き込み
- `src/bun/app-paths.ts` — `APP_VARIANT`別のディレクトリ分岐
- `node_modules/electrobun/src/cli/index.ts`の`createTar`→`rmSync(appBundleFolderPath)`→`createAppBundle`の2回目呼び出し（3762〜3996行目付近、バージョンにより行番号は変わりうる）
