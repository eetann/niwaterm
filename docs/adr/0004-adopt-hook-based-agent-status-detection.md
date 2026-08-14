---
type: ADR
title: "ADR 0004: AIエージェントの種別・状態検知にhooks能動通知型を採用する"
description: サイドバーに表示するAIエージェント（Claude Code等）の種別・状態（idle/working/blocked）の検知方式として、herdr方式のプロセス走査ではなく、エージェントのhooks機構からの能動通知を採用する意思決定
---

# ADR 0004: AIエージェントの種別・状態検知にhooks能動通知型を採用する

## Status

Accepted

## Context

niwatermはサイドバーにワークスペース・タイル・タブの一覧を表示しており、タブごとのkey-value変数（`niwaterm set-var`、tmuxのペイン変数相当）を持つ。gitブランチ名は既に「シェル統合プッシュ型」（zsh/bash/fish/PowerShell向けスクリプトがprecmdフックで`niwaterm set-var branch`を呼ぶ、`contrib/shell-integration/`）で検知・表示されている。

残る課題は、タブ内で動くAIエージェント（Claude Code等）の種別・状態（idle/working/blocked等）をどう検知するかである。cmux（manaflow-ai/cmux）・herdr（ogulcancelik/herdr）という2つの先行AI連携ターミナルをopensrcでソースコードを取得して調査し、検知方式を決定した。

### 解決したい課題

- タイル内のAIエージェントセッションが「アイドル中（入力待ち）」「作業中」「承認待ちでブロック中」のどれかを、サイドバーから一目で判別したい
- 既に採用済みのブランチ検知（シェル統合プッシュ型）と設計思想を揃え、実装・保守コストを抑えたい
- 複数のAIエージェント（Claude Code、将来的にCodex CLI等）に対応できる拡張性を持たせたい

### 検討した選択肢

1. **herdr方式**: OS別にフォアグラウンドプロセスグループを走査し（Linuxは`/proc`、Windowsはプロセススナップショット＋親子関係）、プロセス名を既知エージェント一覧と照合。状態は画面末尾テキスト＋OSCタイトルをエージェントごとのTOMLルール（`contains`/`regex`等の論理式）と照合して判定する
2. **cmux風の動的コマンドラッパー注入方式**: cmuxがClaude Code専用に使っている方式。`claude`コマンド自体をタイルごとの一時PATHでシムし、起動のたびに`--settings <JSON>`フラグでhooks設定をその場で動的に注入する（`~/.claude/settings.json`は読み書きしない、ユーザー操作不要）
3. **静的なhooks設定JSON配布＋手動マージ方式（採用）**: cmuxがClaude Code以外の16エージェント（Codex/Gemini/Cursor等）向けに使っている方式。`~/.codex/hooks.json`のようなグローバル設定ファイルへ、ユーザーが`cmux hooks setup <agent>`相当のコマンドで書き込む。niwatermでは静的なJSON片（`contrib/agent-integration/claude-code/hooks.json`）を配布し、ユーザーが`~/.claude/settings.json`へ手動マージする形にする

### 各選択肢の評価

| 観点 | 1. herdr方式 | 2. cmux動的注入方式 | 3. 静的JSON配布方式（採用） |
|------|---|---|---|
| ゼロコンフィグ性 | 高い（設定不要） | 高い（設定不要） | 低い（ユーザーが手動マージ） |
| 実装コスト | 高い（OS別プロセス走査＋状態判定ルールの新規実装） | 高い（シム生成・PATH差し込み・二重起動ガード等） | 低い（既存のtabVars/set-var基盤にそのまま乗る） |
| 既存のブランチ検知方式との一貫性 | 低い（パッシブ型で設計思想が異なる） | 中（プッシュ型だが独自機構） | 高い（同じプッシュ型・同じtabVars経路） |
| 複数エージェントへの拡張性 | ルールマニフェストを増やせば対応可 | エージェントごとに個別のシム実装が要る | キー規約とディレクトリ規約を揃えるだけで対応可 |
| 誤検知・精度 | プロセス名・画面テキストの正規表現照合に依存し曖昧 | 明確（hooksイベントに基づく） | 明確（hooksイベントに基づく） |

## Decision

**AIエージェントの種別・状態検知は、herdr方式（プロセス走査）ではなく、エージェント自身のhooks機構からniwatermへ能動的に通知する「hooks能動通知型」を採用する。配布形態は、cmuxの動的コマンドラッパー注入ではなく、静的なhooks設定JSON片をユーザーが手動マージする、よりシンプルな方式とする。**

### 1. 複数エージェント対応の規約

`contrib/shell-integration/`と対になる`contrib/agent-integration/<agent-name>/`というディレクトリ構成を定めた。他エージェント（例: 将来のCodex CLI）を追加する場合も、同じ規約（予約キー・ガードパターン）に乗せる。

## Consequences

### Positive

- 既存のブランチ検知（シェル統合プッシュ型）と全く同じ経路（`set-var` → `tabVars` → サイドバー）に乗るため、bun側・IPC・CLIのコード変更が一切不要だった
- hooksイベントに基づく明確な状態遷移のため、herdr方式のような画面テキストの正規表現照合による誤検知が起きにくい
- `contrib/agent-integration/<agent-name>/`という規約により、他エージェント対応時の実装パターンが明確

### Negative

- ゼロコンフィグではない。ユーザーが`~/.claude/settings.json`へ手動でJSONをマージする作業が必要
  - → `contrib/agent-integration/claude-code/README.md`に`jq`を使ったマージ手順を記載し、作業コストを下げた
- Claude Code以外のエージェント対応は、hooks.json相当の設定ファイルを追加実装しないと使えない（herdr方式ならゼロコンフィグで新規エージェントも検知できた可能性がある）
  - → 複数エージェント対応の需要が高まった場合、herdr方式をフォールバック検知として後から追加することも設計上排除していない（tabVarsの汎用性により両方式は共存できる）

### Risks

- `$NIWATERM_TAB_ID`がClaude Codeのhookサブプロセスまで環境変数として継承されない可能性がある（PTY→シェル→`claude`→hookサブプロセスという経路が未検証）
  - → `contrib/agent-integration/claude-code/README.md`に未検証事項として明記し、導入時の実地確認を促す
- `niwaterm set-var agent ""`のような空文字列のpositional引数が、gunshi製CLIパーサーで正しく渡るか未確認
  - → 同READMEに明記。誤動作した場合でも影響範囲は`SessionEnd`時のクリア処理のみ

## 決めていないこと

| 項目 | 決めない理由 | いつ決めるか |
|------|------------|------------|
| Claude Code以外のエージェント（Codex CLI等）向けのhooks.json実装 | 対応するエージェントの実際の需要が出てから、そのエージェント固有のhooks/設定機構を調査すべき | 対象エージェントの利用ニーズが生じたとき |
| herdr方式（プロセス走査）をフォールバックとして併用するか | hooks未設定のエージェント・エディタ拡張等をゼロコンフィグで検知したい場合に必要になるが、現時点でその需要は顕在化していない | 複数エージェント対応が進み、hooks非対応のツールを検知したいニーズが出たとき |

## Notes

### 参考資料

- docs/planning/roadmap.md「タブ状態の可視化（ブランチ・エージェント状態）」節
- docs/guide/cli.md「エージェント統合」節、「シェル統合」節
- contrib/agent-integration/README.md、contrib/agent-integration/claude-code/README.md
- [cmux](https://github.com/manaflow-ai/cmux) — opensrcで取得したソースコードを調査（`CLI/CMUXCLI+AgentHookCatalog.swift`、`CLI/CMUXCLI+AgentHookDefinitions.swift`、`Resources/bin/cmux-claude-wrapper`等）
- [herdr](https://github.com/ogulcancelik/herdr) — プロセス走査＋マニフェスト照合方式の先行調査（roadmap.md記載のサマリを参照）
- [Claude Code Hooks Reference](https://code.claude.com/docs/en/hooks.md)、[Hooks Guide](https://code.claude.com/docs/en/hooks-guide.md)
- ADR 0001（Window > Workspace > Tile > Tab の4階層） — タブ単位でのタブ変数管理の前提となる階層構造（Tab = PTYを保持する末端という定義に整合）
