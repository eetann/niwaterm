# プロンプトの目次とジャンプ

Claude Codeのタブの端にプロンプトの目次を出し、クリックしたプロンプトへClaude Codeの表示を移す。

- タブの右端の取っ手を押すと、そのセッションで打ったプロンプトが縦に並ぶ（もう一度取っ手を押す・外側を押す・Escで閉じる）
- 1項目は「印＋本文の頭」で、**印の濃さがそのプロンプトの長さ**を表す（GitHubの草と同じ見せ方）。
  `ok`のような一言と長い指示を見分けられるので、目当ての場所を思い出しやすい
- マウスを載せるとプロンプトの冒頭がツールチップで出る
- クリックすると、そのプロンプトが画面の先頭に来る位置までClaude Codeの表示が移動する

目次はniwatermのUIで、ターミナルの上に重ねて描く。Claude Codeの画面には何も出ない。

## なぜniwaterm側とClaude Code側に分かれるのか

**niwaterm側から画面の位置を触る余地が無い。** Claude Codeはalternate screenで動くため、
会話はniwatermのスクロールバックに1行も残らない
（[docs/known-issues/claude-code-history-not-in-scrollback.md](../../../../docs/known-issues/claude-code-history-not-in-scrollback.md)）。
表示を動かせるのはClaude Code自身だけなので、こちら側は「どこへ飛びたいか」を渡す役に徹する。

| 置くもの | 置き場所 | 役割 |
| --- | --- | --- |
| `claudePromptJump`（`@niwaterm/config`） | niwatermの設定 | transcriptを読んで目次を並べ、クリックでタブ変数`agent_jump`へプロンプトのuuidを書き、キーを送る |
| `mod/` | Claude Codeのプラグイン | そのキーを受けてタブ変数を読み、`$.ui.scroll`でtranscriptの表示を移す |

プロンプト行の`requestId`はtranscript（jsonl）のuuidと同じ値なので、
`niwaterm claude prompt list`が見せている一覧の値をそのまま渡せる。画面の文字を
読み合わせる必要はない。

**キーを送るのは、transcriptの行を動かすのが「人の操作に応えている間」に限られるため**
（タイマーや通知から呼ぶとengineが`deny: "not person-initiated"`で弾く）。modはキーを
受け取るためのButtonを`display: "none"`で置いているだけなので、画面には出ない。

## 前提

**Claude Code 2.1.260以降**と、function hooks（早期アクセス）を有効にする環境変数。
このAPIは更新の度に変わりうるので、Claude Codeを上げてジャンプが動かなくなったら
まず`mod/hooks/register.tsx`を見る。

[エージェント統合](../)も入れておく。hooksがtranscriptの在り処をタブ変数`agent_transcript`へ
書き込み、それを頼りに目次を作る。入れていないタブには目次の帯を張らない。

```sh
niwaterm agent setup claude-code
```

**エージェント統合を既に入れてある場合も、このコマンドを実行し直す。** transcriptの在り処を
書き込むhookは後から足したもので、`~/.claude/settings.json`へコピー済みの設定は追いつかない。

## 導入

### 1. mod（Claude Code側）

`mod/`をどこかへ置き、`~/.claude/settings.json`から読ませる。

```sh
mkdir -p ~/.config/claude-mods
cp -r contrib/agent-integration/claude-code/prompt-jump/mod ~/.config/claude-mods/niwaterm-prompt-jump
```

```json
{
  "env": {
    "CLAUDE_CODE_ENABLE_FUNCTION_HOOKS": "1",
    "CLAUDE_CODE_PLUGIN_DIRS": "/home/<user>/.config/claude-mods/niwaterm-prompt-jump"
  }
}
```

その場で試すだけなら、環境変数と`--plugin-dir`を直接渡してもよい。

```sh
CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1 claude --plugin-dir ~/.config/claude-mods/niwaterm-prompt-jump
```

`claude plugin validate <mod>`で、読み込まれる形になっているか確かめられる。これを一度実行すると
`mod/.claude-plugin/types/`へ動かしているビルドの型定義が出るので、`mod/tsconfig.json`だけで
エディタの型が付く（生成物はClaude Code側のgitignoreで無視される）。

### 2. 目次（niwaterm側）

目次は`@niwaterm/config`に入っているので、ファイルを置く必要はない。
`~/.config/niwaterm/niwaterm.config.ts`へ追記する。

```ts
import { claudePromptJump, defineConfig } from "@niwaterm/config";

export default defineConfig({
  hoverButtons: [claudePromptJump()],
});
```

保存するとホットリロードで反映される。Claude Codeは入れ直した後に起動し直す。

## 変えたくなりそうなところ

`claudePromptJump()`へオプションを渡して変える。`position`・`handle`・`show`などホバーボタンの
フィールドもそのまま上書きでき、`css`は目次の既定のスタイルの後ろへ足される。

| オプション | 既定 | 変える理由 |
|---|---|---|
| `cli` | `"niwaterm"` | wipビルドで試すなら`"niwaterm-dev"` |
| `jumpKey`とmodの`action` | `C-]`／`app:openArtifact` | 下記の衝突を避けたいとき。**必ず両方揃える** |
| `itemStyle` | `"text"` | 本文を出さず印だけ並べたいなら`"mark"` |
| `labelChars` | `20` | 項目に出す本文の量を増やす・減らす |
| `tooltipChars` | `140` | ツールチップで読める量を増やす・減らす |
| `show` | `agent`が`claude-code`のタブだけ | 他のエージェントのタブにも出したい |
| `position` | `"bottom-right"` | 目次を出す場所を変えたい |

```ts
hoverButtons: [claudePromptJump({ position: "right", handle: { shape: "round" } })],
```

`action`はClaude Codeが持つキーバインドのアクション名でなければならず、
**engine自身がそのアクションを処理できる状態だとそちらが優先される**。既定の
`app:openArtifact`（ctrl+]）はartifactが開ける場面でだけengineが取るので、
そこでジャンプできなくなったら別のアクションに変える。modの`action`は
`~/.claude/settings.json`の`pluginConfigs`からも変えられる。

目次を出す場所は`position`で変えられる（`right`・`left`・`top`等の8方向。どこに置いても目次は縦に並ぶ）。
取っ手の見た目は`handle`で変えられ、`handle: false`にすると取っ手を出さず端へマウスを寄せた間だけ出す。

## うまく動かないとき

| 症状 | 見るところ |
|---|---|
| 目次が出ない | `niwaterm tab var list`に`agent`と`agent_transcript`があるか。エージェント統合を入れる前から動いているセッションでは、次にプロンプトを打った時点で埋まる |
| 目次は出るがクリックで動かない | `claude plugin details niwaterm-prompt-jump`でmodが読めているかを見る。出てこなければ`CLAUDE_CODE_ENABLE_FUNCTION_HOOKS`と`CLAUDE_CODE_PLUGIN_DIRS`の設定を見直す。読めているならキーが別のアクションに取られていないか |
| `niwaterm: ...`というトーストが出る | modは動いていて、ジャンプ先が読めない・engineに断られた。文面がそのまま理由 |

## CLIから直接読む

目次を使わず、同じtranscriptをターミナルから読むこともできる。

```sh
niwaterm claude prompt list            # そのタブで打ったプロンプトの一覧
niwaterm claude prompt show --prompt 3 # 3番目のプロンプトからのやりとり
```

詳細は[website/src/content/docs/agents.md](../../../../website/src/content/docs/agents.md)の「Claude Codeのセッション参照」節を参照。

## 削除

`hoverButtons`からこの要素を消し、`CLAUDE_CODE_PLUGIN_DIRS`からmodを外す。
`hoverButtons`は配列ごと消すとホバーボタンの機能自体がオフになる。
