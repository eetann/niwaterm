---
title: ホバーボタン
description: タブの端にマウスを寄せると出るボタン（hoverButtons）の設定と、CLIでの確認方法
---

タブの表示領域の端に、そのタブ専用のボタンを置ける。`hoverButtons`は「1つの位置に置く枠」の配列で、端に出た取っ手を押すと枠が開き、`items`が組み立てた項目が並ぶ。項目が1つならただのボタン、複数なら目次のように並ぶ。

```ts
hoverButtons: [
  {
    position: "bottom-right",
    items: (tab, niwa) => [
      { label: "git", run: () => niwa.popup.open({ command: "lazygit", cwd: tab.cwd }) },
    ],
  },
],
```

| フィールド | 型                | 意味                                                                                                                |
| ---------- | ----------------- | ------------------------------------------------------------------------------------------------------------------- |
| `id`       | `string`          | CLI（`niwaterm tab hover reveal`）から指すためのid。省略時は`position`（重複時は`right-2`のような連番付き）         |
| `position` | `string`          | 置く位置。`top-left` / `top` / `top-right` / `left` / `right` / `bottom-left` / `bottom` / `bottom-right`（省略時） |
| `show`     | `function`        | そのタブに出すかの判定。省略時は全てのターミナルタブに出る                                                          |
| `items`    | `function`        | 枠を開いた時に並べる項目を組み立てる                                                                                |
| `css`      | `string`          | `items`の`html`・取っ手の見た目を変えるCSS                                                                          |
| `handle`   | `object \| false` | 取っ手の見た目（後述）。`false`なら取っ手を出さず、端へマウスを寄せた間だけ枠を出す                                 |
| `trigger`  | `number`          | `handle: false`のときの呼び出しの帯の太さ(px)。省略時は24。2〜200へ丸める                                           |

基準は**タブの表示領域**（タイルの内側）で、ウィンドウ全体ではない。タイルを分割していれば、それぞれのタイルの端に出る。同じ位置に複数の枠を置いた場合は設定に並べた順に繋がって出る。上下の辺・四隅に置いた枠は横並び、左右の辺に置いた枠は縦並びになる（変えたい場合は`css`で`.hover-panel`の`flex-direction`を上書きする）。

## 取っ手（handle）

取っ手は常に出ていて、押すと枠が開く。もう一度取っ手を押す・枠の外を押す・Escのどれかで閉じる。取っ手のぶんだけターミナルの端が隠れるので、邪魔なら`position`で置き場所を変えるか`handle: false`にする。

| フィールド | 型       | 意味                                                                                        |
| ---------- | -------- | ------------------------------------------------------------------------------------------- |
| `style`    | `string` | `"edge"`（端に貼り付く形。省略時） / `"floating"`（端から少し離れて浮く丸いアイコンボタン） |
| `shape`    | `string` | `"edge"`の形。`"round"` / `"rect"` / `"diamond"`（省略時）                                  |
| `icon`     | `string` | `"floating"`のボタンに差し込むHTML。省略時は`☰`                                            |

`"edge"`の形は置いた位置に合わせて切り取られる。

| `shape`   | 辺（`right`・`top`等） | 角（`bottom-right`等）    |
| --------- | ---------------------- | ------------------------- |
| `round`   | 内側へ膨らむ半円       | 1/4円                     |
| `rect`    | 細長い長方形           | 正方形                    |
| `diamond` | 三角（ひし形の半分）   | 直角三角形（ひし形の1/4） |

```ts
{
  position: "bottom-right",
  handle: { style: "floating", icon: "📑" },
  items: ...,
},
```

これ以上の見た目は`css`で変えられる。取っ手は`.hover-handle`で、`data-button-id`・`data-position`・`data-style`・`data-shape`を持ち、開いている間は`data-open`が付く。大きさは`--hover-handle-size`（既定12px）から導いているので、これを変えれば形を保ったまま伸縮する。枠は取っ手の実寸を測って重ならない位置に開く。

```ts
css: `
.hover-handle[data-button-id="toc"] { --hover-handle-size: 18px; background: #f0c070; }
`,
```

同じ位置に取っ手ありの枠が複数あれば、取っ手は1つだけ出て（見た目は設定で先に並べた枠のもの）、押すと全部が並ぶ。

## 取っ手を出さない（handle: false）

`handle: false`の枠は、端へマウスを寄せた間だけ開く。呼び出しの帯は端から24px（`trigger`で変えられる）で、左右の辺は縦方向の中央半分（四隅は上下の辺が持つ）でだけ反応する。帯はDOM要素ではないため、出ていない間のクリック・選択・マウスレポートは奪わない。マウスを離すと閉じる（Escでも閉じる）。

## 出すタブを絞る（show）

`show`はタブ変数・cwdでタブを絞る同期の関数。タブの状況が変わったときに評価されるので、非同期処理や重い処理は書かない（重い処理は`items`側に置く）。

```ts
{
  position: "right",
  // エージェント統合のhookが書き込むタブ変数を見て、Claudeを動かしているタブにだけ出す
  show: (tab) => tab.vars["agent_status"] !== undefined,
  items: () => [...],
},
```

`show`・`items`の第1引数には、そのタブの状況が渡る。

| フィールド | 型                       | 意味                                                                                                                           |
| ---------- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| `tabId`    | `string`                 | そのタブのid                                                                                                                   |
| `cwd`      | `string \| undefined`    | そのタブが報告している作業ディレクトリ。シェル統合（OSC 7）を入れていないタブでは`undefined`                                   |
| `vars`     | `Record<string, string>` | そのタブのタブ変数（`niwaterm tab var set`・シェル統合・エージェント統合のhookが書き込む）。`cwd`もこの中の`"cwd"`に入っている |
| `tabName`  | `string \| undefined`    | サイドバーから設定したタブ名。未設定は`undefined`                                                                              |

`show`を使わずタブを絞りたい場合は、`niwaterm tab var set`で目印の変数を立てて`show`から読むのが手軽（シェルのフック・エージェントのhookから叩ける）。

## 項目を組み立てる（items）

`items`は枠を開くたびに呼ばれるので、ファイルの読み直し・コマンド実行を伴う動的な項目も書ける。第2引数は[キーバインドの関数ハンドラ](/niwaterm/keybindings/#関数ベースapi推奨)と同じ`niwa`。

| フィールド | 型         | 意味                                        |
| ---------- | ---------- | ------------------------------------------- |
| `label`    | `string`   | 表示するテキスト                            |
| `html`     | `string`   | `label`の代わりに差し込むHTML               |
| `tooltip`  | `string`   | マウスを載せた時に出る説明。省略時は`label` |
| `run`      | `function` | 押した時の処理。非同期でもよい              |

`html`を使うと、文字ではなく印だけを並べるような見た目も作れる。クリックの拾い方・並べ方はniwaterm側が持つので、`a`要素や`button`要素にする必要はない。

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

`html`はniwaterm本体のwebviewへそのまま入る。コマンド出力・ファイルの中身のような外から来た文字列を埋め込むときは、自分でエスケープすること。`css`はwebviewの`<style>`へそのまま入るので、class名に`id`を含める等でniwaterm本体や他のボタンと衝突しないようにする。

関数が例外を投げた場合・配列以外を返した場合・`label`も`html`も持たない項目は、警告付きで無視される。

そのまま使える例として、`@niwaterm/config`の`claudePromptJump()`がある（Claude Codeのプロンプトを線の目次として並べ、クリックしたプロンプトへClaude Code側の表示を移す）。`hoverButtons: [claudePromptJump()]`と並べるだけで使え、Claude Code側に入れるmodと導入手順は`contrib/agent-integration/claude-code/prompt-jump/`にある。

## 制約

- **ターミナルタブにだけ出る**。ブラウザタブ・customViewタブはネイティブのオーバーレイがHTMLより手前に描かれるため、重ねても見えずマウスも拾えない
- **ポップアップには出ない**（ポップアップは独自のツールバーを持つため）
- `appearance.tabBar`が`"auto"`のタイルでは、上辺の取っ手・呼び出し帯がオーバーレイ表示のタブバーと同じ場所にある。上辺の帯へマウスを寄せるとタブバーと枠が同時に出て、枠はタブバーの下へ並ぶ
- 画面右上に出るバッジ（`COPIED`・`SCROLLBACK`）と`top-right`の取っ手・枠は重なる

## CLIで確認する（`tab hover`）

```sh
niwaterm tab hover list [--tab <tabId>]
niwaterm tab hover reveal --position <position> [--tab <tabId>]
niwaterm tab hover hide [--tab <tabId>]
```

タブの端に出るホバーボタン（設定の`hoverButtons`）を確認・強制表示する。`list`はそのタブで今出せる枠と、その枠に並ぶ項目を`<position>\t<id>`とインデント付きの項目名で表示する。項目は画面に出すときと同じ経路で組み立てるため、`items`が返すものをそのまま確認できる。

`reveal`は取っ手を押した（マウスを寄せた）状態と同じ表示を、マウスの出入りに関係なく出したままにする。取っ手の有無にかかわらず、その位置の枠を全て並べる。`hide`で解除する（項目を押した場合・枠の外を押した場合・Escを押した場合・設定をリロードした場合も解除される）。取っ手のクリックやホバーは合成入力では当てにくいため、実機での目視・スクリーンショット確認にはこちらを使う。`--position`はタブの表示領域の端8方向（`top-left` / `top` / `top-right` / `left` / `right` / `bottom-left` / `bottom` / `bottom-right`）から選ぶ。その位置に出せる枠が無い場合はエラーメッセージと共に終了コード1を返す。

`--tab`省略時はそのコマンドを実行しているタブ（niwaterm外から実行した場合はフォーカス中タイルのアクティブタブ）が対象になる。
