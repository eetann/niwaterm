---
title: シェル統合と補完
description: ブランチ名・カレントディレクトリ・プロンプトの位置をniwatermへ知らせるシェル統合と、CLIのシェル補完の設置
---

シェルの起動スクリプトに1行足すと、niwatermがタブのブランチ名・カレントディレクトリ・プロンプトの位置を知れるようになる。あわせて、`niwaterm`コマンドのシェル補完の置き方もこのページにまとめる。

## シェル統合

シェル統合のスクリプトを入れると、シェルがプロンプトを出すたびに、今いるディレクトリやブランチ名をniwatermへ知らせるようになる。

### 入れると使えるもの

- **サイドバーにブランチ名が出る** — Board名の下に`on main`のように出る。出るのはフォーカス中タイルのアクティブタブのブランチで、タブを切り替えると表示も切り替わる
- **新しいタブ・分割したタイルが今のディレクトリで開く** — タブ追加・タイル分割・`niwaterm tab new`/`tile split`（`--cwd`省略時）で、元のタブがいたディレクトリを引き継ぐ。入れていないとOS標準のディレクトリ（ホーム）で開く
- **Boardの名前がディレクトリ名で付く** — 名前を付けていないBoardの自動命名（[`board.naming`](/niwaterm/boards/#boardに自動で付く名前)）がカレントディレクトリを使う
- **[プロンプトジャンプ](/niwaterm/jump-and-copy/#プロンプトジャンプコマンド単位で遡る)が使える** — prefix + `shift+up` / `shift+down`、コピーモードの`{` / `}`で、コマンド単位でスクロールバックを遡れる
- **ターミナル内の相対パスをクリックで開ける**、**ホバーボタンの`show`・`items`でタブの`cwd`が読める**

### 導入する

使っているシェルの起動スクリプトに、次の1行を足す。`/path/to/niwaterm`はniwatermのリポジトリを置いた場所に読み替える。

```sh
# ~/.zshrc
[ -n "$NIWATERM_TAB_ID" ] && source /path/to/niwaterm/contrib/shell-integration/niwaterm.zsh
```

```sh
# ~/.bashrc
[ -n "$NIWATERM_TAB_ID" ] && source /path/to/niwaterm/contrib/shell-integration/niwaterm.bash
```

```fish
# ~/.config/fish/config.fish
test -n "$NIWATERM_TAB_ID"; and source /path/to/niwaterm/contrib/shell-integration/niwaterm.fish
```

```powershell
# $PROFILE
if ($env:NIWATERM_TAB_ID) { . C:\path\to\niwaterm\contrib\shell-integration\niwaterm.ps1 }
```

新しく開いたタブから有効になる。今開いているタブで試すなら、起動スクリプトを読み直す（`exec zsh`など）。

`NIWATERM_TAB_ID`はniwatermが開いたタブのシェルにだけ入る環境変数なので、他のターミナルでは何もしない。ブランチ名の通知には`niwaterm`コマンドを使うため、先に[CLIを使えるように](/niwaterm/getting-started/#cliを使えるようにする)しておく。WSLのディストロをタブで開く場合は、ディストロ側にもCLIとこの1行が要る。

starshipなど、ほかのプロンプトのカスタマイズと一緒に使っても問題ない。プロンプトの表示が遅くなることもない。

### シェルごとの対応

| シェル     | ブランチ名 | カレントディレクトリ | プロンプトの位置               |
| ---------- | ---------- | -------------------- | ------------------------------ |
| zsh        | ○          | ○                    | ○                              |
| bash       | ○          | ○                    | ○（3.2はプロンプトの開始だけ） |
| fish       | ○          | ○                    | ○                              |
| PowerShell | ○          | ×                    | ○                              |

PowerShellはカレントディレクトリを知らせないので、PowerShellのタブでは新しいタブ・タイルが今のディレクトリを引き継がず、Boardの自動命名も連番のままになる。

bash 3.2（macOS標準のbash）では、コマンドの実行開始を知らせるのに使う`PS0`が無い。プロンプトジャンプはできるが、コマンドの出力もプロンプトの続きとして扱われる。

### 更新と困ったとき

起動スクリプトはリポジトリ内のファイルを直接読むので、**niwatermを更新すればスクリプトも新しくなる**。ファイルをどこかへコピーして使っている場合は、コピーし直す。

サイドバーにブランチ名が出ないときは、そのタブで`niwaterm tab var list`を実行し、`branch`が入っているかを確かめる。入っていなければ、そのシェルから`niwaterm`コマンドを実行できるか（PATHが通っているか）を見る。スクリプトはエラーを表に出さないので、コマンドが見つからなくても何も表示されない。

## シェル補完

```sh
niwaterm complete zsh
```

補完スクリプトを標準出力へ書き出す。`bash` / `zsh` / `fish` / `powershell` を指定できる。設置先はシェルごとに違う。

```sh
# zsh: fpathの通ったディレクトリへ、先頭にアンダースコアを付けた名前で置く
mkdir -p ~/.zsh/completions
niwaterm complete zsh > ~/.zsh/completions/_niwaterm
# ~/.zshrcのcompinitより前に fpath=(~/.zsh/completions $fpath) を書く
```

置き先は書き込めるディレクトリを選ぶ。home-managerやdotfilesのシンボリックリンクで読み取り専用になっているディレクトリには置けない。

```sh
# bash: bash-completionが読むディレクトリへ置く（bash-completion本体の導入が前提）
mkdir -p ~/.local/share/bash-completion/completions
niwaterm complete bash > ~/.local/share/bash-completion/completions/niwaterm
```

```sh
# fish: 置くだけで読み込まれる
mkdir -p ~/.config/fish/completions
niwaterm complete fish > ~/.config/fish/completions/niwaterm.fish
```

```powershell
# PowerShell: プロファイルへ追記する
niwaterm complete powershell >> $PROFILE
```

コマンド名・オプション名に加えて、`--tab`に渡すタブIDのような**値**も補完される。タブ・タイル・BoardのIDの候補には、Board名・ワークスペース名が説明として添えられるので、IDを覚えていなくても選べる。アプリが起動していないときは、値の候補が出ないだけで、コマンド名・オプション名は補完される。

### 置き直しは要らない

補完スクリプトは、補完のたびにCLIへ候補を問い合わせる。そのため、niwatermを更新してコマンドやオプションが増えても、置き直す必要はない。

zshなら、シェルの起動時に「無ければ作る」形にしておくと、新しい環境でも置き忘れない。**`compinit`を呼ぶより前に書く**。後ろに書くと補完が登録されない。

```zsh
_niwaterm_comp="${XDG_CACHE_HOME:-$HOME/.cache}/zsh/completions/_niwaterm"
if [[ ! -f $_niwaterm_comp ]] && (( $+commands[niwaterm] )); then
  mkdir -p ${_niwaterm_comp:h}
  # niwatermは起動時に複数のタブのシェルを同時に立ち上げるので、一時ファイルはプロセスごとに分ける
  _niwaterm_tmp="$_niwaterm_comp.$$"
  if niwaterm complete zsh > $_niwaterm_tmp; then
    mv $_niwaterm_tmp $_niwaterm_comp
    # compinit -Cでdumpを使い回している場合に、新しい補完ファイルを拾わせる
    rm -f "${ZSH_CACHE_DIR:-$HOME/.cache/zsh}/zcompdump"
  else
    rm -f $_niwaterm_tmp
  fi
  unset _niwaterm_tmp
fi
fpath=(${_niwaterm_comp:h} $fpath)
```

### 補完されないとき

zshで`niwaterm boa`まで打ってTabを押しても何も起きないときは、`grep -c niwaterm ~/.cache/zsh/zcompdump`を実行する。0なら、`compinit`の時点で補完ファイルのディレクトリがfpathに入っていない。上のブロックを`compinit`より前へ移す。それでも0のままなら、`zcompdump`と`.zwc`ファイルを一度消してからシェルを起動し直す。
