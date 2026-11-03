---
type: Known Issue
title: libghostty-vtのフォーマッタがカーソル移動で飛ばしたセルへ背景色をにじませる
description: 背景色を設定したままCHA・CUFで右の列へ飛ぶ出力（Claude Codeの起動バナーなど）で、何も書き込まれていない空セルが直前の背景色で塗られてHTMLへ出る。scripts/patch-ghostty-formatter.tsがvendorのformatter.zigへ当てるパッチで回避している
---

# libghostty-vtのフォーマッタがカーソル移動で飛ばしたセルへ背景色をにじませる

## 症状

`claude`（Claude Code）を起動すると、ロゴと`Claude Code`の文字の間に3セル分の黒い矩形が出る。
同じ出力をweztermなど他のターミナルで表示しても出ない。

黒い矩形の縦幅は行の高さいっぱいで、フォントサイズを変えても追従する。つまりグリフではなく
セルの背景色として塗られている。

## 原因

libghostty-vtのフォーマッタ（`src/terminal/formatter.zig`、画面をHTML/VTへダンプする係）が、
**何も書き込まれていない空セルを、直前のセルのスタイルを開いたまま空白として書き出す**。

フォーマッタは空セルを`blank_cells`に数えておき、次に中身のあるセルが来たところでまとめて
空白へ展開する。この展開がスタイル切り替えより先に走るため、直前のセルの`<div>`（背景色付き）
の内側に空白が入る。行をまたぐときは同じ問題を避けるためのスタイルリセットが入っているが、
行の途中には無い。

Claude Codeの起動バナーは、ロゴのブロック文字を背景色付きで描いたあと、背景色を戻さないまま
CHA（`ESC[12G`）でテキストの開始列へ飛ぶ。飛び越えた3セルは誰も書き込んでいない空セルなので、
この経路に乗る。背景色が黒（`ESC[48;5;16m`）なので黒い矩形として見える。

```
ESC[38;5;174m ▐ ESC[48;5;16m ▛███▛█ ESC[12G ESC[39m ESC[49m ESC[1m Claude Code
                ^^^^^^^^^^^^^ 背景色を設定       ^^^^^^^^^ 背景色を戻さないまま12列目へ
```

パッチを当てる前のHTML出力（空白3つが背景色付きの`div`の中にいる）:

```html
<div style="display: inline;color: var(--vt-palette-174);background-color: var(--vt-palette-16);">&#9627;&#9608;&#9608;&#9608;&#9627;&#9608;   </div><div style="display: inline;font-weight: bold;">Claude Code</div>
```

画面のセルとしては空のままなので、`tab capture`（プレーンテキスト）には差が出ない。
HTMLを見ないと切り分けられない。

## 対処

`scripts/patch-ghostty-formatter.ts`が、空白を展開する前にスタイルを閉じるようフォーマッタへ
パッチを当てる。`mise run build:vendor:mac` / `mise run build:vendor:win`がビルド前に呼ぶため、
通常はタスクを実行するだけでよい。vendorのソースを取り直したときも同じ。

ghostty側でフォーマッタの実装が変わって想定の箇所が見つからなくなった場合、パッチスクリプトは
エラーで止まる。その時点で同じ問題がまだ残っているかを確認し、残っていればスクリプトを直す。

ghostty v1.4.0ではVT出力側だけが上流で直った（行内の空セルはCUFで飛ばし、行をまたいで持ち越す空白の前では
スタイルを閉じる）。HTML出力は直っていないため、パッチはHTML出力にだけ当てている
（v1.4.0で、パッチを当てずにビルドすると`src/bun/ghostty.test.ts`の該当テストが落ちることを確認した）。

明示的に背景色を塗った空白（`ESC[48;5;16m   `）やEL（`ESC[K`）で塗られた行末は、空セルではなく
背景色を持つセルとして扱われるため、このパッチの影響を受けない。

## 確認方法

ソースへのパッチ適用とdylibのビルドは別の手順なので、パッチスクリプトが「適用済み」と言っていても
手元のdylibが古いままのことがある。`bun test src/bun/ghostty.test.ts`で、実際に読み込まれる
vendorのdylibが直っているかを確かめられる。落ちたら`mise run build:vendor:mac` /
`mise run build:vendor:win`でビルドし直す。

WSLで`bun test`を回すときに読み込まれるのは、Windows向けのDLLではなくLinux向けの
`vendor/libghostty/lib/libghostty-vt.so.0.1.0`。`build:vendor:win`はこれを作り直さないため、
WSLだけでテストが落ちることがある。その場合は`-Dtarget`を付けずにネイティブビルドする。

```sh
bun scripts/patch-ghostty-formatter.ts vendor/libghostty
cd vendor/libghostty
mise exec zig@0.17.0 -- zig build -Demit-lib-vt -Doptimize=ReleaseFast --prefix "$PWD"
```
