# UIの見た目を書くときのルール

`src/mainview/`でUIの見た目に触れるとき（`*.tsx`、素DOMの`*.ts`が組み立てる`className`、
`index.css`の手書きCSS）のルール。対象読者はAIエージェント・人間問わず、このリポジトリのUIを書く全員。

ここには**どれを選ぶかの判断基準と、正本の場所だけ**を置く。トークンやコンポーネントの一覧は
書き写さない（正本を直したときにここだけ古くなるため）。迷ったら下の正本を開いて確かめる。

## 正本の場所

| 知りたいこと | 見る場所 |
| --- | --- |
| 使える色・角丸・影・文字サイズのトークン | `src/mainview/index.css`の`@theme`/`@theme inline`と`:root` |
| 使える部品（shadcn） | `src/mainview/components/ui/` |
| 既存コンポーネントの状態別の見た目 | 各`*.stories.tsx`（`bun run storybook`、詳細: docs/build/storybook.md） |
| React・Tailwind・shadcnを採用した理由と適用範囲 | docs/adr/0003-adopt-react-tailwind-shadcn-for-ui.md |

`docs/brand/brand-guide.md`（枯山水/苔庭の配色、影・角丸を使わない方針）は**アプリの外側**
（ドキュメントサイト・README・告知画像）向けの決まりで、アプリ内のUIには適用しない。
アプリ内の配色はユーザーのテーマ設定に追従させるものなので、ブランドの色を持ち込まない。

## 新しいUIはReactで書く

ダイアログ・メニュー・サイドバー部品などの新規UIは`src/mainview/react/`にReactで書く。
素DOM（`index.ts`等での直接操作）のまま書くのは、ターミナルグリッドの描画のように性能が
クリティカルな部分と、既に素DOMで出来ている箇所への小さな追加だけ（ADR 0003）。

## 部品は既存→shadcn追加→自作の順で探す

1. `components/ui/`に使える部品があればそれを使う
2. 無ければ`bunx shadcn@latest add <name>`で追加する（`components.json`の設定でそのまま入る）
3. shadcnにも無いときだけ自作する

ボタンの見た目のもの（アイコンボタン・テキストボタン）は`Button`を、入力欄は`Input`を使い、
素の`<button>`・`<input>`へクラスを並べて似せない。例外として、リスト行やカード全体を
クリック可能にするだけの要素（サイドバーのBoard行など）は素の`<button>`でよい。

## 色はテーマトークンだけを使う

`bg-background`・`text-muted-foreground`・`text-warning`・`border-border`のように、
`index.css`で定義したトークンのユーティリティだけを使う。不透明度の修飾（`bg-accent/40`）は使ってよい。

以下は書かない。ユーザーのテーマ設定（`appearance`）に追従しなくなるため。

- Tailwindのパレット（`text-red-500`・`bg-zinc-800`）
- hex・rgbの直書き（`text-[#f38ba8]`、`style={{ color: "#..." }}`、手書きCSSの`color: #...`）

既存のトークンで表せない役割が要るときは、使う側で色を作らずに`index.css`へトークンを足す。
状態を表す色（警告・成功・進行中）は`warning`/`success`/`info`、破壊的な操作は`destructive`を使う。

## 寸法も任意値を使わずトークンに寄せる

角丸は`rounded-xs`〜`rounded-xl`、影は`shadow-sm`〜`shadow-lg`、文字サイズは
`text-3xs`〜Tailwind既定のスケールから選ぶ。`text-[10px]`・`p-[7px]`・`rounded-[5px]`のような
任意値は書かない。1つでも残すと前例として真似され、値がばらけていくため。

合う段階が無いときは任意値で済ませず、`index.css`の`@theme`へ段階を足す（足すべきか迷ったら相談する）。
`ring-[3px]`などshadcnの生成コードに元から入っている任意値は、そのままでよい。

手書きCSSで同じ値を使うときは`var(--radius-sm)`のようにトークンのCSS変数を参照する。

## ツールチップとアイコン

- ツールチップに`title`属性を使わない。Reactは`components/ui/tooltip`の`Tooltip`、素DOMは
  要素に`data-tooltip`属性を付ける（`src/mainview/dom-tooltip.ts`が拾ってshadcnと同じ見た目で出す）
- アイコンはlucide（`lucide-react`）だけを使う。`×`・`▶`のような文字や絵文字をアイコン代わりにしない。
  設定ファイルから文字列で受け取るアイコン名は`src/mainview/lucide-icon-name.ts`で変換する

## 閉じたらフォーカスをターミナルへ返す

キー入力はwebview内でフォーカスを持つ要素からPTYへ送られるため、ダイアログ・メニュー・
ポップオーバーを閉じた後にフォーカスがbodyや開く前のボタンへ残ると、ターミナルへ打てなくなる。
Radix系の部品は閉じる際に開く前の要素へフォーカスを戻すので、`onCloseAutoFocus`で
`preventDefault()`したうえでターミナル（または次に操作させたい欄）へフォーカスする。
実装例は`src/mainview/react/tile-tab-bar.tsx`のタブの右クリックメニュー。

## 作ったら確かめる

- `react/`にコンポーネントを足したら、隣に`*.stories.tsx`を置いて状態別の見た目を確認できるようにする
- 色を触ったらStorybookのツールバーのThemeを明るい地のテーマ（Gruvbox Light・Solarized Light）にしても
  確かめる。暗い地でしか見ていないと、明るい地で文字や枠が消える崩れを見落とす
- 最終確認は実機（`mise run start`で起動するniwaterm-wip）で行う。WebView2・WKWebView固有の描画差や
  ユーザー設定の配色はStorybookに出ない（docs/build/storybook.mdの「本番の見た目との差」）
