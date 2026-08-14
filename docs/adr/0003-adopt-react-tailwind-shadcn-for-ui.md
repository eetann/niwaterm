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

既存の描画性能がクリティカルな部分（ターミナルグリッドの描画、タイル分割ロジック）はReact化のスコープに含めない。今回導入するのは、今後追加する新規UI（ダイアログ、サイドバー拡張等）から使える基盤である。

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
