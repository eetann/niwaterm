---
title: ホバーボタン
description: タブの端に自分で決めたボタンを置く。押すとボタンや目次が開き、選ぶと好きな処理を実行する
---

ホバーボタンを使うと、タブの端に自分で決めたボタンを置ける。端に出る小さな取っ手を押すと枠が開き、ボタンが並ぶ。「このタブのディレクトリでlazygitを開く」のような、そのタブに合わせた操作をマウスで呼び出せる。

```ts
hoverButtons: [
  {
    position: "bottom-right",
    items: (tab, niwa) => [
      {
        label: "lazygit",
        tooltip: "このディレクトリでlazygitを開く",
        run: () => niwa.popup.open({ command: "lazygit", cwd: tab.cwd }),
      },
    ],
  },
],
```

この例では、タブの右下に取っ手が出る。押すと「lazygit」のボタンが開き、選ぶとlazygitがポップアップで開く。取っ手をもう一度押すか、枠の外を押すか、`Escape`を押すと閉じる。

ホバーボタンはタイルごと（タブの表示されている範囲ごと）に出る。タイルを分割していれば、それぞれのタイルの端に出る。ターミナルのタブにだけ出て、ブラウザタブ・カスタムビューのタブ・ポップアップには出ない。

## Claude Codeのプロンプトの目次を出す

すぐ使える例として、Claude Codeで打ったプロンプトの目次を出す`claudePromptJump()`を用意している。Claude Codeを動かしているタブにだけ出る。目次の線にマウスを乗せるとプロンプトが出て、クリックするとClaude Codeの画面がそのプロンプトの位置まで移る。

```ts
import { claudePromptJump, defineConfig } from "@niwaterm/config";

export default defineConfig({
  hoverButtons: [claudePromptJump()],
});
```

置く場所は`claudePromptJump({ position: "right" })`のように変えられる。Claude Code側にも入れるものがある。導入手順はリポジトリの`contrib/agent-integration/claude-code/prompt-jump/`にある。

## ボタンを組み立てる（items）

`items`は、枠に並べるボタンの配列を返す関数。取っ手を押して枠を開くたびに呼ばれるので、ファイルを読んだりコマンドを実行したりして、その時々で違うボタンを並べられる。ボタンが1つならボタンが1つ、複数なら目次のように並ぶ。

1つ目の引数`tab`にはタブの情報が、2つ目の引数`niwa`にはniwatermを操作するためのAPI（[niwa API](/niwaterm/keybindings/api/)）が入る。

| `tab`の項目 | 内容                                                                                                  |
| ----------- | ----------------------------------------------------------------------------------------------------- |
| `tabId`     | タブのid                                                                                              |
| `cwd`       | タブが今いるディレクトリ。[シェル統合](/niwaterm/shell-integration/)を入れていないと`undefined`になる |
| `vars`      | タブの[タブ変数](/niwaterm/cli/commands/#タブ変数tab-var)                                             |
| `tabName`   | 自分で付けたタブの名前。付けていなければ`undefined`                                                   |

ボタン1つ分の項目は次のとおり。

| 項目      | 内容                                                  |
| --------- | ----------------------------------------------------- |
| `label`   | ボタンに出す文字                                      |
| `html`    | 文字の代わりに出すHTML                                |
| `tooltip` | マウスを乗せたときに出る説明。省略すると`label`が出る |
| `run`     | 押したときに実行する関数                              |

`html`を使うと、文字の代わりに線や印だけを並べられる。見た目は`css`で決める。

```ts
{
  id: "toc",
  position: "right",
  css: `.toc-tick { width: 14px; height: 2px; background: currentColor; opacity: 0.5 }`,
  items: async (tab) => {
    const prompts = await readPrompts(tab.cwd);
    return prompts.map((prompt) => ({
      html: '<span class="toc-tick"></span>',
      tooltip: prompt.text,
      run: () => jumpTo(prompt),
    }));
  },
},
```

コマンドの出力やファイルの中身を`html`に入れるときは、`<`や`&`をエスケープする。`css`はniwatermの画面全体に当たるので、クラス名に`id`を含めるなどしてほかと重ならない名前にする。

## 出すタブを絞る（show）

`show`を書くと、`true`を返したタブにだけホバーボタンが出る。省略するとすべてのターミナルのタブに出る。

```ts
{
  position: "right",
  // AIエージェントを動かしているタブにだけ出す
  show: (tab) => tab.vars["agent_status"] !== undefined,
  items: () => [...],
},
```

`show`はタブの状態が変わるたびに呼ばれる。時間のかかる処理は`show`ではなく`items`に書く。

自分で目印を付けて絞りたいときは、そのタブで`niwaterm tab var set <名前> <値>`を実行し、`show`で`tab.vars`を見る。

## 取っ手の見た目を変える（handle）

取っ手の形は`handle`で変える。

```ts
{
  position: "bottom-right",
  handle: { style: "floating", icon: "📑" },
  items: ...,
},
```

| 項目    | 内容                                                                                           |
| ------- | ---------------------------------------------------------------------------------------------- |
| `style` | `"edge"`（デフォルト）はタブの端にくっついた形、`"floating"`は端から少し離れて浮いた丸いボタン |
| `shape` | `"edge"`のときの形。`"diamond"`（デフォルト）・`"round"`・`"rect"`                             |
| `icon`  | `"floating"`のボタンの中に出すHTML。デフォルトは`☰`                                           |

もっと細かく変えたいときは、`css`で`.hover-handle`を指定する。`--hover-handle-size`を変えると、形を保ったまま大きさが変わる。

```ts
css: `
.hover-handle[data-button-id="toc"] { --hover-handle-size: 18px; background: #f0c070; }
`,
```

### 取っ手を出さない

取っ手がターミナルの文字に重なって邪魔なときは、`handle: false`にする。取っ手は出なくなり、タブの端にマウスを近づけたあいだだけ枠が開く。端からどれだけ近づけたら開くかは`trigger`（ピクセル、デフォルトは24）で変える。

## 同じ場所に複数置く

同じ`position`に複数のホバーボタンを置くと、設定に書いた順につながって開く。取っ手は1つにまとまる。

## 表示を確かめる（`tab hover`）

CLIから、ホバーボタンに並ぶボタンを一覧したり、枠を開いたままにしたりできる。見た目を確かめたり、スクリーンショットを撮ったりするときに使う。

```sh
niwaterm tab hover list [--tab <tabId>]
niwaterm tab hover reveal --position <position> [--tab <tabId>]
niwaterm tab hover hide [--tab <tabId>]
```

- `tab hover list` — そのタブに出るホバーボタンと、並ぶボタンの名前を一覧する
- `tab hover reveal` — 指定した位置の枠を、開いたままにする
- `tab hover hide` — `reveal`で開いた枠を閉じる

`--tab`を省くと、コマンドを実行したタブが対象になる。

## 設定項目の一覧

| 項目       | デフォルト       | 内容                                                                                                       |
| ---------- | ---------------- | ---------------------------------------------------------------------------------------------------------- |
| `position` | `"bottom-right"` | 置く場所。`top-left`・`top`・`top-right`・`left`・`right`・`bottom-left`・`bottom`・`bottom-right`から選ぶ |
| `items`    | （必須）         | [並べるボタンを返す関数](#ボタンを組み立てるitems)                                                         |
| `show`     | すべてのタブ     | [出すタブを決める関数](#出すタブを絞るshow)                                                                |
| `handle`   | `"edge"`の取っ手 | [取っ手の見た目](#取っ手の見た目を変えるhandle)。`false`で取っ手を出さない                                 |
| `trigger`  | `24`             | `handle: false`のとき、端からどれだけ近づけたら開くか（ピクセル）                                          |
| `css`      | なし             | ボタンや取っ手の見た目を変えるCSS                                                                          |
| `id`       | `position`の値   | CLIから指すときの名前                                                                                      |
