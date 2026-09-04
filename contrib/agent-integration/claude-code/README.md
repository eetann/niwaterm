# Claude Code 統合

Claude Codeのhooks機構から、タブ内で動くセッションの状態（idle/working/blocked）をniwatermのサイドバーへ通知する。

## 導入

`hooks.json`の中身（`"hooks"`キー配下）を、自分の`~/.claude/settings.json`（全プロジェクト共通で使えるので推奨）または`.claude/settings.json`/`.claude/settings.local.json`（プロジェクト単位）へマージする。

各hookコマンドは`$NIWATERM_TAB_ID`が未設定の環境（niwaterm外のターミナル）では何もしないため、グローバル（`~/.claude/settings.json`）に追加しても他のプロジェクト・他のターミナルアプリで悪さをしない（詳細は[../README.md](../README.md)のガードパターン参照）。

既に`hooks`キーに他の設定がある場合は、**イベント名ごとに配列として追記する**（既存のイベントに追加する場合は配列の要素として追加、無いイベントは新規キーとして追加）。既存設定を上書きしないよう注意する。

```sh
# 既存のhooks設定を壊さずにマージする。niwaterm由来のエントリ（コマンドに$NIWATERM_TAB_IDを含むもの）
# だけを入れ替え、同じイベントに刺さっている他ツールのhookはそのまま残す。
# jqの `*` で丸ごとマージするとイベント単位で配列ごと置き換わり、他ツールのhookが消えるので使わない
cp ~/.claude/settings.json ~/.claude/settings.json.bak
jq -s '
  def isNiwa: (.hooks // []) | any((.command // "") | test("NIWATERM_TAB_ID"));
  .[0] as $cur | .[1] as $new
  | $cur
  | .hooks = (
      reduce ($new.hooks | to_entries[]) as $e (
        ($cur.hooks // {});
        .[$e.key] = (((.[$e.key] // []) | map(select(isNiwa | not))) + $e.value)
      )
    )
' ~/.claude/settings.json hooks.json > /tmp/merged-settings.json
mv /tmp/merged-settings.json ~/.claude/settings.json
```

## 状態の対応

| Claude Codeのhookイベント                        | niwatermのagent_status                                         | agent_status_text                                                                              |
| ------------------------------------------------ | -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `SessionStart`                                   | `idle`（同時に`agent=claude-code`を設定）                      | クリア                                                                                         |
| `UserPromptSubmit`                               | `working`                                                      | クリア                                                                                         |
| `PreToolUse`                                     | `working`                                                      | `tool_name`/`tool_input`から組み立てた実行内容の要約（例: `Edit: sidebar-workspace-list.tsx`） |
| `PostToolUse` / `PostToolUseFailure`             | `working`                                                      | 同上                                                                                           |
| `Stop`                                           | `idle`                                                         | `last_assistant_message`の抜粋                                                                 |
| `Notification`（`matcher: "permission_prompt"`） | `blocked`                                                      | `message`（例: `Claude needs your permission to use Bash`）                                   |
| `SessionEnd`                                     | `agent`/`agent_status`/`agent_status_text`をクリア（空文字列） | クリア                                                                                         |

`blocked`を解除するのは`PostToolUse`/`PostToolUseFailure`の役目。権限確認・`AskUserQuestion`に
回答した瞬間に発火するhookはこの2つしかなく、これが無いと「回答したのにサイドバーが応答待ちのまま」に
なる（`PreToolUse`は確認ダイアログの**前**、`Stop`はターン終了時なので、回答後にエージェントが
長考している間の穴を埋められない）。承認・拒否・中断のどれでもどちらかは必ず発火する。

`agent_status_text`はどのイベントでも必ず書き込む（抽出できなければ空文字列で上書きする）。
前のイベントで入れた文言が残ると、状態と食い違うテキストがサイドバーに出続けるため。

`agent_status_text`の生成には`jq`を使う。`jq`が入っていない環境では空文字列になり（`agent_status`は
更新される）、hook自体は失敗しない。改行のスペース置換と60文字への切り詰めも`jq`側で行う
（hookは`$SHELL`未設定だと`/bin/sh`で実行されるため、bash専用のパラメータ展開は使えない。
`jq`の文字列スライスはコードポイント単位なので日本語も途中で壊れない）。

`PermissionRequest`イベントは意図的に使っていない。Claude Codeのネイティブ権限確認フックとして同期的にブロックする性質があり、
「hookはniwatermへの通知のみを行い、常に`exit 0`でエージェント本体の動作を一切妨げない」という設計方針と相性が悪いため、
非同期の`Notification`イベントのみで代替している。

### agent_status_textの抽出元フィールド

Claude Code公式ドキュメント（[Hooks Reference](https://code.claude.com/docs/en/hooks.md)）で確認した実際のペイロード形状に基づく。

| hookイベント                              | 使うフィールド                                                                                       |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `PreToolUse`/`PostToolUse`/`…Failure` | `tool_name`、`tool_input.file_path` \| `.command` \| `.pattern` \| `.url` \| `.description`（優先順） |
| `Notification`                            | `message`（`title`/`notification_type`と並ぶ3フィールドのみ。ツール名や引数は載らない）             |
| `Stop`                                    | `last_assistant_message`（**Claude Code v2.1.196以降が必要**。それ未満では常に空扱いになる）           |

## 未検証事項

この機能は開発時にmacOS/Windows実機でのGUI確認ができない環境（Linux/WSL）で実装されたため、以下は導入後に実地で確認すること。

- `$NIWATERM_TAB_ID`がClaude Codeのhookサブプロセスまで環境変数として継承されるか（PTY→シェル→`claude`→hookサブプロセスという経路で、通常のUnixプロセス環境変数継承であれば伝播するはずだが未確認）
- `niwaterm tab var set agent ""`のように値に空文字列を渡した場合、CLI（gunshi製）がpositional引数として正しく空文字列を受け取れるか
