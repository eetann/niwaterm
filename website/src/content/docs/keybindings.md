---
title: キーバインド
description: prefix方式のキーバインドを関数ベースAPIで書く方法と、連打・説明表示・ファイル分割・制約
---

niwatermのキーバインドはtmux風の**prefix方式**。まずprefixキー（既定`ctrl+b`）を押し、離してから2打目のキー（例: `d`）を押すとアクションが発火する（タイムアウトは無く、2打目キーの入力があるまで待ち続ける。`Escape`または割り当てのないキーでキャンセルできる）。コピー・ペーストのような頻用操作だけは、prefixを介さず即座に発火する`direct`ショートカットとして別枠を持てる。`repeat: true`を付けたバインドは、発火後`repeatTimeoutMs`（既定500ms）以内ならprefix無しで連打できる（tmuxの`bind-key -r`相当。詳細は下記「repeatによる連打」参照）。

`keybindings`の指定方法は2つある。単純な文字列アクションの割り当てのみで済むなら[オブジェクト形式](/niwaterm/keybindings/object-format/)で十分だが、複数アクションの束ね・条件分岐・シェル実行を伴う複雑なバインド（`.tmux.conf`にあるような`bind-key`）を書きたい場合は関数ベースAPIを使う。

## 関数ベースAPI（推奨）

`niwa`（`niwa.keybind`等）を使って1エントリずつ登録する形。**デフォルトキーバインドは先に登録済みの状態で関数が呼ばれる**ため、上書き・追加したい分だけ書けばよい（`niwa.unbind`で個別に解除もできる）。

```ts
import { defineConfig } from "@niwaterm/config";

export default defineConfig({
  keybindings: (niwa) => {
    niwa.keybind("d", "split-horizontal"); // 既存アクション名の文字列で上書き
    niwa.keybind("m", () => {
      // 任意のTSコードを書ける。tmuxのif-shell/run-shell/{}束ねに相当することは
      // 素のif文・Bun.spawn・複数行の関数呼び出しで表現する（専用DSLは増やさない）
      niwa.popup.open({ width: 80, height: 80, command: "lazygit" });
    });
  },
});
```

`niwa.keybind`のhandlerは**実際にそのキーが押された時**に呼ばれる（configファイル実行時ではない）。`niwa.tile.current()`等はその時点の実際の状態を返す。handlerの中で呼べるAPIの一覧は[niwa API](/niwaterm/keybindings/api/)にまとめてある。

`noPrefix: true`で`alt+`を含むキーを割り当てると、tmuxの`bind-key -n M-key`相当の即時発火バインドになる。ただしAlt(Option)キー単独の組み合わせはシェルのreadlineショートカット（`Alt+b`で単語移動等）やmacOSの特殊文字入力に使われることがあるため、割り当てるとそのキーはniwaterm側に横取りされ、シェル側へは届かなくなる点に注意する。

## repeatによる連打

`opts.repeat: true`を付けたバインドは、発火後`repeatTimeoutMs`（既定500ms、`niwa.repeatTimeout(ms)`で変更可）以内ならprefix無しで同じ2打目キーテーブルのrepeatableなキーを連打できる（tmuxの`bind-key -r`相当）。`.tmux.conf`の`bind-key -r H/J/K/L resize-pane -L/-D/-U/-R`に相当する例:

```ts
keybindings: (niwa) => {
  niwa.repeatTimeout(300); // 省略時は500ms
  niwa.keybind("h", "resize-left", { repeat: true });
  niwa.keybind("j", "resize-down", { repeat: true });
  niwa.keybind("k", "resize-up", { repeat: true });
  niwa.keybind("l", "resize-right", { repeat: true });
},
```

`resize-up`/`resize-down`/`resize-left`/`resize-right`はフォーカス中タイルを既定の1ステップ分（`niwa.tile.resize`と同じ量）だけ拡大する組み込みアクションで、既定キーは割り当てられていない（上記のように自分で割り当てる）。`repeat`は`bindings`（prefix経由の2打目キー）側でのみ効果を持ち、`noPrefix: true`のdirectショートカットには効果がない（directは元々prefix無しの即時発火で、キーを押し続ければOSのキーリピートがそのまま連続入力を生むため）。

## 一覧での説明表示

現在有効なキーバインドは`niwaterm keybind list`（詳細: [CLIからの操作](/niwaterm/cli/)）で確認できる。一覧に出るのは既定ではアクション名（文字列アクション）または`function`（関数ハンドラ）のため、関数ハンドラには`opts.description`で何をするバインドなのかを添えておくと読める一覧になる。

```ts
niwa.keybind(
  "r",
  async () => {
    await niwa.reloadConfig();
    niwa.notify({ title: "設定をリロードしました" });
  },
  { description: "設定をリロードして通知する" },
);
```

```
ctrl+b r          設定をリロードして通知する
```

## 複数ファイルへの分割

キーバインドを関心事ごとに複数ファイルへ分けたい場合、各ファイルは`niwa`を受け取る関数をexportし、エントリファイル（`niwaterm.config.ts`）側でimportして呼び出す。

```ts
// keymaps.ts
import type { Niwa } from "@niwaterm/config";

export function applyTileKeymaps(niwa: Niwa): void {
  niwa.keybind("d", "split-horizontal");
}

// niwaterm.config.ts
import { defineConfig } from "@niwaterm/config";
import { applyTileKeymaps } from "./keymaps";

export default defineConfig({
  keybindings: (niwa) => {
    applyTileKeymaps(niwa);
  },
});
```

エントリファイル以外（上記の`keymaps.ts`）の変更もホットリロードで拾われる（[「ホットリロード」節](/niwaterm/getting-started/#ホットリロード)参照）。

## 制約

- **`ctrl`修飾子は未対応**。既存機能がcmd/shift/altしか使っていないため、今回の型・パーサでは対象外（将来Ctrl系のキーバインドが必要になったら拡張する）
- **macOSのOption+英数字キーは英数字・数字キーのみ対応している**。Optionを押しながら文字キーを押すと`e.key`がUnicode記号やデッドキーに変わる（`Option+P`→`π`、`Option+N`→`˜`）が、`alt+n`のような英数字（`a`〜`z`）・数字（`0`〜`9`）のバインドは物理キー位置(`e.code`)から復元しているため`noPrefix`/`direct`でもそのまま動く。一方、記号キー（`alt+;`等）はレイアウトでキー位置がずれるため復元対象外で、macOSでは意図通りマッチしない可能性がある。詳細: `docs/known-issues/macos-option-key-breaks-alt-keybindings.md`
- **Shiftで入力する記号は`shift+`を付けずに書く**。`|`・`:`・`+`のようにShiftを押して打つ記号は、押した結果の文字そのもので`niwa.keybind("|", ...)`と書けば一致する（Shiftの要否はキーボード配列で変わるため、Shift付きで一致するバインドが無ければShift無しの表記でも引き直している）。英字は従来どおり`d`と`shift+d`を区別する。なおmacOSのJIS配列では`¥`キーの既定入力が`¥`なので、`\`のバインドは`Option+¥`で打つか、入力ソースの設定で`¥`キーを`\`に切り替える必要がある
