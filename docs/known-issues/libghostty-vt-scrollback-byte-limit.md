---
type: Known Issue
title: libghostty-vtのスクロールバックは既定でバイト数上限が先に効き行数指定が無視される
description: ghostty_terminal_setのSCROLLBACK_MAX_LINESで行数を指定しても、既定で10000バイトのバイト数上限が同時に効いているため約900行で頭打ちになる。行数で制御したい場合はバイト数上限をNULLで解除する必要がある
---

# libghostty-vtのスクロールバックは既定でバイト数上限が先に効き行数指定が無視される

## 症状

`GHOSTTY_TERMINAL_OPT_SCROLLBACK_MAX_LINES` に10000行を指定しても、実際に遡れるのは
約900行しかない。行数を50000へ増やしても結果は変わらない。

## 原因

libghostty-vtのスクロールバック上限は**行数とバイト数の2本立て**で、
「先に到達したほうが使われる」（`vendor/libghostty/include/ghostty/vt/terminal.h` の
`GHOSTTY_TERMINAL_OPT_SCROLLBACK_MAX_BYTES` のコメント）。

そしてバイト数側の既定値が **10000バイト**（`GHOSTTY_TERMINAL_DATA_SCROLLBACK_MAX_BYTES`
で読み出して確認）。行数側の既定は「上限なし」なので、何も設定しないとバイト数上限だけが
効いている状態になる。行数を設定しても、バイト数上限のほうが先に到達するため効果が出ない。

80桁で計測した実測値（1行に50文字程度を流し込み、`DATA_SCROLLBAR`のtotalを読んだもの）:

| 行数上限 | バイト数上限 | 60000行流した後のtotal |
| --- | --- | --- |
| 10000 | 既定(10000バイト) | 943 |
| 10000 | NULL（解除） | 9628 |
| 1000 | NULL（解除） | 943 |
| 50000 | NULL（解除） | 49579 |

## 対処

行数だけで上限を決めるなら、バイト数上限をNULLポインタで解除する（`src/bun/ghostty.ts`の
`createGhosttyTerminal`がこれをやっている）。

```ts
vt.symbols.ghostty_terminal_set(term, OPT_SCROLLBACK_MAX_BYTES, null);
```

解除するとメモリ使用量は行数×桁数に比例する。80桁で50000行のとき約32MB（RSSの増分）。

## 関連: 刈り込みはページ単位

libghostty-vtは履歴を「ページ」単位でしか刈り込まないため、実際に残る行数は指定値より
数十〜数百行多くなる。80桁なら1ページが350行前後で、**行数上限に0を指定しても1ページ分
（数百行）は残る**（スクロールバックを完全に無くす手段は無い）。

上限を下げた場合の刈り込みはその場で走る（`ghostty_terminal_set`を呼んだ直後に
`DATA_SCROLLBAR`のtotalが減る）ため、設定ファイルのホットリロードから既存ターミナルへ
そのまま適用できる。
