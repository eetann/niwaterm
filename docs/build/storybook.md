---
type: Runbook
title: StorybookでUIコンポーネントを確認する
description: src/mainview/react/のReactコンポーネントを、アプリを起動せずに状態別に確認するためのStorybookの使い方と前提
---

# StorybookでUIコンポーネントを確認する

モーダル・コマンドパレット・URLツールバーのように最初から画面に出ていないUIや、
サイドバーのワークスペース一覧のように分岐が多いUIは、アプリを起動して状態を作るのが手間になる。
これらを状態別に並べて確認するためにStorybookを置いている。

## 起動

```sh
bun run storybook        # http://localhost:6006/ で開発サーバーを起動
bun run build-storybook  # storybook-static/へ静的ビルド
```

WSLで起動した場合も、Windows側のブラウザから`http://localhost:6006/`で開ける。

## ストーリーの置き場所と書き方

ストーリーは対象コンポーネントの隣に`<name>.stories.tsx`として置く（`.storybook/main.ts`の
`stories`が`src/mainview/**/*.stories.tsx`を拾う）。Electrobunのビルドはentrypointからの
import連鎖だけを束ねるため、ストーリーがアプリ本体へ混ざることはない。

- コンポーネントはpropsだけで描画できる作りになっているので、RPCやbun側の状態は使わず
  propsへ固定値を渡す。コールバックは`storybook/test`の`fn()`を渡すと、Actionsパネルで呼び出しを確認できる
- `index.css`のIDセレクタ（`#sidebar`・`#sidebar-list`等）や`.browser-toolbar`のような
  親要素のクラスでレイアウトが決まるコンポーネントは、decoratorで本番と同じ入れ子を再現する
- `BrowserToolbar`の`webviewEl`のようにElectrobun固有の要素を受け取るものは、使われるメソッドだけを
  持つ代役を渡す

## 本番の見た目との差

- **テーマ**: 本番は`index.ts`の`applyAppearance`・`applyThemeMode`が設定値からCSS変数と`.dark`クラスを
  流し込む。Storybookでは`.storybook/preview.tsx`のdecoratorが同じ変数を入れており、ツールバーの
  Themeでdark（既定の配色）とlight（明るい地での崩れの確認用）を切り替えられる。ユーザー設定の配色は反映されない
- **Tailwind**: 本番は`scripts/build-tailwind.ts`がCLIで事前生成するが、Storybookはストーリー編集に
  追従させるため`@tailwindcss/vite`で生成する。入力はどちらも`src/mainview/index.css`
- **レンダリングエンジン**: 開いたブラウザのエンジンで描画される。WebView2（Windows）・WKWebView（macOS）固有の
  差（フォント・スクロールバー等）は実機で確認する
