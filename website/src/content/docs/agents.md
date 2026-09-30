---
title: AIエージェント連携
description: Codex CLI・Claude Codeのhooksを入れてサイドバーに状態を出す方法と、Claude Codeの会話記録を読むコマンド
---

Codex CLIやClaude Codeが動いているタブの状態（作業中・承認待ちなど）を、サイドバーに出せる。hooksを入れておけば、Claude Codeの会話記録をCLIから読むこともできる。

## エージェント統合

`agent setup`でCodex CLIまたはClaude Codeのhooksを導入する。アプリの起動は不要。

```sh
niwaterm agent setup <codex-cli|claude-code> [--config <path>] [--cli <niwaterm|niwaterm-dev>]

niwaterm agent setup codex-cli
niwaterm agent setup claude-code
niwaterm-dev agent setup codex-cli
```

既定の設定先はCodexが`$CODEX_HOME/hooks.json`（未設定なら`~/.codex/hooks.json`）、Claude Codeが`$CLAUDE_CONFIG_DIR/settings.json`（未設定なら`~/.claude/settings.json`）。プロジェクト単位など別のJSONへ書く場合は`--config`で指定する。
既存の他ツールの設定を保持し、niwatermのhooksだけを追加・更新する。変更前のファイルは同じディレクトリの`*.niwaterm-<ID>.bak`へ保存する。再実行しても重複せず、設定のJSONが不正な場合は書き換えない。

hooksに登録するCLI名は`NIWATERM_APP_VARIANT=niwaterm-wip`なら`niwaterm-dev`、それ以外なら`niwaterm`。`--cli`で明示もできる。
Codexは導入後に`/hooks`で設定を確認して信頼し、再起動する。Claude Codeも再起動する。
複数の設定元に重複して導入しない。Codexの`config.toml`に埋め込んだniwaterm用hooksはこのコマンドでは変更しないため、別途整理する。

内部コマンド`niwaterm _hook <codex-cli|claude-code>`は通常のヘルプには表示しない。エージェントのJSON入力から、タブ変数`agent`（種別）・`agent_status`（`idle` / `working` / `blocked`）・`agent_status_text`（要約）・`agent_transcript`（会話記録ファイルのパス）を更新する。`agent_transcript`はパスが変わらないので、セッション開始とプロンプト送信のときだけ書き込む（入力に会話記録のパスを渡さないエージェントでは書き込まない）。
`NIWATERM_TAB_ID`がない環境では何もせず、不正入力や接続失敗でも無出力・終了コード0で終了する。処理の上限は2秒。`jq`は不要で、hook本体の修正はCLIの更新で反映される。購読イベントやCLI名を変えた場合は`agent setup`を再実行する。
配布設定のシェル構文はmacOS・Linux/WSL向け。

サイドバーはBoard内の全タブを走査し、`blocked` > `working` > `idle`の順で状態を表示する。`agent`が空のタブは対象外で、未知の状態値は`idle`扱い。要約は改行をスペースに置換し、Unicodeのコードポイント単位で60文字に切り詰める。
Codexの質問ツールによる入力待ちは`working`のままで、`blocked`は承認要求を表す。並行ツールの状態は最後の書き込みが優先される。

`agent` / `agent_status` / `agent_status_text` / `agent_transcript`は予約キーで、通常のセッション終了時にクリアする。アプリ終了時に保存されても、Board復元では読み込まれない。
エージェント別のイベント対応と導入例は、リポジトリの`contrib/agent-integration/`配下を参照。

`bell`も同じく予約キーで、ターミナルがBEL文字（`0x07`）を出力するとniwatermが`1`をセットし、そのタブが画面に出た時点で自動的に消す（タブバー・サイドバーのベルアイコンの出し分けに使う）。復元で読み込まれない点も`agent`系と同じ。挙動の変更は設定ファイル側（`niwa.on("bell", ...)`、[ベルと通知](/niwaterm/bell/)参照）で行う。

## Claude Codeのセッション参照

```sh
niwaterm claude prompt list [--tab <tabId>] [--transcript <path>] [--json] [--label <chars>]
niwaterm claude prompt show [--prompt <index|uuid>] [--tab <tabId>] [--transcript <path>] [--json] [--max-result <chars>] [--sidechain]
```

そのタブで動いているClaude Codeのtranscript（会話記録のjsonl）から、打ったプロンプトの一覧と、
そのプロンプトからのやりとりを読む。

- `claude prompt list` — ユーザーが打ったプロンプトを番号付きで並べる。システムが差し込んだ
  プロンプト（タスク通知等）とサブエージェントの内部やりとりは除く
- `claude prompt show` — 指定したプロンプトから次のプロンプトまでのやりとりを、プロンプト・応答・
  thinking・ツール呼び出し・ツール結果に分けて出す。`--prompt`は`list`の番号かuuid（前方一致可）で、
  省略すると最後のプロンプト。ツール結果は1件ずつ文字数で打ち切る（`--max-result`、既定2000）。
  `--sidechain`でサブエージェントのやりとりも含める

**画面ではなくファイルを読む**。Claude Codeはalternate screenで動くため、会話履歴はniwatermの
スクロールバックに残らず、`tab capture`でもプロンプトジャンプでも辿れない
（docs/known-issues/claude-code-history-not-in-scrollback.md）。裏返しの利点として、
コンテキスト圧縮で画面から消えたやりとりも読める。

transcriptの場所は、[エージェント統合](#エージェント統合)のhooksがタブ変数`agent_transcript`へ
書き込んだものを使う。hooksを入れていないタブでは`--transcript`でjsonlのパスを直接渡す。
`--json`は設定ファイルやAIエージェントからパースする用で、`list`はプロンプトの配列、
`show`は`{prompt, blocks}`を出す。

タブの端に目次を出して、クリックしたプロンプトへClaude Code側の表示を移す例が
`contrib/agent-integration/claude-code/prompt-jump/`にある。
