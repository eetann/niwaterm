# Claude Prompts カスタムビュー

Claude Codeのタブの端に「線だけの目次」を出し、選んだプロンプトのやりとりをサイドバーで読む。

- タブの右端へマウスを寄せると、そのセッションで打ったプロンプトが1本1本の線として並ぶ
- 線にマウスを載せるとプロンプトの冒頭がツールチップで出る
- クリックするとサイドバーがこのビューへ切り替わり、そのプロンプトからのやりとりが出る
- ビューの`‹` `›`（または `←` `→`）で前後のプロンプトへ移る。`目次`ボタンで一覧からも飛べる
- thinkingとツール結果は畳んである（クリックで開く）

**Claude Codeの画面をスクロールしても過去のやりとりは出てこない**。Claude Codeは
alternate screenで動いていて、会話はniwaterm側のスクロールバックに1行も残らないため
（[docs/known-issues/claude-code-history-not-in-scrollback.md](../../../docs/known-issues/claude-code-history-not-in-scrollback.md)）。
このビューは画面ではなくtranscript（jsonl）を読むので、コンテキスト圧縮で画面から消えた
やりとりも辿れる。

## 前提

[エージェント統合](../../agent-integration/claude-code/)を入れて、Claude Codeを再起動しておく。

```sh
niwaterm agent setup claude-code
```

hooksがtranscriptの在り処をタブ変数`agent_transcript`へ書き込み、それを頼りに目次を作る。
入れていないタブには目次の帯を張らない（`claudePromptShow`の判定）。
導入前から動いていたセッションでは、次にプロンプトを打った時点で変数が埋まる。

## 導入

```sh
mkdir -p ~/.config/niwaterm/custom-views
cp contrib/custom-views/claude-prompts/claude-prompts.html ~/.config/niwaterm/custom-views/
cp contrib/custom-views/claude-prompts/handlers.ts ~/.config/niwaterm/custom-views/claude-prompts-handlers.ts
```

`~/.config/niwaterm/niwaterm.config.ts`へ追記する。目次（`hoverButtons`）とビューア（`customViews`）は
選択状態を共有しているので、両方まとめて登録する。

```ts
import { defineConfig } from "@niwaterm/config";
import {
  claudePromptCss,
  claudePromptHandlers,
  claudePromptItems,
  claudePromptShow,
} from "./custom-views/claude-prompts-handlers.ts";

export default defineConfig({
  customViews: [
    {
      id: "claude-prompts",
      name: "Claude Prompts",
      path: "./custom-views/claude-prompts.html",
      handlers: claudePromptHandlers,
    },
  ],
  hoverButtons: [
    {
      position: "right",
      show: claudePromptShow,
      items: claudePromptItems,
      css: claudePromptCss,
    },
  ],
});
```

`customViews`の`id`は`claude-prompts`のままにする。目次のクリックが
`niwaterm sidebar switch --view claude-prompts`でこのビューを開くため。

保存するとホットリロードで反映される。タブとして大きく開きたい場合は
`niwaterm tab new --custom-view --view claude-prompts`を使う。

## CLIから直接読む

ビューを使わず、同じ内容をターミナルから読むこともできる。

```sh
niwaterm claude prompt list            # そのタブで打ったプロンプトの一覧
niwaterm claude prompt show --prompt 3 # 3番目のプロンプトからのやりとり
```

詳細は[docs/guide/cli.md](../../../docs/guide/cli.md)の「Claude Codeのセッション参照」節を参照。

## 変えたくなりそうなところ

すべて`handlers.ts`の中にある。

| 場所 | 既定 | 変える理由 |
|---|---|---|
| `const CLI` | `"niwaterm"` | wipビルドで試すなら`"niwaterm-dev"` |
| `TOOLTIP_CHARS` | `140` | ツールチップで読める量を増やしたい・減らしたい |
| `claudePromptShow` | `agent`が`claude-code`のタブだけ | 他のエージェントのタブにも出したい |
| `claudePromptItems`の`html` | 線1本 | 番号や文字を出したいなら`label`を書く形に変える |
| `run`の`sidebar switch` | サイドバーへ出す | タブで開きたいなら`tab new --custom-view --view claude-prompts` |

目次を出す辺は`position`で変えられる（`right`・`left`・`top`等の8方向）。

## 削除

`hoverButtons`と`customViews`からこの要素を消す。どちらも配列ごと消すとその機能自体がオフになる
（`hoverButtons`なら帯が出なくなり、`customViews`ならサイドバーのビュー切替タブも出なくなる）。
