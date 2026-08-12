---
name: doc-writer
description: |
  niwatermのdocs/配下（ADR含む）をGoogleのOpen Knowledge Format (OKF)に従って書く・チェックするスキル。frontmatter(type/title/description)の付与、niwaterm独自のtype語彙の割り当て、クロスリンクのバンドル相対パス化を行う。ルールの正本はADR 0002（docs/adr/0002-adopt-okf-for-documentation.md）。
  トリガー: "ドキュメントを書いて", "docsに追加して", "OKF形式で", "frontmatterを付けて", "ドキュメントのルール"
user-invocable: true
---

# doc-writer

niwatermの `docs/` 配下（`docs/adr/` 含む）は [ADR 0002](/docs/adr/0002-adopt-okf-for-documentation.md) により Google の Open Knowledge Format (OKF) バンドルとして扱う。新規ドキュメントの作成・既存ドキュメントの編集時は本スキルのチェックリストに従う。ルールの背景・根拠は ADR 0002 が正本であり、本スキルは実務用のチェックリスト。

## 新規ドキュメントを書くとき

1. 冒頭に YAML frontmatter を付与する。`type` / `title` / `description` の3つが必須（OKF 本来の必須は `type` のみだが、niwaterm では検索性のため3つとも必須にしている）。

   ```yaml
   ---
   type: Reference
   title: 人間が読める表示名
   description: 1文の要約
   ---
   ```

2. `type` は下表（ADR 0002 §3 と同じ）から選ぶ。当てはまるものがなければ新しい type 名を作ってよいが、その場合 ADR 0002 の表も更新する（中央レジストリを持たない OKF の思想どおり、type 語彙はプロジェクト内で自由に拡張できる）。

   | type | 用途 |
   |------|------|
   | `Concept` | プロダクトのコンセプト・思想 |
   | `Plan` | 進行計画 |
   | `ADR` | 意思決定記録 |
   | `Reference` | コマンド・設定項目のリファレンス |
   | `Runbook` | 手順書 |

3. ADR を新規作成する場合は adr-creator スキルで本文（Status/Context/Decision/Consequences...）を作り、frontmatter は本スキルのルールで追加する。`type: ADR`、`title` は本文見出し `# ADR NNNN: ...` と同じ文字列にする。

4. 他ドキュメントへのリンクはバンドル相対パス（`docs/` ルートからのスラッシュ始まり、例: `/adr/0001-xxx.md`）を第一選択にする。同一ディレクトリ内など近接するファイル同士は `./other.md` でもよい。

## 既存ドキュメントを編集するとき

- frontmatter がまだ無いファイルを編集する場合は、ついでに frontmatter を追加する。
- ADR の `title`（frontmatter）を変更したら、本文見出し `# ADR NNNN: ...` も同じ文字列に揃える（frontmatterと本文見出しの二重管理になっているため、片方だけ変えるとズレる）。
- ADR frontmatter に OKF の lifecycle 用 `status`（draft/stable/deprecated）は書かない。ADR 自体のステータス（Proposed/Accepted/Deprecated/Superseded）は従来どおり本文の `## Status` セクションで管理する。両者は意味が異なるので混同しないこと。

## 適合性チェック

`docs/` 配下で frontmatter が欠落しているファイルを簡易チェックする。

```sh
for f in $(find docs -name '*.md' ! -name 'index.md' ! -name 'log.md'); do
  head -1 "$f" | grep -q '^---$' || echo "frontmatterなし: $f"
done
```

## 参考

- [ADR 0002](/docs/adr/0002-adopt-okf-for-documentation.md) — 本ルールの意思決定記録（type語彙・必須フィールド・クロスリンク記法の正本）
- [OKF SPEC.md](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/main/okf/SPEC.md) — OKF仕様の正本（GoogleCloudPlatform/knowledge-catalog）
