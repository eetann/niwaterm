# @niwaterm/config

niwatermの設定ファイル（`~/.config/niwaterm/niwaterm.config.ts`）向けの型定義・ヘルパー関数。

```ts
import { defaultAppearance, defaultKeybindings, defineConfig } from "@niwaterm/config";

export default defineConfig({
  keybindings: {
    ...defaultKeybindings,
    "cmd+d": "split-horizontal",
  },
  appearance: {
    ...defaultAppearance,
    fontSize: 14,
  },
});
```

設定ファイルの変更は再起動なしで反映される（ホットリロード）。

セットアップ手順・DSL仕様は[docs/config.md](../../docs/config.md)を参照。
