---
title: AIエージェント連携
description: AIエージェントにniwatermを操作させるスキル、Codex CLI・Claude Codeのhooksを入れてサイドバーに状態を出す方法、Claude Codeの会話記録を読むコマンド
---

Codex CLIやClaude Codeが動いているタブの状態（作業中・応答待ちなど）を、サイドバーに出せる。複数のBoardでエージェントを並行して動かしていても、どれが手を止めて待っているかを一覧で見分けられる。hooksを入れておけば、Claude Codeの会話記録をCLIから読むこともできる。

スキルを入れれば、エージェントがniwatermを操作できるようになる。別のタブでサーバーを起動して出力を読む、といった作業を任せられる。

## エージェントにniwatermを操作させる

niwatermのリポジトリの`skills/niwaterm/`に、エージェント向けのスキル（`SKILL.md`）を置いている。入れておくと、エージェントは`niwa`コマンドでタブを作り、コマンドを送り、画面の内容を読めるようになる。

[skills](https://github.com/vercel-labs/skills)で入れる場合は、次のように実行する。

```sh
npx skills add eetann/niwaterm --skill niwaterm
```

[agent-skills-nix](https://github.com/Kyure-A/agent-skills-nix)で管理する場合は、niwatermのリポジトリをflakeのinputに加え、`subdir = "skills"`のソースから`niwaterm`を有効にする。

スキルに書いてあるのは、よく使うコマンドと、使い方の調べ方だけ。それ以外はエージェントが`niwa docs search`と`niwa docs show`でこのドキュメントを読んで調べる（[ヘルプとドキュメント](/niwaterm/cli/#ヘルプとドキュメント)）。niwatermを更新するとドキュメントも新しくなるので、スキルを入れ直さなくても新しいコマンドを使える。

## エージェント統合

エージェントのhooks（イベントごとにコマンドを呼ぶ仕組み）へniwatermのCLIを登録すると、エージェントが動くたびにタブの状態がniwatermへ届く。

### 導入する

`agent setup`を実行する。書き込むのはエージェント側の設定ファイルだけなので、niwatermアプリを起動していなくてもよい。

```sh
niwa agent setup claude-code
niwa agent setup codex-cli
```

| エージェント | デフォルトの設定先                                                        | 導入後にすること                                     |
| ------------ | ------------------------------------------------------------------------- | ---------------------------------------------------- |
| Claude Code  | `$CLAUDE_CONFIG_DIR/settings.json`（未設定なら`~/.claude/settings.json`） | Claude Codeを再起動する                              |
| Codex CLI    | `$CODEX_HOME/hooks.json`（未設定なら`~/.codex/hooks.json`）               | `/hooks`で追加された設定を確認して信頼し、再起動する |

既存の他ツールのhooksは残したまま、niwatermの分だけを追加・更新する。変更前のファイルは同じディレクトリの`*.niwaterm-<ID>.bak`へ保存される。何度実行しても重複しない。設定ファイルのJSONを読めないときは書き換えずにエラーで止まる。

Codex CLIでhooksを無効にしている場合は、`config.toml`の`[features]`で`hooks = true`にする。

オプションは次の2つ。

```sh
niwa agent setup <codex-cli|claude-code> [--config <path>] [--cli <niwaterm|niwa-dev>]
```

- `--config` — 書き込む設定ファイルを変える。プロジェクト単位で入れるなら`--config .claude/settings.local.json`・`--config .codex/hooks.json`のように指定する（Codexの場合はそのプロジェクトも信頼しておく）
- `--cli` — hooksから呼ぶCLIの名前。省略時は`niwa`で、開発用のniwaterm-wipのタブで実行したときだけ`niwa-dev`になる

**グローバルとプロジェクトの両方に入れない**。エージェントはどちらの設定も読むので、同じイベントでhookが2回動く。Codexの`config.toml`の`[hooks]`へ自分でniwaterm用の設定を書いていた場合も、`agent setup`はそこを触らないので手で消す。

### サイドバーの見え方

![サイドバーに3つのBoardが並び、docs-siteのBoardだけBoard名の左のドットがオレンジに光って「Bash(bun run build)の実行を許可しますか」と出ている](/niwaterm/screenshots/agent.png)

状態は2か所に出る。

- **Board名の左のドット** — 作業中なら青、応答待ちならオレンジに光る。待機中は灰色のまま
- **Board名の下のステータスライン** — エージェントの状態テキスト。作業中は回転するアイコンと実行中のツール、応答待ちは警告アイコンと確認の文面、待機中は最後の応答の抜粋が出る

Board名にマウスを載せると出るツールチップにも、`claude-code: 作業中`のようにエージェントの種別と状態が並ぶ。

1つのBoardの中で複数のエージェントが動いているときは、**応答待ち > 作業中 > 待機中**の順で1つを選んで出す。フォーカスしていないタイルや裏のタブで止まっているエージェントにも気づける。

ステータスラインに何を並べるか（ブランチ名と並べる順番、非表示にするなど）は[サイドバーでBoard名の下に出す情報](/niwaterm/boards/#サイドバーでboard名の下に出す情報)で変えられる。ドットの色は設定に関わらず常に出る。

### 状態が変わるタイミング

| 状態     | Claude Code                        | Codex CLI                          |
| -------- | ---------------------------------- | ---------------------------------- |
| 待機中   | セッション開始、応答の完了         | セッション開始、応答の完了、中断   |
| 作業中   | プロンプトの送信、ツールの実行前後 | プロンプトの送信、ツールの実行前後 |
| 応答待ち | 権限の確認を求めたとき             | 承認を求めたとき                   |
| 表示なし | セッション終了                     | セッション終了                     |

作業中のタブでエージェントが鳴らしたベル（BEL）は捨てる。エージェントは手を貸す必要のない途中経過でもベルを鳴らすため、応答待ちの通知と区別できなくなる。

### niwatermを更新したら

ふだんの更新は、niwatermを新しくするだけで反映される。

**`agent setup`を実行し直す必要があるのは、hooksの設定そのものが変わったとき**。hooksはエージェントの設定ファイルへ書き写したものなので、niwatermを更新しても書き写した中身は古いまま残る。迷ったら実行し直してよい（何度実行しても重複しない）。

hooksはエラーを表に出さず、エージェントの動作も止めない。うまく動かないときの**症状は「サイドバーに何も出ない」ことだけ**なので、更新後に表示が消えたらまず実行し直す。

`agent setup`を使わず、[`contrib/agent-integration/`](https://github.com/eetann/niwaterm/tree/main/contrib/agent-integration)にあるエージェントごとの`hooks.json`の中身を設定ファイルへ手で書き写してもよい。この場合も更新時に書き写し直す必要がある。

### 表示されないとき

- そのタブで`echo $NIWATERM_TAB_ID`が空でないか。niwaterm以外のターミナルで動いているエージェントの状態は届かない
- hooksが呼ぶCLI（`niwa`）にエージェントからPATHが通っているか
- 設定を書き込んだ先を、エージェントが実際に読んでいるか（`--config`の指定先、`CLAUDE_CONFIG_DIR`・`CODEX_HOME`）
- Codexなら`/hooks`で設定を信頼したか
- `niwa tab var list`に`agent`・`agent_status`が入っているか。入っていればhookは動いていて、サイドバー側の設定（`sidebar.boardStatus`）を見る

hooksのコマンドはmacOS・Linux/WSLのシェル向けの書き方で、WindowsネイティブのPowerShellで動くエージェントには対応していない。

### タブ変数との関係

hookはタブ変数へ次の値を書き込み、サイドバーはそれを読んで表示している。自作のツールから状態を出したいときは、同じキーを`niwa tab var set`で書けば同じ見え方になる。

| キー                | 値                              | 説明                                                                                                                             |
| ------------------- | ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `agent`             | `claude-code` / `codex-cli`など | エージェントの種別。空のタブは状態表示の対象外                                                                                   |
| `agent_status`      | `idle` / `working` / `blocked`  | 待機中・作業中・応答待ち。未設定や未知の値は`idle`扱い                                                                           |
| `agent_status_text` | 任意の文字列                    | ステータスラインに出す要約。改行はスペースにし、60文字で切り詰める                                                               |
| `agent_transcript`  | 会話記録ファイルの絶対パス      | [プロンプトの目次](/niwaterm/hover-buttons/#claude-codeのプロンプトの目次を出す)が読む。セッション開始とプロンプト送信で更新する |

これらはセッションが終わると消える。niwatermを起動し直したときにも引き継がない。

`bell`もniwatermが使うキーで、ベルが鳴ったタブに`1`が入る。ベルの扱いを変えるときは[ベルと通知](/niwaterm/bell/)を参照。
