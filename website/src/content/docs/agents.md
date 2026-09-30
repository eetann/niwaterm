---
title: AIエージェント連携
description: Codex CLI・Claude Codeのhooksを入れてサイドバーに状態を出す方法と、Claude Codeの会話記録を読むコマンド
---

Codex CLIやClaude Codeが動いているタブの状態（作業中・応答待ちなど）を、サイドバーに出せる。複数のBoardでエージェントを並行して走らせていても、どれが手を止めて待っているかを一覧で見分けられる。hooksを入れておけば、Claude Codeの会話記録をCLIから読むこともできる。

## エージェント統合

エージェントのhooks（イベントごとにコマンドを呼ぶ仕組み）へniwatermのCLIを登録すると、エージェントが動くたびにタブの状態がniwatermへ届く。

### 導入する

`agent setup`を実行する。書き込むのはエージェント側の設定ファイルだけなので、niwatermアプリを起動していなくてもよい。

```sh
niwaterm agent setup claude-code
niwaterm agent setup codex-cli
```

| エージェント | 既定の設定先                                                              | 導入後にすること                                     |
| ------------ | ------------------------------------------------------------------------- | ---------------------------------------------------- |
| Claude Code  | `$CLAUDE_CONFIG_DIR/settings.json`（未設定なら`~/.claude/settings.json`） | Claude Codeを再起動する                              |
| Codex CLI    | `$CODEX_HOME/hooks.json`（未設定なら`~/.codex/hooks.json`）               | `/hooks`で追加された設定を確認して信頼し、再起動する |

既存の他ツールのhooksは残したまま、niwatermの分だけを追加・更新する。変更前のファイルは同じディレクトリの`*.niwaterm-<ID>.bak`へ保存される。何度実行しても重複しない。設定ファイルのJSONが壊れているときは書き換えずにエラーで止まる。

Codex CLIでhooksを無効にしている場合は、`config.toml`の`[features]`で`hooks = true`にする。

オプションは次の2つ。

```sh
niwaterm agent setup <codex-cli|claude-code> [--config <path>] [--cli <niwaterm|niwaterm-dev>]
```

- `--config` — 書き込む設定ファイルを変える。プロジェクト単位で入れるなら`--config .claude/settings.local.json`・`--config .codex/hooks.json`のように指定する（Codexの場合はそのプロジェクトも信頼しておく）
- `--cli` — hooksから呼ぶCLIの名前。省略時は`niwaterm`で、開発用のniwaterm-wipのタブで実行したときだけ`niwaterm-dev`になる

**グローバルとプロジェクトの両方に入れない**。エージェントはどちらの設定も読むので、同じイベントでhookが2回走る。Codexの`config.toml`の`[hooks]`へ自分でniwaterm用の設定を書いていた場合も、`agent setup`はそこを触らないので手で消す。

### サイドバーの見え方

![サイドバーに3つのBoardが並び、docs-siteのBoardだけBoard名の左のドットがオレンジに光って「Bash(bun run build)の実行を許可しますか」と出ている](/niwaterm/screenshots/agent.png)

状態は2か所に出る。

- **Board名の左のドット** — 作業中なら青、応答待ちならオレンジに光る。待機中は灰色のまま
- **Board名の下のステータスライン** — エージェントの状態テキスト。作業中は回転するアイコンと実行中のツール、応答待ちは警告アイコンと確認の文面、待機中は最後の応答の抜粋が出る

Board名にマウスを載せると出るツールチップにも、`claude-code: 作業中`のようにエージェントの種別と状態が並ぶ。

サイドバーはTile・Tabを並べずBoard単位で1行にまとめるので、1つのBoardの中で複数のエージェントが動いているときは、全タブの中から**応答待ち > 作業中 > 待機中**の順で目立つものを1つ選んで出す。フォーカスしていないタイルや裏のタブで止まっているエージェントも見落とさない。

ステータスラインに何を並べるか（ブランチ名と並べる順番、非表示にするなど）は[サイドバー設定](/niwaterm/boards/#サイドバー設定)で変えられる。ドットの色は設定に関わらず常に出る。

### 状態が変わるタイミング

| 状態     | Claude Code                        | Codex CLI                          |
| -------- | ---------------------------------- | ---------------------------------- |
| 待機中   | セッション開始、応答の完了         | セッション開始、応答の完了、中断   |
| 作業中   | プロンプトの送信、ツールの実行前後 | プロンプトの送信、ツールの実行前後 |
| 応答待ち | 権限の確認を求めたとき             | 承認を求めたとき                   |
| 表示なし | セッション終了                     | セッション終了                     |

- 応答待ちは権限・承認の確認だけを指す。Codexが質問ツールで入力を待っている間は作業中のまま
- 承認した瞬間には作業中へ戻らないことがある。次のツール実行・完了・中断のイベントで切り替わる
- 並行してツールを動かしていると、最後に届いた状態が表示される
- `Stop`の要約（最後の応答の抜粋）にはClaude Code v2.1.196以降が要る。古いバージョンでは状態だけが変わる
- エージェントを強制終了すると終了のhookが走らず、表示が残ることがある。そのタブで次にエージェントを起動すれば上書きされる

作業中のタブでエージェントが鳴らしたベル（BEL）は捨てる。エージェントは手を貸す必要のない途中経過でもベルを鳴らすため、応答待ちの通知と区別できなくなる。

### niwatermを更新したら

hooksに書き込まれるのは`niwaterm _hook claude-code >/dev/null 2>&1 || true`という1行だけで、状態の読み取りや要約の作り方はCLIの中にある。そのため、ふだんの更新はCLIを新しくするだけで反映される。

**`agent setup`を実行し直す必要があるのは、hooksの設定そのものが変わったとき**。購読するイベントが増えた、内部コマンドの名前が変わった、CLIの名前（`niwaterm`/`niwaterm-dev`）を切り替えた、といった場合がこれに当たる。hooksは利用者の設定ファイルへ書き写したものなので、niwaterm側を更新しても書き写した中身は古いまま残る。迷ったら実行し直してよい（何度実行しても重複しない）。

hooksのコマンドは出力を捨てて`|| true`で終わるため、コマンドが見つからなくてもエラーは表に出ず、エージェントの動作も止めない。**症状は「サイドバーに何も出ない」ことだけ**なので、更新後に表示が消えたらまず実行し直す。

`agent setup`を使わず、`contrib/agent-integration/<agent>/hooks.json`の中身を設定ファイルへ手で書き写してもよい。この場合も更新時に書き写し直す必要がある。

### 表示されないとき

- そのタブで`echo $NIWATERM_TAB_ID`が空でないか。niwaterm外のターミナルで動いているエージェントの状態は届かない（フォーカス中の別タブへ誤って書き込まないよう、何もせず終わる）
- hooksが呼ぶCLI（`niwaterm`）にエージェントからPATHが通っているか
- 設定を書き込んだ先を、エージェントが実際に読んでいるか（`--config`の指定先、`CLAUDE_CONFIG_DIR`・`CODEX_HOME`）
- Codexなら`/hooks`で設定を信頼したか
- `niwaterm tab var list`に`agent`・`agent_status`が入っているか。入っていればhookは動いていて、サイドバー側の設定（`sidebar.boardStatus`）を見る

hooksのコマンドはmacOS・Linux/WSLのシェル向けの書き方で、WindowsネイティブのPowerShellで動くエージェントには対応していない。

### タブ変数との関係

hookはタブ変数へ次の値を書き込み、サイドバーはそれを読んで表示している。自作のツールから状態を出したいときは、同じキーを`niwaterm tab var set`で書けば同じ見え方になる。

| キー                | 値                              | 説明                                                                                                        |
| ------------------- | ------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `agent`             | `claude-code` / `codex-cli`など | エージェントの種別。空のタブは状態表示の対象外                                                              |
| `agent_status`      | `idle` / `working` / `blocked`  | 待機中・作業中・応答待ち。未設定や未知の値は`idle`扱い                                                      |
| `agent_status_text` | 任意の文字列                    | ステータスラインに出す要約。改行はスペースにし、60文字で切り詰める                                          |
| `agent_transcript`  | 会話記録ファイルの絶対パス      | [Claude Codeのセッション参照](#claude-codeのセッション参照)が読む。セッション開始とプロンプト送信で更新する |

これらは予約キーで、セッション終了時にクリアされる。アプリ終了時に保存されても、Boardの復元では読み込まない（復元した時点ではエージェントが動いていないため）。

`bell`も予約キーで、ターミナルがBEL文字（`0x07`）を出力するとniwatermが`1`をセットし、そのタブが画面に出た時点で自動的に消す（タブバー・サイドバーのベルアイコンの出し分けに使う）。挙動の変更は設定ファイル側（`niwa.on("bell", ...)`、[ベルと通知](/niwaterm/bell/)参照）で行う。

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
