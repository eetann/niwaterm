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

### 1. タブ変数の予約キー

既存の`niwaterm set-var`（タブ変数）の仕組みに、以下2キーを予約する。

| キー | 値 | 説明 |
|---|---|---|
| `agent` | 任意の種別文字列（例: `claude-code`） | エージェントの種類。空文字列・未設定は「エージェントなし」 |
| `agent_status` | `idle` \| `working` \| `blocked` | エージェントの状態。未設定・未知の値は`idle`へ正規化する |

bun側（`tabVars: Record<TabId, Record<string, string>>`。当初は`tileVars: Record<TileId, ...>`だったが、1タイルに複数タブがある場合に非アクティブタブの状態更新が他タブの表示を上書きする問題が実機検証で判明したため、付与単位をタイル単位からタブ単位へ移行した。詳細は本ADRのNotes「タブ単位への移行」参照）は元々汎用key-valueのため、この2キーを追加してもスキーマ変更は不要である。

### 2. Claude Codeのhooksイベントとの対応

```
SessionStart      → agent=claude-code, agent_status=idle
UserPromptSubmit  → agent_status=working
PreToolUse        → agent_status=working
Stop              → agent_status=idle
Notification（matcher: "permission_prompt"） → agent_status=blocked
SessionEnd        → agent / agent_status を空文字列にクリア
```

`PermissionRequest`イベント（Claude Codeのネイティブ権限確認と同期的にブロックする性質を持つ）は意図的に不採用とした。hookコマンドは「niwatermへの通知のみを行い、常に`exit 0`でエージェント本体の動作を一切妨げない」ことを設計上の必須条件としており、同期ブロッキング系のイベントとは相性が悪いためである。代わりに非同期の`Notification`イベントで代替する。

### 3. niwaterm外への誤発火防止（環境変数ガード）

全hookコマンドに、cmuxの`CMUX_SURFACE_ID`環境変数ガードを参考にしたガードを埋め込む。

```sh
if [ -n "$NIWATERM_TAB_ID" ] && command -v niwaterm >/dev/null 2>&1; then
  niwaterm set-var agent_status working >/dev/null 2>&1
fi
exit 0
```

`$NIWATERM_TAB_ID`はniwaterm内で起動したシェル（PTY）にのみ自動設定される環境変数であるため、このガードによりグローバル（`~/.claude/settings.json`）にhooks設定を追加しても、niwaterm外のプロジェクト・ターミナルでは常にno-opになる。これにより「ユーザーのグローバル設定を一度だけ変更すればよい」という運用が安全に成立する。

### 4. 複数エージェント対応の規約

`contrib/shell-integration/`と対になる`contrib/agent-integration/<agent-name>/`というディレクトリ構成を定めた。

```
contrib/agent-integration/
  README.md                  # 予約キー規約・ガードパターン・拡張手順
  claude-code/
    hooks.json                 # ~/.claude/settings.jsonへ手動マージするJSON片
    README.md                   # 導入手順・未検証事項
```

他エージェント（例: 将来のCodex CLI）を追加する場合も、同じ`agent`/`agent_status`キーと3値の状態語彙、同じガードパターンに乗せる。

### 5. 副次的なバグ修正

実装の過程で、`workspace.ts`の`setTabVar()`（当時は`setTileVar()`）が状態変更時に`opts.onDirty()`（サイドバーの再描画スケジューリング）を呼んでいないことが判明した。既存のブランチ表示は、シェルのprecmdフックによる`set-var`の直後にPTY出力（プロンプト再描画）が伴うため、そちらの`onDirty()`呼び出しに便乗して偶然反映されていた。hooksベースの状態更新（`Stop`イベント等）はPTY出力を伴わないことがあるため、この問題を修正し、`setTabVar()`自体が`onDirty()`を呼ぶようにした。

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

### タブ単位への移行

本ADR採択当初は「決めていないこと」としてタブ単位の状態管理を保留していた（1タイルに複数タブがある場合の状態上書き問題自体は当初から認識していたが、ブランチ検知でも既に残る既知の制約であり本ADRのスコープ外としていた）。その後、Windows実機での動作検証で実際に問題が顕在化した（Claude Code稼働中のタブとPowerShellのみのタブが同一タイルに同居すると、両方が同じ`agent_status`表示になる）ため、変数の付与単位をタイル単位（`tileVars`）からタブ単位（`tabVars`）へ全面的に移行した。ADR 0001の「Tab = PTYを保持する末端」という定義により忠実になる方向の変更であり、本ADRの根幹（hooks能動通知型・予約キー・ガードパターン）自体への影響はない。CLIの`--tile`オプションは`--tab`へ、PTY起動時の環境変数`NIWATERM_TILE_ID`は`NIWATERM_TAB_ID`へ、それぞれ後方互換なしで置き換えた。

### 参考資料

- docs/planning/roadmap.md「タブ状態の可視化（ブランチ・エージェント状態）」節
- docs/guide/cli.md「エージェント統合」節、「シェル統合」節
- contrib/agent-integration/README.md、contrib/agent-integration/claude-code/README.md
- [cmux](https://github.com/manaflow-ai/cmux) — opensrcで取得したソースコードを調査（`CLI/CMUXCLI+AgentHookCatalog.swift`、`CLI/CMUXCLI+AgentHookDefinitions.swift`、`Resources/bin/cmux-claude-wrapper`等）
- [herdr](https://github.com/ogulcancelik/herdr) — プロセス走査＋マニフェスト照合方式の先行調査（roadmap.md記載のサマリを参照）
- [Claude Code Hooks Reference](https://code.claude.com/docs/en/hooks.md)、[Hooks Guide](https://code.claude.com/docs/en/hooks-guide.md)
- ADR 0001（Window > Workspace > Tile > Tab の4階層） — タブ単位でのタブ変数管理の前提となる階層構造（Tab = PTYを保持する末端という定義に整合）
