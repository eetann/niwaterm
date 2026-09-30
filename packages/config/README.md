# @niwaterm/config

niwatermの設定ファイル（`~/.config/niwaterm/niwaterm.config.ts`）向けの型定義・ヘルパー関数。

```ts
import { defaultAppearance, defaultKeybindings, defineConfig } from "@niwaterm/config";

export default defineConfig({
  keybindings: {
    ...defaultKeybindings,
    bindings: {
      ...defaultKeybindings.bindings,
      d: "split-horizontal",
    },
  },
  appearance: {
    ...defaultAppearance,
    fontSize: 14,
  },
});
```

設定ファイルの変更は再起動なしで反映される（ホットリロード）。

セットアップ手順は[website/src/content/docs/getting-started.md](../../website/src/content/docs/getting-started.md)、設定項目ごとの書き方は[website/src/content/docs/](../../website/src/content/docs/)配下の各ページを参照。
