---
type: ADR
title: "ADR 0002: ドキュメントを Google の Open Knowledge Format (OKF) に従って書く"
description: docs/配下をOKFバンドルとして扱い、frontmatterのtype/title/description必須化とplanning/guide/build/adrのディレクトリ構成を定める
---

# ADR 0002: ドキュメントを Google の Open Knowledge Format (OKF) に従って書く

## Status

Accepted

## Context

niwaterm は Electrobun + libghostty-vt + 自前描画という構成のデスクトップアプリで、開発は Claude Code などの AI エージェントと人間が協働して進めている（CLAUDE.md 冒頭の「進行計画」「意思決定記録」の参照体系もその前提で組まれている）。現在 `docs/` 配下には mvp.md（コンセプト）、roadmap.md（進行計画）、cli.md / config.md（リファレンス）、macos-build.md / windows-build.md（手順書）、adr/（意思決定記録）と性質の異なる文書が並んでいるが、いずれも frontmatter を持たない素朴な Markdown であり、ファイルの種類・鮮度・関連文書はファイルを開いて中身を読むまで分からない。

AI エージェントがドキュメントを読み書きする機会が増えるほど、「このファイルは何の種類か」「他のどの文書と関連するか」を機械的に判別できることの価値が上がる。人間にとっても、種類ごとに一貫した最小限のメタデータがあれば探しやすくなる。

### 解決したい課題

- `docs/` 配下のファイルが、開かずに種類（コンセプト／計画／リファレンス／手順書／意思決定記録）を判別できない
- ドキュメント間の関連（例: 手順書が参照する ADR、リファレンスが参照するコンセプト）が本文中の自然言語リンクに埋もれている
- 「ドキュメントはこう書く」という規約がプロジェクト内に存在せず、書き手・AI エージェントごとに書式がぶれる余地がある

### 検討した選択肢

- 選択肢A: 現状維持（frontmatter なしの素朴な Markdown を今後も踏襲）
- 選択肢B: niwaterm 独自のドキュメント規約を一から策定する
- 選択肢C: Google Cloud の Open Knowledge Format (OKF) v0.2 を採用する（[SPEC.md](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/main/okf/SPEC.md)、2026-06 公開）

### 各選択肢の評価

| 観点 | A: 現状維持 | B: 独自規約 | C: OKF 採用 |
|------|------------|------------|------------|
| 導入コスト | なし | 設計コストが全て自前 | 仕様が既にあり設計コストが小さい |
| AI エージェントとの親和性 | 低（type 判別に本文を読む必要） | 設計次第 | 高（type frontmatter を機械的に判別可能） |
| 中央ツール・専用パーサー依存 | なし | 設計次第 | なし（gitワークフローのみで完結、cat/git clone で読める） |
| 将来の外部連携（OKF 対応ツールが増えた場合） | 不可 | 不可 | 可能 |
| 学習コスト | なし | プロジェクト固有で都度説明が要る | 仕様書1つを参照すれば済む |
| niwaterm のコンセプト（AI エージェント常駐ワークフロー、docs/planning/mvp.md）との整合 | 低 | 中立 | 高（AI エージェントが読むナレッジベース向けに設計された仕様） |

OKF は「type フィールドのみ必須、中央レジストリなし、通常の git ワークフローで完結」という意図的に最小限の規約であり、独自規約をゼロから設計するより導入コストが小さい。niwaterm 自体が AI エージェント常駐ワークフローをコンセプトとするプロジェクトであり、AI エージェントが読み書きしやすいナレッジベース形式との親和性が高い。

## Decision

**`docs/` 配下（`docs/adr/` を含む）を1つの OKF バンドルとして扱い、以下のルールで Markdown ドキュメントを書く。**

### 1. バンドルルートと対象ファイル

`docs/` をバンドルルートとする。`docs/` 配下の予約ファイル名（`index.md` / `log.md`）以外の全ての `.md` ファイルが OKF でいう「概念ドキュメント」であり、パース可能な YAML frontmatter を持つ。

### 2. frontmatter の必須・推奨フィールド

OKF 準拠の必須フィールドは `type` のみだが、niwaterm では検索性を確保するため以下を必須とする。

```yaml
---
type: Reference
title: CLI コマンドリファレンス
description: niwaterm CLI（niwatermコマンド）のサブコマンド一覧と使い方
---
```

- `type`（必須）: 下記「3. niwaterm の type 語彙」から選ぶ
- `title`（必須）: 人間が読める表示名
- `description`（必須）: 1文の要約
- `tags`（任意）: 横断的な分類が必要な場合のみ

`sources` / `generated` / `verified` / `status` / `stale_after` といった OKF の provenance・trust・lifecycle 系フィールドは今回は必須にしない（「決めていないこと」参照）。

### 3. niwaterm の type 語彙

中央レジストリを持たない OKF の思想に従い、type は niwaterm プロジェクト内で自由に定義・拡張してよい。現時点の語彙は以下の5つ。

| type | 用途 | 該当ファイル |
|------|------|--------------|
| `Concept` | プロダクトのコンセプト・思想 | planning/mvp.md |
| `Plan` | 進行計画 | planning/roadmap.md |
| `ADR` | 意思決定記録 | adr/*.md |
| `Reference` | コマンド・設定項目のリファレンス | guide/cli.md, guide/config.md |
| `Runbook` | 手順書 | build/macos-build.md, build/windows-build.md |

未知の type 値が出てきても、OKF の consumer 要件（未知の type を拒否してはならない）に従い、読み手はエラーとして扱わない。新しい種類の文書が必要になったら、この表に語彙を追記する。

### 4. ADR への適用

ADR 本文の構成（`## Status` / `## Context` / `## Decision` / `## Consequences` など、adr-creator スキルが定めるテンプレート）はそのまま維持し、frontmatter を追加するだけとする。

```yaml
---
type: ADR
title: "ADR 0002: ドキュメントを Google の Open Knowledge Format (OKF) に従って書く"
description: docs/配下をOKFバンドルとして扱い、frontmatterのtype/title/description必須化とplanning/guide/build/adrのディレクトリ構成を定める
---
```

OKF の lifecycle 用 `status`（draft/stable/deprecated、文書の鮮度を表す）と ADR 本文の `## Status`（Proposed/Accepted/Deprecated/Superseded、意思決定のライフサイクルを表す）は意味が異なるため混同しない。ADR では frontmatter に `status` を置かず、意思決定のステータスは従来どおり本文 `## Status` セクションで管理する。

### 5. クロスリンク記法

OKF が定めるバンドル相対パス（`docs/` ルートからのスラッシュ始まり）を第一選択とする。

```markdown
[ADR 0001](/adr/0001-adopt-window-workspace-tile-tab-hierarchy.md)
[CLI リファレンス](/guide/cli.md)
```

同一ディレクトリ内など近接する文書間では通常の相対パス（`./other.md`）も可とする。

### 6. 適合性チェックの目安

OKF の conformance 基準に倣い、`docs/` 配下の各 `.md`（`index.md` / `log.md` を除く）は次を満たす。

1. パース可能な YAML frontmatter を持つ
2. `type` / `title` / `description` が空でない
3. `type` は「3. niwaterm の type 語彙」の値、または新規追加として本 ADR の表を更新したもの

### 7. ディレクトリ構成

`docs/` 直下に種類の異なる文書が並んでいると、開発者向け（ビルド手順）とユーザー向け（CLI・設定の使い方）の区別がつきにくい。type 語彙とは別に、ディレクトリでも読み手（誰が読むか）の軸で整理する。

```
docs/
  planning/   # Concept・Plan。プロダクト企画。MVP達成後はいずれ縮小・アーカイブする性質のもの
    mvp.md
    roadmap.md
  guide/      # Reference。niwaterm を使うユーザー向け（CLI操作・設定ファイルの書き方）
    cli.md
    config.md
  build/      # Runbook。niwaterm を開発・ビルドする開発者向け（macOS/Windows手順）
    macos-build.md
    windows-build.md
  adr/        # ADR。意思決定記録
    0001-....md
    0002-....md
```

- `planning/`: mvp.md（コンセプト）と roadmap.md（進行計画）をまとめる。両者は「プロダクトが目指す姿と現在地」を示すものであり、MVP 達成という区切りを迎えたら役目を終えて縮小・アーカイブされる性質を持つ点で、他の3分類（ユーザーが使い続ける限り必要な guide/、開発を続ける限り必要な build/、恒久的な記録である adr/）と異なる
- `guide/` と `build/` の境界は「読者が niwaterm を使う人か、ビルドする人か」。CLI・設定ファイルは前者、ネイティブライブラリのビルド手順は後者
- type 語彙とディレクトリは概ね1対1で対応する（`Concept`/`Plan` → `planning/`、`Reference` → `guide/`、`Runbook` → `build/`、`ADR` → `adr/`）が、規約として強制はしない。将来 type が増えた際に必ずしも新しいディレクトリを切る必要はない

## Consequences

### Positive

- AI エージェントが `docs/` 配下のファイルを開かずに frontmatter の `type` だけで種類を判別できる
- 公開仕様（OKF）に準拠するため、将来 OKF 対応の外部ツール（インデクサ等）が出てきた場合に連携しやすい
- 中央ツール・専用パーサー不要で、通常の git ワークフロー（`cat` / `git clone`）だけで完結する

### Negative

- frontmatter という記述コストが増え、素朴な Markdown に比べて書き始めるハードルがわずかに上がる
  → 必須フィールドを type / title / description の3つに絞り、負担を最小化する
- ADR frontmatter の `title` と本文見出し（`# ADR NNNN: ...`）が二重管理になり、改題時にズレる可能性がある
  → 両方を更新することを adr-creator スキル・doc-writer スキル（新規作成予定）のチェック項目に含める

### Risks

- OKF は 2026年6月公開の新しい仕様（v0.1 → v0.2）であり、将来仕様が変わる可能性がある
  → niwaterm 独自の type 語彙・運用ルールは本 ADR に明記し、OKF 本体の仕様変更に追従するかは都度判断する
- type 語彙が個人の裁量で増え続け、収拾がつかなくなる可能性がある
  → 新しい type を追加する際は本 ADR の「3. niwaterm の type 語彙」表を更新する

## 決めていないこと

| 項目 | 決めない理由 | いつ決めるか |
|------|------------|------------|
| `index.md` / `log.md`（予約ファイル名）の導入 | `docs/` 配下はまだファイル数が少なく、一覧性の問題が顕在化していない | ファイル数が増え、CLAUDE.md からの手動列挙では追いづらくなったとき |
| `sources` / `generated` / `verified` 等の provenance・trust フィールドの利用 | AI エージェントによる自動生成・検証フローが未整備 | AI エージェントが docs を自動生成・検証する運用を始めるとき |

## Notes

### 参考資料

- [Open Knowledge Format (OKF) SPEC.md](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/main/okf/SPEC.md) — GoogleCloudPlatform/knowledge-catalog
- [How the Open Knowledge Format can improve data sharing | Google Cloud Blog](https://cloud.google.com/blog/products/data-analytics/how-the-open-knowledge-format-can-improve-data-sharing)
- ADR 0001（画面構成の用語定義。ADR 採択と同時に関連ドキュメントを更新した前例）
- docs/planning/mvp.md — niwaterm のコンセプト（AI エージェント常駐ワークフロー）
