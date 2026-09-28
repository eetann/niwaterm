# Claude Code 統合

Claude Codeのhooksから、状態と要約をniwatermのサイドバーへ通知する。

## 導入

```sh
niwaterm agent setup claude-code
```

`$CLAUDE_CONFIG_DIR/settings.json`（未設定なら`~/.claude/settings.json`）へ設定を追加し、Claude Codeを再起動する。
既存の他ツールのhooksは保持し、長いコマンドを埋め込んだ旧niwaterm設定も置き換える。
`jq`は不要。バックアップと共通の動作は[共通README](../README.md)を参照。

wipでは`niwaterm-dev agent setup claude-code`を使う。
プロジェクト単位なら`--config .claude/settings.local.json`を付ける。
グローバルとプロジェクトに重複して導入しない。

## 状態の対応

| hookイベント | `agent_status` | 要約 |
| --- | --- | --- |
| `SessionStart` | `idle` | クリア |
| `UserPromptSubmit` | `working` | クリア |
| `PreToolUse` / `PostToolUse` / `PostToolUseFailure` | `working` | ツール名と引数 |
| `Stop` | `idle` | 最後の応答の抜粋 |
| `Notification`（`permission_prompt`） | `blocked` | 確認メッセージ |
| `SessionEnd` | 空文字列 | 種別・状態・要約をクリア |

あわせて`SessionStart`と`UserPromptSubmit`で、hookの入力に入っている`transcript_path`を
タブ変数`agent_transcript`へ書き込む（`SessionEnd`でクリア）。
Claude Codeはalternate screenで動き会話がniwatermのスクロールバックへ残らないため、
このパスが過去のやりとりを辿る唯一の手がかりになる
（[docs/known-issues/claude-code-history-not-in-scrollback.md](../../../docs/known-issues/claude-code-history-not-in-scrollback.md)）。
読み出しは`niwaterm claude prompt list` / `show`、サイドバーへ目次付きで出す例は
[contrib/custom-views/claude-prompts/](../../custom-views/claude-prompts/)。

権限確認への回答後は`PostToolUse` / `PostToolUseFailure`で`working`へ戻す。
`PermissionRequest`は使わず、`Notification`から確認待ちを通知する。
各hookは同期実行し、内部コマンドは入力不正や接続失敗でも終了コード0を返す。

`Stop`の要約に使う`last_assistant_message`はClaude Code v2.1.196以降が必要。
未対応のバージョンでは要約を空にして状態だけ更新する。
入力フィールドの詳細は[公式Hooks Reference](https://code.claude.com/docs/en/hooks.md)を参照。

表示されなければ、`NIWATERM_TAB_ID`とCLIのPATH、設定先が正しいかを確認する。
強制終了では終了hookが走らず表示が残る場合がある。
実際のClaude CodeセッションからGUIへの反映は未検証。
