---
type: Known Issue
title: "Claude Codeの会話履歴はスクロールバックに残らない"
description: Claude Codeは起動直後にalternate screenへ入り毎フレーム画面全体を書き直すため、会話履歴はniwaterm側のスクロールバックに1行も入らない。セルの位置を覚えて後から飛ぶ機能は作れず、hookからOSCを注入する道も塞がっているので、過去のやりとりを辿るにはtranscript（jsonl）を読む
---

# Claude Codeの会話履歴はスクロールバックに残らない

## 症状

Claude Codeを動かしているタブでスクロールバックを遡っても、会話履歴が出てこない。
プロンプトジャンプ（prefix + `shift+up` / `shift+down`）もコピーモードの `{` / `}` も、
Claude Codeのプロンプトには止まらない。

## 原因

**Claude Codeは起動直後に alternate screen へ入る**（`ESC [ ? 1049 h`）。
alternate screenにはスクロールバックが無く、Claude Codeは毎フレーム `ESC [ H` で
ホームへ戻ってから画面全体を書き直す。結果として、

- niwaterm側のスクロールバックへは1行も入らない。上へ流れていく履歴のように見えるのは、
  Claude Codeが自前で描き直しているだけの見かけ
- **セルの位置を覚えても意味を保てない**。libghostty-vtのtracked grid ref
  （`ghostty_terminal_grid_ref_track`）はスクロール・スクロールバックの刈り込み・
  リサイズ時のreflowには追従するが、追従先のセルの中身は次のフレームで別物に書き換わる
- マウスホイールもClaude Code自身が受け取る（`ESC [ ? 1000 h`〜`ESC [ ? 1006 h` で
  マウスレポートを有効化している）ため、niwaterm側のスクロールは働かない

シェル統合のようにOSC 133のマークを送り込んで位置を教える回避策も使えない。
**hookのプロセスは制御端末を持たないため、`/dev/tty` へ書き込めない**
（`/dev/tty: No such device or address`）。エージェント側からniwatermの画面へ
エスケープシーケンスを差し込む経路は無いものとして扱う。

## 対処

画面上の位置ではなく**transcript（jsonl）を読む**。Claude Codeのhookは入力JSONで
`transcript_path` を絶対パスで渡してくるため、パスを組み立てる必要が無い。
1つのプロンプトに属する行は同じ `promptId` で束ねられているので、プロンプト単位で
そのターン全体を切り出せる。

[エージェント統合](/guide/cli.md)のhooksがこのパスをタブ変数へ書き込み、
`niwaterm claude prompt list` / `show` がそれを読む。画面から消えた
（コンテキスト圧縮で失われた）やりとりも辿れるので、スクロールで遡るより射程が広い。

alternate screenを使うTUIはClaude Codeに限らないため、「そのタブの履歴を遡る」系の機能を
考えるときは、まず相手がalternate screenに入るかどうかを確かめる。
