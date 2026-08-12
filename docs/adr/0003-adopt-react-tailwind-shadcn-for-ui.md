---
type: ADR
title: "ADR 0003: UIにReact + Tailwind CSS + shadcn/uiを導入する"
description: src/mainviewのUI基盤としてReact + Tailwind CSS v4 + shadcn/uiを採用し、daisyUIは不採用とする決定を記録する
---

# ADR 0003: UIにReact + Tailwind CSS + shadcn/uiを導入する

## Status

Accepted

## Context

niwatermのUI（`src/mainview/`）はこれまでReact等のUIフレームワークを一切使わず、`index.ts`が素のDOM操作（`document.getElementById` + `innerHTML`差し替え、`<template>`のクローン）でタブバー・サイドバー・ターミナルグリッドを描画してきた。Tailwind CSSやコンポーネントライブラリも未導入で、`index.css`（444行）は手書きのCSSのみで構成されている。

ロードマップには「サイドバーのブランチ・エージェント状態表示」「通知用サイドバー」など、今後UIの表現力を要する機能が控えている。これらを都度素のDOM操作で組み上げるコストと、モーダル・ドロップダウン・コマンドパレットのようなアクセシビリティ配慮が要る部品を自前実装するコストを比較し、UI基盤を導入するかどうかを検討した。

### 解決したい課題

- モーダル・ドロップダウン等のフォーカストラップ・キーボードナビゲーション・ARIA対応を、niwaterm独自の「webview keydown → RPC → PTY」というフォーカス制御と衝突しない形で実装する手段がない
- 今後追加するUI（サイドバー拡張、ダイアログ等）を都度、素のDOM操作とハンドロールCSSで組み上げるコストが高い
- ロードマップ上のサイドバー機能（エージェント状態表示等）は、チャット風UIや構造化フォームに近い表現が必要になる見込みだが、それらを支える部品が手元にない

### 検討した選択肢

- 選択肢A: 現状維持（素のDOM操作 + ハンドロールCSSを継続）
- 選択肢B: Tailwind CSS + daisyUI（JS非依存のCSSコンポーネントプラグイン）を採用する
- 選択肢C: React + Tailwind CSS + shadcn/ui（Radix UIベースのコンポーネント集）を採用する

### 各選択肢の評価

| 観点 | A: 現状維持 | B: daisyUI | C: shadcn/ui |
|------|------------|-----------|--------------|
| 導入コスト | なし | 低（CSSプラグインを追加するだけ） | 中（Reactランタイムの初導入が必要） |
| モーダル/ドロップダウン等の挙動（フォーカストラップ・ARIA） | 自前実装が必要 | 提供されない（CSSのみ、挙動は自前実装） | Radix UIベースで最初から実装済み |
| 将来のAI/エージェント系UI（チャット風表示・構造化フォーム）との親和性 | 低 | 低 | 高（shadcnエコシステムにAI関連コンポーネント群がある） |
| テーマの選択肢の豊富さ | なし | 高（30種類以上の既製テーマ） | 低（既定では自分でパレットを用意する設計） |
| niwatermの既存アーキテクチャ（Reactフレームワーク非依存）との整合 | 高 | 高（JS非依存） | 低（Reactの新規導入が必要） |

daisyUIはJavaScript非依存のCSSプラグインであり、Reactを導入する前提だと「見た目のクラスを提供するだけで、モーダル等の挙動は自前実装が必要」という立ち位置になる。niwatermは既に「webview keydown → RPC → PTY」というシビアなフォーカス制御を持っており、UI側のモーダル・ドロップダウンでも同様にフォーカス管理が必要になる。shadcnはRadix UIベースでこの挙動が最初から実装済みであり、この観点でdaisyUIより優位と判断した。

また、ロードマップの「サイドバーのブランチ・エージェント状態表示」のような将来機能は、チャット風UIや構造化フォームに近い表現が必要になる見込みで、shadcnのエコシステムにあるAI関連コンポーネント群（構造化フォーム等）と相性が良い。daisyUIの強みであるテーマの豊富さは、コンポーネントシステムを丸ごと併用するのではなく、必要になった時点でパレット（CSS変数の値）だけ個別に参照する形で別途対応することとし、今回はdaisyUI不採用の判断を覆す理由としなかった。

## Decision

**UIフレームワークとしてReactを導入し、Tailwind CSS v4 + shadcn/uiをUI基盤として採用する。daisyUIは不採用とする。**

### 1. 適用範囲

既存の描画性能がクリティカルな部分（ターミナルグリッドの描画、タイル分割ロジック）はReact化のスコープに含めない。今回導入するのは、今後追加する新規UI（ダイアログ、サイドバー拡張等）から使える基盤であり、`src/mainview/index.ts`の既存の初期化フローに`mountReactRoot()`を1行追加する形で、独立した`#react-root`コンテナにReactをマウントしている。

### 2. Tailwind CSSのビルド連携

ElectrobunのビューバンドラーはBun.build()そのものであり、`electrobun.config.ts`の`build.views.mainview`はBun.build()の全オプションをそのまま受け付ける。この性質を利用し、`bun-plugin-tailwind`（Bunの公式`bun init`テンプレートで使われているBunバンドラー用プラグイン）を`plugins`に渡すことで、Tailwindの処理をBun.build()の一部として組み込んでいる。

```ts
// electrobun.config.ts
mainview: {
  entrypoint: "src/mainview/index.ts",
  plugins: [createMainviewAliasPlugin(mainviewRoot), tailwind],
  jsx: { runtime: "automatic" },
},
```

`src/mainview/index.ts`が`import "./index.css"`することで、entrypointと同じベース名（`index.css`）のCSSバンドルが自動出力される。これにより既存の`index.html`の`<link href="index.css">`をそのまま使える。

既存の444行の手書きCSSには独自の`* { box-sizing: border-box }`リセットがあり、Tailwindのpreflight（グローバルリセット、button/inputの見た目除去等）をそのまま読み込むと既存の見た目が意図せず変わる。そのため`index.css`では`tailwindcss/theme.css`と`tailwindcss/utilities.css`のみをimportし、`tailwindcss/preflight.css`は意図的に除外している。

### 3. Electrobunのコンパイル済みCLIバイナリによる制約とその回避

実装時に、tsconfig.jsonの`paths`エイリアス（`@/*`、shadcnが生成するコード全体が依存する規約）が、Windows実機での`electrobun dev`実行時にのみ解決できないという問題が発覚した。`bun run <script>.ts`で同等のBun.build()呼び出しを手動で再現すると常に成功するのに、実際の`electrobun dev`コマンド経由では毎回同じ箇所（`@/components/ui/button`のimport）で解決に失敗する、という形で切り分けた。

原因は、Electrobunの`electrobun`コマンドが`bin/electrobun.cjs`から**コンパイル済みスタンドアロンバイナリ**（`node_modules/electrobun/dist-win-x64/bun.exe`等、`bun build --compile`相当の成果物）を子プロセスとして起動する構成になっており、この成果物内部から呼ばれる`Bun.build()`はtsconfig由来のpathsエイリアス解決を行わない、という制約があるためと考えられる（`electrobun.config.ts`にtsconfigパスを明示的に渡しても解消しなかった一方、同じ設定を通常の`bun run`で実行すると常に解決できたことから、コンパイル済みバイナリという実行形態そのものに起因すると判断した）。

この制約を回避するため、自前のBunプラグイン（`bun-mainview-alias-plugin.ts`の`createMainviewAliasPlugin`）を用意し、`onResolve`フックで`@/`から始まるimportを`src/mainview/`配下の実ファイルへ手動で解決している。tsconfig.json自体の`paths`設定はエディタの補完・型チェック用に残しつつ、実際のビルド時解決はこのプラグインが担う。

```ts
// bun-mainview-alias-plugin.ts
export function createMainviewAliasPlugin(mainviewRoot: string): BunPlugin {
  return {
    name: "mainview-alias",
    setup(build) {
      build.onResolve({ filter: /^@\// }, (args) => {
        // args.path (例: "@/components/ui/button") を mainviewRoot 配下の実ファイルへ解決する
      });
    },
  };
}
```

### 4. shadcn/uiの導入方法

shadcnの対話式`bunx shadcn@latest init`はTTYでの応答を前提としており、Electrobunは未知のフレームワークとして自動検出されないため実行しなかった。代わりにBun公式の`bun init react-shadcn`テンプレートが持つ`components.json`を土台に、niwaterm用（`@/*` → `src/mainview/*`）に書き換えて手動で作成した。以降のコンポーネント追加は`bunx shadcn@latest add <component>`で行う。

## Consequences

### Positive

- Dialog・DropdownMenu・Command paletteなどのRadix UIベースの挙動（フォーカストラップ・キーボードナビゲーション・ARIA）を自前実装せずに使える
- shadcnのAI関連コンポーネント群との親和性が高く、ロードマップ上のエージェント状態表示・サイドバー拡張を実装する際の土台になる
- preflightを意図的に除外したことで、既存の444行の手書きCSS・タブバーやサイドバーの見た目に影響を与えずに導入できた（Windows実機での目視確認で既存UIの見た目が変化していないことを確認済み）

### Negative

- niwatermに初めてUIフレームワーク（React）を導入することになり、素のDOM操作のみだった`src/mainview`の複雑性が増す
  → 適用範囲を新規UIに限定し、既存の描画性能クリティカルな部分（ターミナルグリッド、タイル分割）はReact化しないことで影響範囲を限定する
- `bun-plugin-tailwind`の利用や、Electrobunのコンパイル済みバイナリに起因するtsconfig pathsの制約への自前プラグインでの回避など、Electrobun本体が正式サポートしていない組み合わせに依存している
  → 制約の内容と回避策を本ADRおよびコード内コメントに明記し、Electrobunのアップデートで解消された場合は自前プラグイン（`bun-mainview-alias-plugin.ts`）を削除できるようにしておく
- `.oxlintrc.json`にreactプラグインを追加していないため、JSX構文のパース自体はoxcが対応するものの、react-hooks系のルール（依存配列の誤り等）は静的解析でチェックされない
  → 現時点ではReact化の範囲が小さいため許容し、React化が進んだ段階で追加を検討する

### Risks

- コンパイル済みCLIバイナリに起因するtsconfig paths解決の制約は、Electrobunのマイナーアップデートで動作が変わる可能性がある（改善されるか、逆に自前プラグインとの組み合わせで別の問題が起きるか、現時点では不明）
  → Electrobunをアップデートした際は、`bunx shadcn@latest add`で新規コンポーネントを追加した直後に一度実機ビルドで`@/`エイリアスの解決を確認する

## 決めていないこと

| 項目 | 決めない理由 | いつ決めるか |
|------|------------|------------|
| 既存のサイドバー・タブバー（素のDOM操作実装）をReactへ移行する時期 | 現時点では新規UIの基盤導入が目的で、既存実装の書き換えは必要性が生じていない | サイドバー拡張（ブランチ・エージェント状態表示等）で既存のサイドバーDOM構造に大きく手を入れる必要が出たとき |
| テーマパレットの拡充方針（daisyUIのパレット値を後から個別に参照するか等） | ユーザー向けにテーマを複数提供する機能自体がまだ実装されていない | テーマ切り替え機能をロードマップで着手するとき |
| `.oxlintrc.json`へのreactプラグイン追加 | React化の範囲がまだ小さく、react-hooks系の静的解析が無いことによる実害が出ていない | React化されたコードが増え、hooksの依存配列ミス等が実際に問題になったとき |

## Notes

### 参考資料

- [Bun公式リポジトリ](https://github.com/oven-sh/bun)の`bun init`テンプレート（`react-tailwind`, `react-shadcn`）— `bun-plugin-tailwind`の実際の使用例、shadcnの`components.json`の実例をopensrc経由で参照した
- [tailwindcss本体のソース](https://github.com/tailwindlabs/tailwindcss)（`packages/tailwindcss/theme.css` / `preflight.css` / `utilities.css`）— preflightを分離してimportできることの裏付けをopensrc経由で確認した
- ユーザーとの比較検討の議論（daisyUI vs shadcn、Reactを前提とするかどうかで結論が変わった経緯）
