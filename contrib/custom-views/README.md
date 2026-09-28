# niwaterm カスタムビューの例

`customViews`は、自分で用意したHTMLをniwatermのサイドバー（とタブ）へ表示する設定。複数登録でき、サイドバー上部のタブで切り替える。
ここにあるのはそのまま使える例で、コピーして自分の設定へ組み込む形を想定している。
設定項目そのものの説明は[docs/guide/config.md](../../docs/guide/config.md)の「ユーザー定義HTML UI（customViews）」を参照。

| 例 | 内容 |
|---|---|
| [worktrees](worktrees/) | gitワークツリーの一覧・絞り込み・作成 |
| [claude-prompts](claude-prompts/) | Claude Codeのプロンプト目次（`hoverButtons`）と会話ビューア |

## 仕組み

HTMLはniwaterm本体とは別プロセス（webview）で動くため、そこから直接gitやniwatermを操作することはできない。
代わりに、設定ファイルへ書いた関数（`customViews[].handlers`）をHTML側から名前で呼ぶ。

```
worktrees.html          niwaterm.config.ts             niwaterm本体
niwaterm.call("list") → handlers.list(payload, niwa) → niwa.shell.run(...)
                      ←        戻り値（JSON）        ←
```

HTML側から見えるのは自分が定義したハンドラだけで、niwatermのAPIが丸ごと露出するわけではない。
ハンドラの中は設定ファイルと同じ実行環境なので、`niwa`（`niwa.shell.run`・`niwa.tab`等）に加えて
`Bun.spawn`・`node:fs`もそのまま書ける。

## 導入の流れ

どの例も手順は同じ。

1. HTMLとハンドラを`~/.config/niwaterm/`配下へコピーする
2. `niwaterm.config.ts`でハンドラをimportし、`customViews`の要素として渡す
3. 設定を保存するとホットリロードで反映される（サイドバー上部のスイッチャーから開く）

各例のREADMEに、コピー先とconfigへの書き方が載っている。
