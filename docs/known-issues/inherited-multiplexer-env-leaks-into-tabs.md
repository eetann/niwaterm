---
type: Known Issue
title: "tmuxのペインからniwatermを起動すると、タブ内のfzfが何も表示せず操作不能になる"
description: niwatermがPTYへ渡す環境変数はprocess.envの丸ごと継承で組み立てるため、tmuxのペインから起動するとTMUX/TMUX_PANEがタブのシェルまで漏れる。fzfの--tmuxのように$TMUXで描画先を切り替えるツールが起動元のtmuxセッションへ画面を出してしまい、niwaterm側には何も表示されないままキー入力が効かなくなる
---

# tmuxのペインからniwatermを起動すると、タブ内のfzfが何も表示せず操作不能になる

## 症状

tmuxのペインから`mise run start`でniwatermを起動した場合に限り、タブの中で
`fzf --tmux`を使う補完（zenoのcompletionなど）を実行すると以下のようになる。

- fzfの画面が**一切表示されない**
- キー入力がほとんど効かなくなる
- `C-c`を押すと入力の反応が戻る

同じfzfでも`--tmux`を付けない呼び出し（`niwa.popup.open`経由のlazygit等）は正常に動くため、
popup機能そのものの不具合に見えてしまう。

## 原因

**niwatermがPTYへ渡す環境変数が、起動元のtmuxセッションの識別情報を含んだままになっている。**

`src/bun/pty.ts`の`buildEnv`はアプリ本体の`process.env`を丸ごと引き継いでタブのシェルへ渡す。
tmuxのペインからアプリを起動すると、そのペインの`TMUX`・`TMUX_PANE`・`TERM_PROGRAM`が
アプリのプロセスに入っており、そのままタブのシェルまで届いてしまう。

fzfは`--tmux`指定時に`$TMUX`の有無で描画先を決め、**あれば自前で描画せず`tmux new-pane`へ丸投げする**。
niwatermのタブ内では`$TMUX`が起動元のtmuxサーバーを指しているため、fzfはniwatermから見えない
tmuxセッションにペインを作り、その終了をひたすら待つ。niwaterm側のPTYには1バイトも出力されない。

実際にniwatermのタブ内で`fzf --tmux 80%`を走らせたときのプロセスツリー。

```
fzf --tmux 80% ...
└─ sh -c ... id=$(tmux if -F -t '%47' '#{window_zoomed_flag}' ... ';' new-pane -P -F '#{pane_id}' -t '%47' ...)
   └─ tmux wait-for fzf-fzf-temp-...
```

`%47`は`mise run start`を実行したtmuxペインのIDで、fzfは**そこへ**画面を出している。
PTYからの出力は0バイト、fzfはtmux側のペインが閉じるまで待ち続けるため、
タブは入力を受け付けないように見える。

`TERM_PROGRAM=tmux`の継承も同種の問題を起こす。画像表示プロトコル等はこの値を見て
制御シーケンスをtmuxのパススルー形式で包むため、niwatermのタブでは解釈できない列が流れる。

## 対処

`buildEnv`が「今いるターミナルの素性」を示す変数を落としてから渡す（`INHERITED_TERMINAL_ENV_KEYS`）。
`TERM_PROGRAM`はniwaterm自身の名前へ差し替える。

```ts
const env: Record<string, string> = { ...process.env, TERM: term, TERM_PROGRAM: "niwaterm" };
for (const key of INHERITED_TERMINAL_ENV_KEYS) delete env[key];
Object.assign(env, extraEnv);
```

対象は`TMUX` / `TMUX_PANE` / `TERM_PROGRAM_VERSION` / `STY`（GNU screen） /
`ZELLIJ`系。同じ種類の変数を持つマルチプレクサを見つけたらここへ足す。

**起動中のアプリには反映されない**（環境変数はPTY起動時に確定するため）。
tmuxの中から起動していたインスタンスは、修正後に起動し直す必要がある。

## 同じ症状に見える別原因: macOSに`timeout`が無い

`fzf-niwaterm`（`packages/cli/bin/fzf-niwaterm`）はpopupを開く前に`niwaterm ping`で疎通確認するが、
ここで使う`timeout`は**GNU coreutilsのコマンドでmacOSの標準構成には存在しない**
（Homebrewのcoreutilsを入れても既定名は`gtimeout`）。無い環境では`command not found`の127が返り、
アプリが正常に動いていてもping失敗と区別が付かないため、**popupを使わず常にローカルのfzfへ
フォールバックする**。

症状は「popupが開かず、呼び出したタブの中にfzfが出る」。上のtmux由来の症状（何も出ない）とは
見え方が違うので、まずどちらなのかを切り分ける。対処は`timeout`・`gtimeout`のうち存在する方を使い、
どちらも無ければniwaterm CLI自身が持つIPCタイムアウトに任せること。

## 関連

- [CLIガイド](/guide/cli.md) — `popup open --capture-stdout`の仕様
- [macOSでのビルド・実行手順](/build/macos-build.md)
