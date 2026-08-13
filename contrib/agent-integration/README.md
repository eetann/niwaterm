# niwaterm エージェント統合

タイル内で動くAIエージェント（Claude Code等）の種別・状態をniwatermのサイドバーへ通知するための設定集。
`contrib/shell-integration/`（gitブランチをタイル変数へ送るシェル統合）と対になる仕組みで、
「エージェント自身のhooks機構から能動的に`niwaterm set-var`を呼ぶ」プッシュ型を採用している
（herdr方式のようなプロセス走査・画面内容照合は行わない）。

## 予約キー

タイル変数（`niwaterm set-var`、詳細は`niwaterm docs show cli`）のうち、以下の2キーをエージェント状態通知用に予約する。

| キー | 値 | 説明 |
|---|---|---|
| `agent` | 任意の種別文字列（例: `claude-code`） | エージェントの種類。未設定または空文字列は「エージェントなし」として扱う |
| `agent_status` | `idle` \| `working` \| `blocked` | エージェントの状態。`agent`が空の場合は無視される。未設定・未知の値は`idle`へフォールバックする |

サイドバー側の解釈は`src/mainview/react/sidebar-props.ts`の`buildSidebarWorkspaceItems`に実装されている。

## hookコマンドのガードパターン

エージェントのhooks設定は多くの場合グローバル（`~/.claude/settings.json`等、プロジェクト非依存）にインストールする。
niwaterm外のプロジェクト・ターミナルで誤発火してエラーにならないよう、**hookのコマンド文字列自体に毎回ガードを入れる**。

```sh
if [ -n "$NIWATERM_TILE_ID" ] && command -v niwaterm >/dev/null 2>&1; then
  niwaterm set-var agent_status working >/dev/null 2>&1
fi
exit 0
```

- `$NIWATERM_TILE_ID`はniwaterm内で起動したシェル（PTY）にのみ自動設定される環境変数。niwaterm外では未設定なのでガードが効く
- `command -v niwaterm`で`niwaterm` CLIが未セットアップの環境でも安全にno-opにする
- 常に`exit 0`で終える。エージェント本体の動作（ツール実行のブロック等）に一切影響を与えないことを設計上の必須条件とする

## 他エージェントの追加

新しいエージェント（例: Codex CLI）を対応させる場合:

1. `contrib/agent-integration/<agent-name>/`ディレクトリを作り、そのエージェントのhooks機構に応じた設定ファイル・READMEを置く
2. `agent`キーへセットする種別文字列（kebab-case、例: `codex-cli`）を決める
3. 状態遷移は`idle`/`working`/`blocked`の3値へ正規化してマッピングする（エージェント固有の状態が3値に収まらない場合は最も近いものへ丸める）
4. 上記のガードパターンを踏襲する

## 現在対応しているエージェント

- [Claude Code](./claude-code/)
