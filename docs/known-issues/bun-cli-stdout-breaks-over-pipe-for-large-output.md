---
type: Known Issue
title: "CLIの64KB超の出力がパイプ経由で壊れる"
description: EPIPE対策でprocess.stdoutへerrorハンドラを登録していると、1回の書き込みが64KBを超えたときconsole.logは途中で切れ、Bun.write(Bun.stdout)は内容が二重になる。1回で大きな文字列を書くコマンドはprocess.stdout.writeを使う
---

# CLIの64KB超の出力がパイプ経由で壊れる

## 症状

`niwa`コマンドの出力を他のコマンドへパイプで渡すと、内容が途中で切れる。
JSONを出すコマンドなら受け取り側が`JSON Parse error: Unterminated string`で落ちる。
出力先がファイル（`> file`）や端末なら正しく出るため、気づきにくい。

## 原因

**`process.stdout`へerrorハンドラを登録していること**と、**1回の書き込みが64KBを超えること**の
組み合わせ。CLIのエントリ（`packages/cli/src/index.ts`）は`docs show cli | head`のような
パイプ先が先に閉じる使い方でEPIPE落ちしないよう、`process.stdout.on("error", ...)`を
登録している。これがNode互換ストリームの経路を有効にする一方、`console.log`と
`Bun.write(Bun.stdout)`はその経路を通らずに書くため、バッファが食い違う。

100000文字を1回で書いてパイプへ流した実測（Bun 1.4.0）。

| 書き方 | errorハンドラなし | errorハンドラあり |
| --- | --- | --- |
| `console.log` | 100001 | **65536**（64KBで切れる） |
| `Bun.write(Bun.stdout, ...)` | 100001 | **165537**（100001 + 65536。内容が二重になる） |
| `process.stdout.write` | 100001 | 100001 |

**1回の書き込みサイズだけが条件**で、総出力量は関係ない。60文字の`console.log`を2000回
（合計122000バイト）繰り返しても壊れない。行ごとに出すコマンドが無事なのはこのため。

## 対処

**1回で大きな文字列を書くところは`process.stdout.write`を使う**。
`docs show`（ドキュメント全体を一度に書く）と`claude prompt list` / `show`の`--json`が
これに当たる。行ごとに出す人間向けの表示は`console.log`のままでよい。

`Bun.write(Bun.stdout, ...)`は一見「書き込み完了をawaitできる安全な書き方」に見えるが、
この状況では最も壊れ方が悪い（欠けるのではなく重複するので、受け取り側が
壊れたデータを正常なものとして扱う余地が残る）。使わないこと。

新しくコマンドを足すときは、**出力が一度に64KBを超えうるか**で判断する。
サイズが入力次第で決まるもの（ファイルの中身、HTML、会話記録、長いリストのJSON）は
超えると考えて`process.stdout.write`を選ぶ。
