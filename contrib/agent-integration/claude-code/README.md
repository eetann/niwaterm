# Claude Code 統合

Claude Codeのhooks機構から、タイル内で動くセッションの状態（idle/working/blocked）をniwatermのサイドバーへ通知する。

## 導入

`hooks.json`の中身（`"hooks"`キー配下）を、自分の`~/.claude/settings.json`（全プロジェクト共通で使えるので推奨）または`.claude/settings.json`/`.claude/settings.local.json`（プロジェクト単位）へマージする。

各hookコマンドは`$NIWATERM_TILE_ID`が未設定の環境（niwaterm外のターミナル）では何もしないため、グローバル（`~/.claude/settings.json`）に追加しても他のプロジェクト・他のターミナルアプリで悪さをしない（詳細は[../README.md](../README.md)のガードパターン参照）。

既に`hooks`キーに他の設定がある場合は、**イベント名ごとに配列として追記する**（既存のイベントに追加する場合は配列の要素として追加、無いイベントは新規キーとして追加）。既存設定を上書きしないよう注意する。

```sh
# 例: jqでマージする場合（既存のhooks設定と衝突しないよう、事前にバックアップを取ることを推奨）
cp ~/.claude/settings.json ~/.claude/settings.json.bak
jq -s '.[0] * {hooks: (.[0].hooks * .[1].hooks)}' ~/.claude/settings.json hooks.json > /tmp/merged-settings.json
mv /tmp/merged-settings.json ~/.claude/settings.json
```

## 状態の対応

| Claude Codeのhookイベント | niwatermのagent_status |
|---|---|
| `SessionStart` | `idle`（同時に`agent=claude-code`を設定） |
| `UserPromptSubmit` | `working` |
| `PreToolUse` | `working` |
| `Stop` | `idle` |
| `Notification`（`matcher: "permission_prompt"`） | `blocked` |
| `SessionEnd` | `agent`/`agent_status`をクリア（空文字列） |

`PermissionRequest`イベントは意図的に使っていない。Claude Codeのネイティブ権限確認フックとして同期的にブロックする性質があり、
「hookはniwatermへの通知のみを行い、常に`exit 0`でエージェント本体の動作を一切妨げない」という設計方針と相性が悪いため、
非同期の`Notification`イベントのみで代替している。

## 未検証事項

この機能は開発時にmacOS/Windows実機でのGUI確認ができない環境（Linux/WSL）で実装されたため、以下は導入後に実地で確認すること。

- `$NIWATERM_TILE_ID`がClaude Codeのhookサブプロセスまで環境変数として継承されるか（PTY→シェル→`claude`→hookサブプロセスという経路で、通常のUnixプロセス環境変数継承であれば伝播するはずだが未確認）
- `niwaterm set-var agent ""`のように値に空文字列を渡した場合、CLI（gunshi製）がpositional引数として正しく空文字列を受け取れるか
