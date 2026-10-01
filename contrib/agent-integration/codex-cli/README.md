# Codex CLI 統合

Codex CLIのhooksから、状態と要約をniwatermのサイドバーへ通知する。

## 導入

```sh
niwa agent setup codex-cli
```

`$CODEX_HOME/hooks.json`（未設定なら`~/.codex/hooks.json`）へ、既存の他ツールのhooksを残して追加する。
Codexの`/hooks`で追加・更新された設定を確認して信頼し、Codexを再起動する。
hooksを無効にしている場合は、`config.toml`の既存の`[features]`で`hooks = true`にする。
設定はCodex CLI 0.153.0と[公式Hooks仕様](https://learn.chatgpt.com/docs/hooks)を基準にしている。

wipでは`niwa-dev agent setup codex-cli`を使う。
プロジェクト単位なら`--config .codex/hooks.json`を付け、そのプロジェクトもCodexで信頼する。
Codexは複数の設定元のhooksを読み込むため、グローバルとプロジェクトに重複して導入しない。
既に`config.toml`の`[hooks]`にniwaterm用の設定があれば、そちらは手動で削除する。

バックアップ・CLIの選択・対応シェルは[共通README](../README.md)を参照。

## 状態の対応

| hookイベント | `agent_status` | 要約 |
| --- | --- | --- |
| `SessionStart`（`startup` / `resume` / `clear`） | `idle` | クリア |
| `UserPromptSubmit` | `working` | クリア |
| `PreToolUse` / `PostToolUse` | `working` | ツール名と引数 |
| `PermissionRequest` | `blocked` | 承認理由、またはツール名 |
| `Stop` | `idle` | 最後の応答の抜粋 |
| `Interrupt` | `idle` | クリア |
| `SessionEnd` | 空文字列 | 種別・状態・要約をクリア |

コンテキスト圧縮時の`SessionStart`は無視し、作業中の表示を維持する。
`PermissionRequest`では通知のみ行い、承認・拒否の判断を返さない。
非同期hookの完了順で状態が戻らないよう、各hookは同期実行する。

`blocked`は承認要求を表し、`request_user_input`の質問待ちは`working`のまま。
承認後は次のツール実行・完了・中断で状態が変わるため、承認した瞬間には戻らない場合がある。
並行ツールの状態は最後の書き込みが優先され、承認待ちの件数は集計しない。
強制終了では終了hookが走らず表示が残る場合がある。

表示されなければ、`/hooks`の信頼状態、`NIWATERM_TAB_ID`、CLIのPATHを確認する。
実際のCodexセッションからGUIへの反映は未検証。
