---
type: Known Issue
title: "macOS: zshのedit-command-lineでnvimを開いたままリサイズすると、nvimが停止して端末が壊れる"
description: pty.resize()がシェルのプロセスグループへSIGWINCHを送っていたため、ZLEのウィジェットからnvimを起動している間にzshが端末を奪い、nvimがSIGTTINで停止していた。alt screen・マウス・mode 2048が解除されないまま残る。切り分けの証拠と対応内容を記録する
---

# macOS: zshのedit-command-lineでnvimを開いたままリサイズすると、nvimが停止して端末が壊れる

## 症状

zshの`edit-command-line`で開いたnvimの表示中にタブのサイズが変わると、次の状態になる。

- nvimの画面が残ったまま、zshのプロンプトが入力を受け付ける
- マウス操作のたびに`0;43;21M`、リサイズのたびに`8;50;190;900;1330t`のような文字列がプロンプトへ入る
- `:q`を打っても閉じない（打った文字はzshへ届く）

`ps`では、nvimのSTATが`T`（停止）で、端末のフォアグラウンドはzshへ移っている。`zsh: suspended (tty input)`も出るが、残った画面に埋もれて気づきにくい。

文字列の正体は、`ESC [ < btn;x;y M`（SGRマウスレポート）と`ESC [ 48;rows;cols;hpx;wpx t`（mode 2048）から、zleが先頭を食べた残りである。

Windowsはシグナルを使わないため対象外。

## 根本原因

`pty.resize()`が`process.kill(-proc.pid, "SIGWINCH")`で、シェルのプロセスグループへSIGWINCHを送っていた。

通常の端末では、シェルがジョブを動かしている間のSIGWINCHはフォアグラウンドのジョブへ届き、シェルには届かない。ここでは配送先が逆になり、zshがウィジェットの実行中にSIGWINCHを受け取って行エディタを動かし、nvimと端末を取り合う。その結果、nvimが`SIGTTIN`で停止し、zshはジョブがサスペンドしたものとして端末を取り戻す。

nvimは終了処理を走らせないまま止まるので、`?1049l`・`?1002l`・`?1006l`・`?2048l`のどれも出力されない。libghostty-vtの状態はnvim起動中のまま残り、niwatermはモードどおりにマウスレポートとmode 2048のレポートを送り続ける。つまりVT側の不具合ではなく、PTYから解除のシーケンスが届いていない。

## 切り分けの証拠

macOSで、実物のzsh・nvim 0.12.5を`createPty`と`createGhosttyTerminal`で動かして確認した。`bindkey '^O' edit-command-line`のうえで`C-o`でnvimを開き、次の操作を行った。

| 操作 | nvim | フォアグラウンド | `:q`の結果 |
| --- | --- | --- | --- |
| リサイズしない | `S+` | nvim | 正常に閉じる。`mouseTracking=false` |
| 修正前にリサイズ1回 | `T` | zsh | 閉じない。`?1049l`は届かず`mouseTracking=true`のまま |
| 修正後にリサイズ＋ホイール連打 | `S+` | nvim | 12周すべて正常に閉じる |

修正後も、プロンプト中のzshの`TRAPWINCH`と、nvimの`VimResized`には新しいサイズで届く。

## 対応

ptyexecでPTYが制御端末になっていれば、winsizeの変更時にkernelがフォアグラウンドのプロセスグループへSIGWINCHを配る。`pty.resize()`はptyexecがあるときは自前で送らない。

ptyexecが無い環境（`build:native`未実行）ではPTYが制御端末にならずkernelが配らないので、従来どおりシェルのグループへ送る。この場合は本件の問題が残る。

制御端末の詳細は[macOS: 端末から起動するとPTY内のfzf等（/dev/ttyを開くプログラム）が無反応になる](./macos-pty-child-controlling-terminal.md)を参照。
