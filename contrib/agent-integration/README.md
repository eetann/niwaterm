# niwaterm エージェント統合

AIエージェントのhooksから、そのタブの状態をniwatermのサイドバーへ通知する。
導入はエージェントごとに1コマンドで行う。niwatermアプリを起動していなくても設定できる。

```sh
niwaterm agent setup codex-cli
niwaterm agent setup claude-code
```

既存の他ツールのhooksを保持し、niwatermの設定だけを追加・更新する。
変更前の設定は同じディレクトリの`*.niwaterm-<ID>.bak`へ保存する。
再実行しても重複しない。JSONが不正な場合は書き換えずにエラーを返す。
Codexは導入後に`/hooks`で設定を確認して信頼し、再起動する。

wipでは`niwaterm-dev agent setup codex-cli`のように`niwaterm-dev`を使う。
登録するCLI名は`NIWATERM_APP_VARIANT`が`niwaterm-wip`なら`niwaterm-dev`、それ以外なら`niwaterm`になる。
`--cli niwaterm-dev`でも明示できる。プロジェクト単位の設定先は`--config .codex/hooks.json`などで指定する。

## hookの実行

設定に入るコマンドは次の形になる。

```sh
niwaterm _hook codex-cli >/dev/null 2>&1 || true
```

`_hook`は通常のヘルプに表示しない内部コマンド。
エージェントが標準入力へ渡すJSONから状態と要約を作り、IPCでタブ変数へ反映する。`jq`は不要。
`NIWATERM_TAB_ID`がなければ入力を読まずに終了し、フォーカス中の別タブには書き込まない。
不正入力や接続失敗でも無出力・終了コード0とし、処理は2秒で打ち切る。
CLIが見つからない場合はコマンド末尾の`|| true`でエージェントへの影響を防ぐ。
配布設定のシェル構文はmacOS・Linux/WSL向けで、WindowsネイティブのPowerShellは対象外。

hook本体はCLIの更新で反映される。購読イベントやCLI名を更新する場合は`agent setup`を再実行する。
各エージェントの設定やマッピングは以下を参照する。

- [Codex CLI](./codex-cli/)
- [Claude Code](./claude-code/)

## 予約キー

| キー | 値 | 説明 |
| --- | --- | --- |
| `agent` | `codex-cli` / `claude-code`など | エージェントの種別。空文字列はエージェントなし |
| `agent_status` | `idle` / `working` / `blocked` | 状態。未設定・未知の値は`idle`扱い |
| `agent_status_text` | 任意の文字列 | 要約。各イベントで更新し、内容がなければクリアする |

`agent`が空のタブは状態表示の対象外。通常のセッション終了時に3キーともクリアする。
`agent_status`が`working`のタブでは、そのタブのターミナルが出したBELをniwatermが捨てる
（エージェントは手が要らない途中経過でもBELを鳴らすため。`docs/known-issues/claude-code-rings-bell-while-still-working.md`）。
新しいエージェントへの対応では、`contrib/agent-integration/<agent-name>/`の設定とREADMEに加えて、
CLI側の状態マッピングとセットアップ対象を追加する。
