---
title: オブジェクト形式のキーバインド
description: キーに動作の名前を割り当てるだけなら、keybindingsを関数ではなくオブジェクトで書ける
---

キーに[アクション](/niwaterm/keybindings/actions/)の名前を割り当てるだけなら、設定ファイルの`keybindings`を関数ではなくオブジェクトで書ける。関数の処理を割り当てたり、キーの割り当てを外したりするときは、[関数で書く形](/niwaterm/keybindings/#キーの割り当てを変える)を使う。

```ts
import { defineConfig } from "@niwaterm/config";

export default defineConfig({
  keybindings: {
    bindings: {
      d: "split-horizontal",
      "shift+d": "split-vertical",
      h: { target: "resize-left", repeat: true },
    },
  },
});
```

書いたキーだけがデフォルトの割り当てから置き換わり、書いていないキーはデフォルトのまま使える。

## 書ける項目

| 項目              | 内容                                                                                                                                                                          |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `prefix`          | prefixキー。デフォルトは`"ctrl+b"`                                                                                                                                            |
| `bindings`        | prefixキーのあとに押すキーと、アクションの名前の組。`{ target: "アクション名", repeat: true }`と書くと[続けて押せる](/niwaterm/keybindings/#続けて押せるようにする)ようになる |
| `direct`          | prefixなしで押すキーと、アクションの名前の組（関数で書く形の`noPrefix: true`にあたる）                                                                                        |
| `copyMode`        | コピーモードの中で押すキーと、[コピーモードのアクション](/niwaterm/keybindings/actions/#コピーモード)の名前の組。`"g g"`のように空白で区切ると続けて押すキーになる            |
| `copyModeSearch`  | コピーモードで検索する文字を打っているあいだのキーと、アクションの名前の組                                                                                                    |
| `repeatTimeoutMs` | `repeat: true`のキーを続けて押せる時間（ミリ秒）。デフォルトは500                                                                                                             |

キーの書き方は、関数で書く形と同じ（[キーの書き方](/niwaterm/keybindings/#キーの書き方)）。
