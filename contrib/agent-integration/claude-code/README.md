# Claude Code 統合

Claude Codeのhooks機構から、タブ内で動くセッションの状態（idle/working/blocked）をniwatermのサイドバーへ通知する。

## 導入

`hooks.json`の中身（`"hooks"`キー配下）を、自分の`~/.claude/settings.json`（全プロジェクト共通で使えるので推奨）または`.claude/settings.json`/`.claude/settings.local.json`（プロジェクト単位）へマージする。

各hookコマンドは`$NIWATERM_TAB_ID`が未設定の環境（niwaterm外のターミナル）では何もしないため、グローバル（`~/.claude/settings.json`）に追加しても他のプロジェクト・他のターミナルアプリで悪さをしない（詳細は[../README.md](../README.md)のガードパターン参照）。

既に`hooks`キーに他の設定がある場合は、**イベント名ごとに配列として追記する**（既存のイベントに追加する場合は配列の要素として追加、無いイベントは新規キーとして追加）。既存設定を上書きしないよう注意する。

```sh
# 例: jqでマージする場合（既存のhooks設定と衝突しないよう、事前にバックアップを取ることを推奨）
cp ~/.claude/settings.json ~/.claude/settings.json.bak
jq -s '.[0] * {hooks: (.[0].hooks * .[1].hooks)}' ~/.claude/settings.json hooks.json > /tmp/merged-settings.json
mv /tmp/merged-settings.json ~/.claude/settings.json
```

## 状態の対応

| Claude Codeのhookイベント | niwatermのagent_status | agent_status_text |
|---|---|---|
| `SessionStart` | `idle`（同時に`agent=claude-code`を設定） | - |
| `UserPromptSubmit` | `working` | - |
| `PreToolUse` | `working` | `tool_name`/`tool_input`から組み立てた実行内容の要約（例: `Edit: sidebar-workspace-list.tsx`） |
| `Stop` | `idle` | `last_assistant_message`の抜粋（60文字まで、改行はスペースに置換） |
| `Notification`（`matcher: "permission_prompt"`） | `blocked` | `notification_data`から組み立てた確認内容の要約（例: `Bash: rm -rf /tmp/build の実行に許可が必要です`） |
| `SessionEnd` | `agent`/`agent_status`/`agent_status_text`をクリア（空文字列） | - |

`agent_status_text`の生成には`jq`を使う。`jq`が入っていない環境では自動的にスキップされ（`agent_status`のみ更新される）、hook自体は失敗しない。

`PermissionRequest`イベントは意図的に使っていない。Claude Codeのネイティブ権限確認フックとして同期的にブロックする性質があり、
「hookはniwatermへの通知のみを行い、常に`exit 0`でエージェント本体の動作を一切妨げない」という設計方針と相性が悪いため、
非同期の`Notification`イベントのみで代替している。

### agent_status_textの抽出元フィールド

Claude Code公式ドキュメント（[Hooks Reference](https://code.claude.com/docs/en/hooks.md)）で確認した実際のペイロード形状に基づく。
`docs/planning/roadmap.md`の初期案では`Notification`に`message`フィールドを使う想定だったが、実際のペイロードにこのフィールドは無く、
代わりに`notification_data.tool_name`/`notification_data.tool_input`（`permission_prompt`時）を使う形に変更した。

| hookイベント | 使うフィールド |
|---|---|
| `PreToolUse` | `tool_name`、`tool_input.file_path` \| `.command` \| `.pattern` \| `.url` \| `.description`（優先順） |
| `Notification` | `notification_data.tool_name`、`notification_data.tool_input`（同上の優先順） |
| `Stop` | `last_assistant_message`（**Claude Code v2.1.196以降が必要**。それ未満のバージョンではフィールドが無く、`agent_status`のみ`idle`に更新されて`agent_status_text`は前回の値のまま残る） |

## 未検証事項

この機能は開発時にmacOS/Windows実機でのGUI確認ができない環境（Linux/WSL）で実装されたため、以下は導入後に実地で確認すること。

- `$NIWATERM_TAB_ID`がClaude Codeのhookサブプロセスまで環境変数として継承されるか（PTY→シェル→`claude`→hookサブプロセスという経路で、通常のUnixプロセス環境変数継承であれば伝播するはずだが未確認）
- `niwaterm set-var agent ""`のように値に空文字列を渡した場合、CLI（gunshi製）がpositional引数として正しく空文字列を受け取れるか
- `agent_status_text`はbashのパラメータ展開（`${status_text:0:60}`）で60文字に切り詰めている。マルチバイト文字（日本語等）を文字数単位で正しく切り詰められるかはbashのロケール設定に依存するため、実地でのロケール依存挙動は未確認
