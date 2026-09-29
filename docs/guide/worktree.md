---
type: Reference
title: ワークツリー管理
description: niwatermからgitワークツリーを作成・開閉・削除する仕組みと、置き場所・作成後フック・Boardを開いた後のフック・レイアウト適用の設定
---

# ワークツリー管理

`niwaterm worktree`系コマンドで、gitのワークツリーを作成・一覧・削除し、それぞれをniwatermのBoardとして開ける。**1つのワークツリーが1つのBoard**（1ワークスペース内で持てる独立したTileレイアウト、tmuxのWindow相当。詳細: `docs/adr/0006-adopt-board-layer-between-workspace-and-tile.md`）に対応し、ブランチごとの作業場所をアプリ内で切り替えながら使う。

```sh
niwaterm worktree list [--cwd <dir>]
niwaterm worktree new <branch> [--track <mode>] [--remote <name>] [--fetch|--no-fetch] [--from <ref>] [--path <dir>] [--open <mode>] [--layout <name>] [--workspace <workspaceId>] [--name <name>] [--trust] [--cwd <dir>]
niwaterm worktree open <worktree> [--open <mode>] [--layout <name>] [--workspace <workspaceId>] [--name <name>] [--trust] [--cwd <dir>]
niwaterm worktree remove <worktree>... [--force] [--delete-branch] [--keep-board] [--cwd <dir>]
niwaterm board worktree set <path> [--board <boardId>]
niwaterm board worktree clear [--board <boardId>]
niwaterm board worktree show [--board <boardId>]
```

`worktree list`と`worktree new --open none`はniwatermアプリへ接続しないため、アプリが起動していない普通のターミナルからも使える（`worktree remove`も削除までは進み、Boardを閉じられない旨の警告だけ出す）。設定ファイル側（`worktree`）の書き方は`docs/guide/config.md`「ワークツリー」節を参照。

## Boardに紐づくワークツリー

Boardは「このBoardはこのワークツリーの作業だ」という紐づけを1つ持てる。`worktree new`・`worktree open`で開いたBoardには自動で付き、それ以外のBoardには`board worktree set`で後から付ける。

```sh
# 今いるディレクトリをこのBoardへ紐づける
niwaterm board worktree set .

# 紐づけの確認・解除
niwaterm board worktree show
niwaterm board worktree clear
```

`set`に渡すパスは相対でもよく、コマンドを実行したディレクトリ起点で解決される。紐づけは次の3つに効く。

- **`worktree open`の付け替え防止** — 「そのワークツリーのBoardが既に開いているか」の判定にこの値を使う（「ワークツリーを開く」節）。タブのcwdは見ないので、`cd`で別ディレクトリへ移っても判定は変わらない
- **消えたディレクトリの警告** — 紐づけ先が見つからなくなるとサイドバーのBoard行に警告アイコンが出る。ワークツリーを`git worktree remove`した後のBoardを見分けるためのもの
- **新しいタブのcwd** — `board.newTabCwd: "worktree"`を設定していれば、タブ追加・タイル分割・ポップアップのcwdが今のタブの引き継ぎではなく紐づけ先になる（`docs/guide/config.md`「Board設定」節）

GUIからはサイドバーのBoard行を右クリック →「ワークツリーを設定」、またはコマンドパレットの`Set Board Worktree Directory`で変更できる。入力欄にはそのBoardのカレントディレクトリが入った状態で開くので、そのまま確定すれば「今いるディレクトリを紐づける」になる。空のまま確定すると紐づけを解除する。既定のキーバインドは持たないので、キーから使いたい場合は`set-board-worktree`アクションを設定ファイルで割り当てる。

## ワークツリーの一覧

```sh
niwaterm worktree list
niwaterm worktree list --cwd /path/to/repo
```

gitのワークツリー一覧をTSV（`path`／`branch`／`HEAD`／フラグ）で表示する。**このコマンドはniwatermアプリに接続せず、CLIプロセスから直接gitを呼ぶ**ため、アプリが起動していない普通のターミナルからも使える。値の無い列は`-`で埋めるので、`cut -f2`のような読み取りが列ずれで壊れない。

```
/home/eetann/ghq/github.com/eetann/niwaterm       main  3aa3f4f4...  main
/home/eetann/ghq/github.com/eetann/niwaterm@dev   dev   2dbbd095...  -
```

先頭行は必ずメインワークツリー（gitがcwdに関わらずメインを先頭に出す）。4列目のフラグは`main`／`bare`／`detached`／`locked`／`prunable`をカンマ区切りで並べ、いずれにも該当しなければ`-`になる。detached HEADとbareのワークツリーは`branch`列が`-`、bareは`HEAD`列も`-`。

gitが無い・gitリポジトリの外・`--cwd`のディレクトリが存在しない場合は、それぞれの理由を示すエラーメッセージと共に終了コード1を返す。

## ワークツリーの作成

```sh
niwaterm worktree new <branch> [--track <mode>] [--remote <name>] [--fetch|--no-fetch] [--from <ref>] [--path <dir>] [--open <mode>] [--layout <name>] [--workspace <workspaceId>] [--name <name>] [--trust] [--cwd <dir>]
```

ワークツリーを作り、それをniwatermで開く。ブランチは**ローカル → リモート → 新規作成**の順に探す（探し方は`--track`で選べる。「リモートのブランチから作る」節）。`--from`は新規ブランチの分岐元（省略時はHEAD）で、既存ブランチに対して指定するとエラーになる（gitの`worktree add <path> <branch>`が分岐元を取らないため）。

作成先は「ワークツリーの置き場所」で決まるが、`--path`で個別に上書きできる（相対パスは実行したディレクトリ基準）。

**そのブランチのワークツリーが既にある場合はエラーにせず、作成を飛ばしてそれを開く**。同じコマンドを何度叩いても同じ結果になるので、「あれば使う、無ければ作る」を分岐なしで書ける。このとき作成時にしか効かない`--from`／`--path`／`--track`／`--remote`／`--fetch`を渡していると、効いていない旨の警告を出す。

`--open`は作成後の開き方で、次の4つから選ぶ。

| 値 | 挙動 |
|---|---|
| `board`（既定） | 新規Boardとして開くが、そのBoardへは遷移しない |
| `board-switch` | 新規Boardとして開き、そのBoardへ遷移する |
| `current-tab` | 実行したタブをそのワークツリーへ`cd`する（同じBoardの他のタブは触らない） |
| `none` | 開かない（ワークツリーを作るだけ） |

既定を`board`（遷移しない）にしているのは、作業中のBoardを奪わずに次のブランチを仕込めるようにするため。既定値は設定の`worktree.open`で変えられる（「ワークツリーの置き場所」と同じ優先順位で解決する）。

Boardで開く場合、**そのBoardにはブランチ名が付く**。`board`は遷移しないためサイドバーの表示が唯一の手がかりになる。別の名前にしたい場合は`--name`で指定する（`--open none`／`current-tab`はBoardを作らないので、指定しても効かない旨の警告を出す）。

さらに、**そのワークツリーのBoardが既に開いていれば新しく作らずそれを使う**（`board-switch`ならそのBoardへ遷移し、別のワークスペースにあればワークスペースごと切り替える）。このとき`--name`を指定していれば、使い回すBoardの名前も指定どおりに付け替える（`--layout`と違って名前の変更はタブを閉じないため）。判定にはBoardを開いたときに記録したワークツリーのパスを使い、タブのcwdは見ない（`cd`で変わるため）。Board名を変えても紐づけは切れず、別リポジトリの同名ブランチと取り違えることもない。

`current-tab`は`cd <path>`をそのタブへ送る（`tab send-keys`と同じ経路）。コマンドを実行しているシェルはCLIが終わるまで入力を読まないので、キーはtty側で待たされてからプロンプトへ流れる。`--open none`以外はniwatermアプリが起動している必要がある。

## リモートのブランチから作る

ローカルに無いブランチ名を渡すと、**リモート追跡ブランチを探してそこから作る**。同僚がpushしたブランチをレビューしたいときは、ブランチ名を渡すだけで済む。

```sh
niwaterm worktree new feat/x          # ローカル → リモート → 新規 の順に探す
niwaterm worktree new origin/feat/x   # リモートから、と明示する
```

`origin/feat/x`のようにリモート名を付けた指定も受け付ける（`git branch -r`の出力をそのまま貼れる）。ローカルブランチ名・ワークツリーの置き場所・Board名は、リモート名を除いた`feat/x`で決まる。できたローカルブランチには`<remote>/<branch>`がupstreamとして設定されるので、そのまま`git push`・`git pull`できる。

探し方は`--track`で選ぶ。

| 値 | 挙動 |
|---|---|
| `auto`（既定） | ローカルにあればそれを使い、無くてリモートにあればtrackし、どちらにも無ければ`--from`（既定はHEAD）から新規に作る |
| `remote` | リモート追跡ブランチからtrackする。無ければエラー |
| `local` | ローカルブランチを使う。無ければエラー |
| `new` | 必ず新規ブランチを作る。リモートに同名があっても無視し、ローカルに同名があればエラー |

`auto`がローカルを先に見るのは、同名のローカルブランチがある状態でリモートからブランチを作ろうとしてもgitが弾くため。手元にブランチがあるなら、それが作業の続きになる。

`--from`（分岐元）を付けると暗黙に`--track new`になる。分岐元の指定は新規ブランチにしか意味が無いためで、`--track remote`や`origin/feat/x`と組み合わせるとエラーになる。

リモートが複数ある場合は`origin`を使い、`--remote upstream`または`upstream/feat/x`で選べる。リモートが1つならそれが使われる。`origin`が無くリモートが複数ある場合、`auto`はリモートを見ずにローカル・新規で解決し、`--track remote`は「どれを使うか決められない」というエラーで止まる。

> **note**: gitにも「ローカルに無いブランチ名を、同名を持つ唯一のリモートから推測する」挙動（`git worktree add <path> <branch>`のDWIM）があるが、niwatermはこれに任せず自分で解決している。あの挙動はリモートが複数あると`fatal: invalid reference`で落ちるだけで、どちらのリモートかを選ぶ余地が無いため。

### fetchのタイミング

**ワークツリーを新規に作る前に`git fetch <remote>`を1回打つ**。pushされたばかりのブランチでも、手でfetchしてから叩き直さずに済むようにするため。

次の場合はfetchしない。

- `--no-fetch`を付けたとき、または設定の`worktree.fetch`が`false`のとき（`--fetch`で個別に打ち消せる）
- `--track local`のとき（手元のブランチしか見ないので、ネットワークに出る意味が無い）
- そのブランチのワークツリーが既にあって、開くだけのとき
- リモートが1つも設定されていないとき

fetchが失敗しても**警告を出して続行する**。オフラインでもローカルブランチのワークツリーは作れるべきで、ネットワークの都合で作成自体が止まるのは困るため。

## ワークツリーを開く

```sh
niwaterm worktree open <worktree> [--open <mode>] [--layout <name>] [--workspace <workspaceId>] [--name <name>] [--trust] [--cwd <dir>]
```

既にあるワークツリーをniwatermで開く。作成はしないので、無ければ作りたい場合は`worktree new`を使う。

`<worktree>`はブランチ名・パス（相対は実行したディレクトリ基準）・ディレクトリ名のいずれでも指定でき、この順に探して最初に当たったものを開く。段階を分けているのは、ブランチ名のつもりで渡した文字列が別ワークツリーのディレクトリ名に一致して化けるのを防ぐため。同じディレクトリ名のワークツリーが複数ある場合は候補を並べて終了コード1で止まるので、パスで指定し直す。bareのワークツリーはワーキングツリーを持たないため候補から外れる。

`--open`の値は`worktree new`と同じだが、**既定は`board-switch`（開いたBoardへ遷移する）**。「開く」と打った時点でそこへ移りたいはずのため、設定の`worktree.open`（作成後の開き方の既定値）はこちらには効かせていない。

設定の読み取りは**Boardを新規に作るときまで遅らせる**。既に開いているBoardへ切り替えるだけの場合や`--open none`／`current-tab`の場合は、プロジェクトローカル設定を読む必要が無いので確認も出ない（ワークツリーへ移るだけの用途に承認の手間をかけないため）。

## ワークツリーの削除

```sh
niwaterm worktree remove <worktree>... [--force] [--delete-branch] [--keep-board] [--cwd <dir>]
```

ワークツリーをディレクトリごと削除し、そのワークツリーで開いたBoardを閉じる。`<worktree>`の指定方法は`worktree open`と同じ（ブランチ名・パス・ディレクトリ名）で、スペース区切りで複数渡せる。同じワークツリーを指す重複指定は1つに畳む。メインワークツリーは削除できない。

消えて困るものが残っていないかを先に数え、次のいずれかがあれば**何も消さずに終了コード1で止まる**。複数指定した場合、指定の解決もこの判定も**全対象について先に済ませる**ので、1つでも引っかかれば他の対象も消えない（片方だけ消えた中途半端な状態を作らないため）。理由は対象ごとに並べて表示する。

| 止まる条件 | 理由 |
|---|---|
| 未コミットの変更（未追跡ファイルを含む） | ディレクトリごと消えるため戻せない |
| どのリモート追跡ブランチにも無いコミット | `--delete-branch`と組み合わせると失われる |
| `git worktree lock`済み | ロックは「触るな」という明示の印のため |

```
$ niwaterm worktree remove feat/x
worktree removeに失敗しました: /path/to/repo@feat-x は削除しませんでした:
  - 未コミットの変更が3件あります（ワークツリーごと消えます）
  - どのリモートにも無いコミットが2件あります
無視して削除するには--forceを付けてください
```

複数指定したときは対象ごとに理由が並ぶ。

```
$ niwaterm worktree remove feat/x feat/y
worktree removeに失敗しました:
  - /path/to/repo@feat-x は削除しませんでした:
      - 未コミットの変更が3件あります（ワークツリーごと消えます）
  - /path/to/repo@feat-y は削除しませんでした:
      - ワークツリーがロックされています: wip
無視して削除するには--forceを付けてください
```

未pushのコミットまで見るのは`git worktree remove`がやらない部分で、リモートが1つも設定されていないリポジトリでは判定しない（push先が無いため）。判定はupstreamとの差分ではなく**リモート追跡ブランチ全体との差分**で行うので、upstream未設定のまま`worktree new`で作ったブランチでも取りこぼさない。実体ディレクトリが既に無いワークツリー（`worktree list`で`prunable`）は中身を問わずに消せる。

`--force`はこれらをすべて無視する。

ブランチは既定では残す。`--delete-branch`を付けると削除後に`git branch -d`し、未マージのブランチには`--force`も要る。ワークツリーを消した後にブランチの削除だけ失敗した場合は、その旨を表示して終了コード1になる（ワークツリーは削除済み）。detached HEADのワークツリーには効かず、警告を出して飛ばす。

ガード判定を抜けた後の失敗（Windowsでディレクトリを掴まれている・ブランチが未マージ等）は対象ごとに扱う。そこで止めずに残りの対象を最後まで処理し、まとめて報告して終了コード1になる。削除できた分はそのまま削除済みになる。

Boardは既定で閉じる。ワークツリーを消した後もBoardが残ると、cwdが存在しないタブだけが残るため。`--keep-board`で残せる。ワークスペースが1つだけの状態でその中の最後の1つのBoardを閉じようとした場合は閉じられないので、警告に留めて終了コード0を返す（削除自体は済んでいるため）。niwatermアプリが起動していない場合も同様に警告だけ出す。

**このコマンドを実行しているタブが属するBoardは閉じない**。閉じるとそのタブのPTYが落ち、シェルごとCLI自身が巻き添えで殺されるため、残りのBoardのcloseも出力も終了コードも受け取れなくなる。削除対象のワークツリーのタブから実行した場合はそのBoardだけが警告付きで残るので、別のワークツリーへ移るか手で閉じる。niwatermの外（普通のターミナル・スクリプト）から実行した場合は閉じてもCLIが死なないため、対象のBoardをすべて閉じる。

Boardを閉じるのはワークツリーを消し終えた後。複数のワークツリーを指定した場合も、全部消し終えてから対応するBoardをまとめて閉じる。

Windowsは**カレントディレクトリにしているプロセスがあるとディレクトリを削除できない**ので、そのワークツリーで動いている別のシェル・エディタがあると`git worktree remove`が失敗する（CLI自身のcwdは削除前に退避する）。

## ワークツリーの置き場所

新規ワークツリーを作る場所は、`${repo}`（メインワークツリーのディレクトリ名）と`${branch}`（ブランチ名）を展開するテンプレートで決める。既定は`../${repo}@${branch}`で、メインワークツリーの隣に`<repo>@<branch>`という名前で並ぶ。ブランチ名の`/`は`-`へ潰されるため、`feat/worktree`は`niwaterm@feat-worktree`になる。

テンプレートは次の順で探し、最初に見つかったものを使う。`--open`の既定値（`worktree.open`）・fetchするかどうか（`worktree.fetch`）も同じ順で解決する。

| 優先 | 置き場所 | 用途 |
|---|---|---|
| 1 | `<repoRoot>/.niwaterm/config.ts`の`worktree.*` | そのリポジトリ固有の方針（チームで共有できる） |
| 2 | `~/.config/niwaterm/niwaterm.config.ts`の`worktree.*` | ユーザー共通の方針 |
| 3 | git configの`niwaterm.worktree.*` | niwatermを入れていない環境とも設定を共有したい場合の補助口 |
| 4 | （既定値） | `dir`は`../${repo}@${branch}`、`open`は`board`、`fetch`は`true` |

解決は**項目ごとに独立している**。`dir`はグローバル設定、`open`はこのリポジトリだけ別、といった混ぜ方ができる。

git configを一番弱くしているのは、niwatermの設定の正本が`niwaterm.config.ts`だから。git config内部のローカル／グローバルの優先順位はgit自身が解決するので、niwaterm側では段階を持たない。

```sh
git config niwaterm.worktree.dir '.worktrees/${branch}'
git config niwaterm.worktree.open board-switch
git config niwaterm.worktree.fetch false
```

テンプレートは`~/`始まり・絶対パス・メインワークツリー基準の相対パスのいずれでも書ける。設定ファイル側の書き方は`docs/guide/config.md`「ワークツリー」節を参照。

プロジェクトローカル設定は、レイアウトプリセットと違って**cwdから上向きに探さず、メインワークツリー直下の`.niwaterm/config.ts`だけを見る**。置き場所はリポジトリ全体の方針であって、ワークツリーごとに変わるものではないため。

## 作成後フック

ワークツリーを**新規作成した直後**に走るフックを設定できる（`bun install`・`.env`のコピー・`direnv allow`あたりを想定）。既存のワークツリーを開き直した場合は走らない。

```ts
// ~/.config/niwaterm/niwaterm.config.ts
worktree: {
  onCreate: async (ctx) => {
    await Bun.$`bun install`.cwd(ctx.worktreePath);
  },
},
```

`ctx`には`repoRoot`（メインワークツリー）・`worktreePath`（作ったワークツリー）・`branch`が入る。宣言的なコピー・リンクのDSLは用意していない。設定がTypeScriptなので、条件分岐もファイル操作も素のコードで書けるため（キーバインドの関数ハンドラと同じ方針）。

**niwaterm CLIのプロセスで、Boardを開く前にawaitされる**。タブが立ち上がる時点でセットアップが済んでいるので、`--open`のどのモード（`none`・`current-tab`含む）でも同じように走る。標準出力はコマンドを実行したターミナルへそのまま流れるため、完了するまでプロンプトは戻らない。

フックが例外を投げた場合は**ワークツリーを残したまま終了コード1で止まり、Boardは開かない**。準備できていないワークツリーで作業を始めてしまうより、直して開き直せるほうがよいため。残ったワークツリーは`worktree new`を再実行すれば開けるが、そのときフックは走らない（新規作成ではないため）。

Boardのフェーズ・タブ変数のように、Boardができてから行う操作は`onOpen`（「Boardを開いた後のフック」節）に書く。

## レイアウトプリセットの適用

```sh
niwaterm worktree new feat/x --layout dev
niwaterm worktree open feat/x --layout dev
```

ワークツリーのBoardへ、`layouts`のレイアウトプリセット（`docs/guide/config.md`「レイアウト」節参照）を適用する。省略時は設定の`worktree.layout`が使われる（置き場所と同じ優先順位で解決する）。

適用されるのは**Boardを新規に作ったときだけ**。既にそのワークツリーのBoardが開いている場合・`--open none`／`current-tab`の場合は適用せず、効いていない旨の警告を出す。レイアウトの適用は既存タブ・PTYをすべて閉じる破壊的操作なので、作業中のBoardを奪わないため。作りたてのBoardは単一タイル・単一タブなので、失われるものは無い。

プリセットは**メインワークツリーの`.niwaterm/`から引き**、タブは**そのワークツリーで開く**。解決起点をメインワークツリーに揃えているのは`worktree.*`の設定と同じ理由（置き場所・開き方はリポジトリ全体の方針）で、`.niwaterm/`をリンクされたワークツリーへコミットしていない運用でもプロジェクトローカルのプリセットが引ける。`layout apply`はプリセットの解決元をタブのcwdの基準にするが、ここでは解決元と開く場所が別になるため分けている（プリセット側で`cwd: "./packages/cli"`のように書いた相対パスも、ワークツリー基準で解決される）。

適用したプリセットは、そのBoardの**起動時レイアウトとしても紐づく**（`layout apply <name> --startup`相当。`docs/guide/cli.md`「起動時レイアウト」節参照）。ワークツリーのBoardの中身はプリセットが決めているので、次回の起動でも保存した骨格を復元するのではなくプリセットで組み直す（タブの`command`も改めて実行される）。組み直しの際もタブが開くのは**そのワークツリー**で、プリセットの解決元（メインワークツリー）ではない。

骨格の復元に戻したい・紐づけを外したいBoardは`board startup restore`／`board startup clear`を使う。

プロジェクトローカルのプリセットを使う場合は、**プロジェクトローカル設定の承認（下記）が必要**。プリセットの解決でそのリポジトリの`.niwaterm/config.ts`が評価されるためで、未承認のままレイアウトを指定すると終了コード1で止まる（`--trust`で承認できる）。グローバル設定の`layouts`だけを使う場合も、プロジェクトローカル設定を持つリポジトリでは同じ理由で承認が要る。

## Boardを開いた後のフック

ワークツリーのBoardを**新規に作った後**に走るフックを設定できる。Boardの作業フェーズ・タブ変数の設定など、Boardができていないとできない操作を想定している。`onCreate`はBoardを開く前に走るため、そこから`niwaterm board phase set`を叩いても対象のBoardがまだ無い。

```ts
// ~/.config/niwaterm/niwaterm.config.ts
worktree: {
  onOpen: async (ctx) => {
    if (ctx.created) {
      await Bun.$`niwaterm board phase set impl --board ${ctx.boardId}`;
    }
    await Bun.$`niwaterm tab var set --tab ${ctx.tabIds[0]} role main`;
  },
},
```

`ctx`の中身は次のとおり。

| フィールド | 意味 |
|---|---|
| `repoRoot` | メインワークツリーのパス |
| `worktreePath` | 開いたワークツリーのパス |
| `branch` | ブランチ名（detached HEADのワークツリーは`null`） |
| `created` | 今回の`worktree new`でワークツリーを新規作成したか。`worktree open`・作成済みのワークツリーでは`false` |
| `workspaceId` | Boardが属するワークスペース |
| `boardId` | 作ったBoard |
| `tabIds` | Boardのタブ（レイアウトプリセット適用後）。タイルの並び順 |

Boardの操作用の関数は`ctx`に生やしていない。IDを受け取ってCLIを叩けば何でも書けるため、同じ操作の口を二重に持たないようにしている。フックの中で`--board`・`--tab`を省略すると、フックではなく**コマンドを実行したタブ**が対象になるので、必ずIDを渡す。

走るのは**Boardを新規に作ったときだけ**で、条件はレイアウトプリセットの適用と同じ。既にそのワークツリーのBoardが開いていて使い回した場合・`--open none`／`current-tab`の場合は走らない。作業中のBoardのフェーズや変数を勝手に上書きしないため。`worktree new`でも`worktree open`でも走るので、ワークツリーを作ったときだけの処理は`ctx.created`で分ける。

**niwaterm CLIのプロセスで、レイアウトプリセットの適用まで済んでから**awaitされる（`board: <boardId>`の出力の後）。niwatermの起動時にプリセットでBoardを組み直すときは走らない。起動のたびに走らせたい処理はプリセットのタブの`command`に書く。

フックが例外を投げても**Boardは閉じず**、終了コード1で止まる。Boardは作業できる状態になっているので、捨てるより足りない操作を手で補えるほうがよいため。

`onCreate`と同じく、グローバル設定とプロジェクトローカル設定の両方に書くとグローバル→プロジェクトの順に**両方**走る。プロジェクトローカル側のフックは承認（下記）したリポジトリでだけ読む。

## プロジェクトローカル設定の承認

`worktree.*`の設定は`<repoRoot>/.niwaterm/config.ts`にも書ける（チームで置き場所やセットアップ手順を共有する用途）。ただしこれはリポジトリにコミットされるファイルなので、cloneしてきたリポジトリで`worktree new`を叩くと、`onCreate`・`onOpen`のフックやレイアウトプリセットの`command`に書かれた他人のコードがこちらのマシンで動くことになる。そのため**承認していないリポジトリではプロジェクトローカル設定を一切読まない**。

```
$ niwaterm worktree new feat/x
このリポジトリはniwatermのプロジェクトローカル設定を持っています:
  /path/to/repo/.niwaterm/config.ts
ワークツリーの操作でこのファイルが評価され、worktree.onCreate・onOpenのフックやlayoutsのプリセットに書かれたコマンドが実行されます。
レイアウトプリセットを適用したBoardは起動時レイアウトとしても紐づくため、以後niwatermを起動するたびにも実行されます。
信頼できるリポジトリでのみ許可してください。
このリポジトリを信頼しますか？ (y/N)
```

承認は`~/.config/niwaterm/trusted-projects/`へ記録され、次回以降は確認なしで読まれる。記録の鍵は**リポジトリのパスと`.niwaterm/`配下の内容のハッシュ**なので、承認後にフックを書き換えられても黙って実行されることはない（改めて確認が出る）。`.niwaterm/`の外をimportしている場合（`../scripts/setup.ts`等）、その変更までは検出できない。

`--trust`を付けると確認を省いて承認する（非対話環境向け）。非対話環境で`--trust`も無い場合は、確認できない旨を表示してプロジェクトローカル設定を無視したまま続行する（ハングもエラーもしない）。

承認は**設定を読むこと自体**にかかる。importした時点でファイルのトップレベルのコードが走るため、フック（`onCreate`・`onOpen`）の呼び出しだけを止めても意味がないため。したがって未承認のリポジトリでは`worktree.dir`・`worktree.open`・`worktree.layout`もプロジェクトローカル側が効かず、グローバル設定とgit configだけで解決される。

`--layout`（「レイアウトプリセットの適用」節）も同じ承認で門番する。プリセットの解決はアプリ側が`<repoRoot>/.niwaterm/config.ts`を評価して行うため、CLIがimportしなくてもそこでコードが走るためで、未承認のままレイアウトを指定すると終了コード1で止まる。

起動時レイアウトへの紐づけ（`layout apply --startup`と同じ操作）にも本来は専用の確認があるが、`worktree new`／`worktree open`ではこの承認がそれを兼ねる（確認文で起動のたびに実行されることまで断っているため、同じリポジトリのプリセットで確認が二重に出ることはない）。プリセットの解決元がこのリポジトリの外（親ディレクトリの`.niwaterm/`等）だった場合だけは承認の範囲外なので、改めて紐づけの確認が出る。断ると紐づけを作らず、今回の適用だけを行う。

確認が出るのは、実際にプロジェクトローカル設定を読む必要があるときだけ。`worktree open`で既に開いているBoardへ切り替えるだけの場合は設定を読まないので、確認も出ない。

> **note**: レイアウトプリセットのプロジェクトローカル設定を`layout list`／`layout apply`から使う場合は、この承認を通らず従来どおり読まれる。あちらの確認は「起動時レイアウトへの紐づけ」にかかっていて、設定を読むこと自体は素通しになっている（`docs/guide/cli.md`「プロジェクトローカルのレイアウト」節）。

## GUIから使う

Boardへのワークツリーの紐づけは、サイドバーのBoard行の右クリックとコマンドパレットから変更できる（「Boardに紐づくワークツリー」節）。

ワークツリーの一覧・絞り込み・作成をniwaterm内のUIで行いたい場合は、ユーザー定義HTML UI（`customViews`）のサンプルが`contrib/custom-views/worktrees/`にある。サイドバーへ一覧を出し、行のクリックで`worktree open`、入力欄へ入れたブランチ名で`worktree new`を実行する。導入手順と変更しどころは同ディレクトリのREADME、`customViews`自体の仕様は`docs/guide/config.md`「ユーザー定義HTML UI（customViews）」節を参照。

このサンプルが一覧するリポジトリは、一覧を取った時点でフォーカス中タイルのアクティブタブがいたディレクトリで決まる。タブのcwdの報告にはシェル統合（`docs/guide/cli.md`「シェル統合」節）が要るので、先に入れておく。
