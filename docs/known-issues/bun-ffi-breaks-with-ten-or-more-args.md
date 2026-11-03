---
type: Known Issue
title: "bun:ffiは引数が10個以上ある関数を正しく呼べない"
description: macOS(arm64)のBun 1.3.13で、bun:ffi経由の関数呼び出しは引数9個までは正常だが10個目以降がゴミ値になり、ポインタ引数だとセグフォでプロセスごと落ちる。再現コードと回避策（引数を構造体ポインタ1つにまとめる）を記録する
---

# bun:ffiは引数が10個以上ある関数を正しく呼べない

## 症状

`dlopen`で読み込んだ関数を引数10個以上で呼ぶと、10個目以降の引数がネイティブ側にゴミ値として届く。
その位置がポインタ引数だと不正アドレスへのアクセスになり、`panic(main thread): Segmentation fault`で
Bunプロセスごと落ちる（アプリ側のtry/catchでは捕まえられない）。

niwatermでは、`src/native/shim.c`の`niwa_dump_selection`を最初スカラー引数13個
（term, emit, tag, start_x, start_y, end_x, end_y, rectangle, unwrap, trim, buf, buf_len, out_written）
で作った時に踏んだ（vi風コピーモードの実装中）。

## 再現

```c
// probe.c
int niwa_p8(int a1,int a2,int a3,int a4,int a5,int a6,int a7,int a8){return a8;}
int niwa_p9(int a1,int a2,int a3,int a4,int a5,int a6,int a7,int a8,int a9){return a9;}
int niwa_p10(int a1,int a2,int a3,int a4,int a5,int a6,int a7,int a8,int a9,int a10){return a10;}
```

```ts
import { dlopen, FFIType } from "bun:ffi";
const i32 = FFIType.i32;
const lib = dlopen("./libprobe.dylib", {
  niwa_p8: { args: Array(8).fill(i32), returns: i32 },
  niwa_p9: { args: Array(9).fill(i32), returns: i32 },
  niwa_p10: { args: Array(10).fill(i32), returns: i32 },
});
const a = (n: number) => Array.from({ length: n }, (_, i) => i + 1);
lib.symbols.niwa_p8(...a(8));  // => 8  （正しい）
lib.symbols.niwa_p9(...a(9));  // => 9  （正しい）
lib.symbols.niwa_p10(...a(10)); // => 0 （本来は10。以降の引数も同様に壊れる）
```

環境: macOS 26.6 (arm64) / Bun 1.3.13。引数がポインタ型（`FFIType.ptr`）だと戻り値が
壊れるだけでは済まず、その場でセグフォになる。Windows(x64)では未検証。

## 新しいBunでの状況

macOS(arm64)では**Bun 1.4.0以降で再現しない**（2026-11-03、Bun 1.4.0と1.4.4で確認）。上の再現コードは
`niwa_p10`が10を返し、引数13個の関数や、9個目より後ろにポインタ引数を置いた12引数の関数も
正しい値を受け取った。

Windows(x64)でも**Bun 1.4.4（electrobun 2.0.5の同梱Bun）で再現しない**（2026-11-03確認）。
呼び出し規約がarm64と異なるため、zigで`x86_64-windows-gnu`向けにクロスビルドしたDLLで同じ確認をした。
`niwa_p10`は10を、引数13個の関数は全引数の合計を返し、11番目にポインタ引数を置いた12引数の関数も
ポインタの先と前後の引数を正しく受け取った。

それでも下の回避策（9個以下に収める）は引き続き守る。アプリ本体は同梱Bunで動くが、`bun test`と
`niwa`コマンドは開発者・利用者の手元のBunで動き、1.4.0より古いこともある（Windows実機の開発用Bunは
1.3.14だった）。既存の`niwa_dump_selection`も構造体ポインタ渡しのままにしている。

## 回避策

**引数は9個以下に収める。** 項目が多い場合はスカラーを並べるのをやめ、
`int32_t`だけを並べた構造体をポインタで1つ渡す。JS側は`Int32Array`をそのまま
`ptr()`で渡せばよく、パディングもアライメントのずれも生じない。

```c
typedef struct {
  int32_t emit;
  int32_t tag;
  int32_t start_x;
  /* ... */
} NiwaDumpSelectionOptions;

int niwa_dump_selection(GhosttyTerminal term, const NiwaDumpSelectionOptions *o,
                        uint8_t *buf, size_t buf_len, size_t *out_written);
```

```ts
const opts = new Int32Array(9); // C側の並び順と一対一で対応させる
opts[0] = emit;
shim.symbols.niwa_dump_selection(term, ptr(opts), ptr(buf), BigInt(buf.length), ptr(writtenBuf));
```

構造体の**値渡し**はbun:ffiが元々サポートしないため（CLAUDE.md「bun:ffiのハマりどころ」参照）、
シムに新しい関数を足す際は「値渡しをスカラーへ展開する」だけでなく
「展開しすぎて引数が10個以上にならないか」も併せて気にすること。
