---
type: Known Issue
title: "Windows実機: 設定から読む@niwaterm/configが、同期されない古いチェックアウトを指したままになる"
description: 設定ディレクトリの@niwaterm/configはbunのグローバルリンク経由で解決され、リンク先は最後にbun linkしたチェックアウトで固定される。win:syncが更新するniwaterm-worktrees配下とは別の場所を指していると、本体を更新しても設定から見える@niwaterm/configだけが古いまま残り、新しいexportをimportした設定が読み込みに失敗する
---

# Windows実機: 設定から読む@niwaterm/configが、同期されない古いチェックアウトを指したままになる

## 症状

`@niwaterm/config`へ新しく足したexport（例: `claudePromptJump`）を`niwaterm.config.ts`からimportすると、
本体（daily/wip）を最新にしたのに設定ファイルの読み込みに失敗する。
`defineConfig`・`defaultAppearance`のような昔からあるexportしか使っていない設定では起きないため、
新しいexportを初めて使うまで気づけない。

## 原因

ユーザー設定ディレクトリの`package.json`は`"@niwaterm/config": "link:@niwaterm/config"`で、
bunのグローバルリンク（`%USERPROFILE%\.bun\install\global\node_modules\@niwaterm\config`）を経由して解決される。
グローバルリンクの向き先は、**最後に`bun link`を実行した`packages/config`で固定**され、以後は自動で動かない。

Windows側のソースは`mise run win:sync`が`%USERPROFILE%\niwaterm-worktrees\<ディレクトリ名>\`へ同期する。
グローバルリンクがこれ以外の場所（worktree別の配置にする前の`%USERPROFILE%\niwaterm\`など）で作られていると、
アプリ本体は最新なのに、設定から見える`@niwaterm/config`だけが同期の外に取り残される。
アプリはユーザー設定の`node_modules`をそのまま使って設定を評価するため、本体側に同梱の`@niwaterm/config`では補われない。

## 確認

```sh
ls -la /mnt/c/Users/<ユーザー名>/.config/niwaterm/node_modules/@niwaterm/
ls -la /mnt/c/Users/<ユーザー名>/.config/niwaterm-wip/node_modules/@niwaterm/
```

リンク先が`niwaterm-worktrees\niwaterm\packages\config`（daily）でなければこの問題に当たる。

## 対処

daily側のworktreeでグローバルリンクを張り直し、各設定ディレクトリで解決し直す。

```powershell
cd $env:USERPROFILE\niwaterm-worktrees\niwaterm\packages\config; bun link
cd $env:USERPROFILE\.config\niwaterm; bun install
cd $env:USERPROFILE\.config\niwaterm-wip; bun install
```

wipの設定ディレクトリもグローバルリンクを共有するため、dailyの`@niwaterm/config`を読む。
devブランチで`@niwaterm/config`に足したexportをwipで試すときは、先にmainへ取り込んでdailyを更新するか、
wipの設定ディレクトリの`node_modules\@niwaterm\config`だけを`niwaterm-worktrees\niwaterm@dev\packages\config`へ向け直す。

CLIのグローバルリンク（`@niwaterm/cli`）も同じ仕組みで、古いチェックアウトを指したまま残りうる。
