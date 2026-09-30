---
title: シェル統合と補完
description: ブランチ名・カレントディレクトリ・プロンプトの位置をniwatermへ知らせるシェル統合と、CLIのシェル補完の設置
---

シェルの起動スクリプトに1行足すと、niwatermがタブのブランチ名・カレントディレクトリ・プロンプトの位置を知れるようになる。あわせて、`niwaterm`コマンドのシェル補完の置き方もこのページにまとめる。

## シェル統合

niwatermはターミナルの画面に出た文字しか見ていないので、シェルが今どのディレクトリにいて、どこがプロンプトなのかは分からない。シェル統合のスクリプトを入れると、シェルがプロンプトを出すたびにそれをniwatermへ知らせるようになる。

### 入れると使えるもの

- **サイドバーにブランチ名が出る** — Board名の下に`on main`のように出る。出るのはフォーカス中タイルのアクティブタブのブランチで、タブを切り替えると表示も切り替わる
- **新しいタブ・分割したタイルが今のディレクトリで開く** — タブ追加・タイル分割・`niwaterm tab new`/`tile split`（`--cwd`省略時）で、元のタブがいたディレクトリを引き継ぐ。入れていないとOS標準のディレクトリ（ホーム）で開く
- **Boardの名前がディレクトリ名で付く** — 名前を付けていないBoardの自動命名（[`board.naming`](/niwaterm/boards/#自動命名boardnaming)）がカレントディレクトリを使う
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

PowerShell版は`prompt`関数を上書きするが、元の`prompt`関数を保持して最後に呼び直すので、他のプロンプトのカスタマイズとも共存できる。starshipのように自前でプロンプトの位置を知らせるツールと一緒に使っても、同じ行に同じ印が付くだけで困ることはない。

### シェルごとの対応

| シェル     | ブランチ名 | カレントディレクトリ | プロンプトの位置               |
| ---------- | ---------- | -------------------- | ------------------------------ |
| zsh        | ○          | ○                    | ○                              |
| bash       | ○          | ○                    | ○（3.2はプロンプトの開始だけ） |
| fish       | ○          | ○                    | ○                              |
| PowerShell | ○          | ×                    | ○                              |

PowerShellはカレントディレクトリを知らせないので、PowerShellのタブでは新しいタブ・タイルが今のディレクトリを引き継がず、Boardの自動命名も連番のままになる。

bash 3.2（macOS標準のbash）では、コマンドの実行開始を知らせるのに使う`PS0`が無い。プロンプトジャンプはできるが、コマンドの出力もプロンプトの続きとして扱われる。

### 仕組みと更新

ブランチ名は、プロンプトを出すたびに`git branch --show-current`を調べ、変わったときだけ`niwaterm tab var set branch <branch>`をバックグラウンドで呼んでタブ変数`branch`へ書き込む。プロンプトの表示は待たせない。カレントディレクトリとプロンプトの位置は、ターミナルのエスケープシーケンス（OSC 7・OSC 133）で画面への出力に混ぜて知らせるので、コマンドを起動しない。

カレントディレクトリの報告に付くホスト名は確かめていない。WSLのディストロのタブではシェル側とniwaterm側でホスト名が必ず食い違うため。報告されたディレクトリは新しいタブの開き先などに使うだけなので、SSH先のシェルが報告したパスが混ざっても、新しいタブがそのパスを開けずにホームディレクトリで開く程度で済む。

起動スクリプトからはリポジトリ内のファイルを直接読むので、**niwatermを更新すればスクリプトも新しくなる**。ファイルをどこかへコピーして使っている場合は、コピーし直す必要がある。

スクリプトは`niwaterm`コマンドの出力を捨てているので、コマンドが見つからない・名前が変わったといった失敗は表に出ない。サイドバーにブランチ名が出ないときは、そのタブで`niwaterm tab var list`を実行して`branch`が入っているかを確かめる。

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

置き先は書き込めるディレクトリを選ぶ。すでにfpathへ入れてあるディレクトリでも、home-manager・Nix・dotfilesのシンボリックリンクで読み取り専用の実体を指していることがあり、そこへは生成できない（`read-only file system`で失敗する）。

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

補完されるのはコマンド名・オプション名だけでなく、`--tab`に渡すtabIdのような**値**も含む。候補の取得元は3種類ある。

- **起動中のniwatermアプリ** — tabId・tileId・boardId・workspaceId・windowId、シェルプロファイルのid、レイアウトプリセット名、customViewのid、Boardのフェーズ。IDだけでは何を指すか分からないため、候補にはBoard名・ワークスペース名を説明として添える
- **補完を実行したディレクトリ** — gitワークツリー・gitリモート、`--cwd`のようなパスを取る引数
- **CLI自身** — `docs show`のドキュメント名、`--direction`のように取りうる値が決まっている引数

アプリが起動していないときはアプリ由来の候補が空になるだけで、コマンド名・オプション名の補完はそのまま効く。問い合わせの待ち時間には短い上限があり、応答が無ければ候補ゼロで打ち切る。

補完の対象になるコマンド名は、スクリプトを生成したときの呼び出し名になる。開発用の`niwaterm-dev`（`mise run cli:link`が張る別名）から生成すれば`niwaterm-dev`用のスクリプトが出て、候補の問い合わせ先もそちらの既定インスタンスになる。

### 置き直しが要るとき

スクリプトはコマンドの一覧を持たない（補完のたびにCLIへ問い合わせる）ので、**コマンドやオプションが増減しても中身は変わらず、置き直す必要は無い**。生成し直すのは補完スクリプト自体の作り方が変わったとき、つまり`@gunshi/plugin-completion`を更新したときだけ。

zshなら、シェルの起動時に「無ければ作る」形にしておくと設置を忘れずに済む。**置く位置は`compinit`を呼ぶ前**——既存の`fpath=(...)`を並べている場所の隣がよい。`compinit`はそれを呼んだ時点のfpathしか見ないため、後ろに置くと補完はいつまでも登録されない（`niwaterm boa`でタブキーを押しても何も起きない、という形で出る）。

```zsh
# 生成物なので、dotfilesの配下ではなく書き込めるキャッシュへ置く
_niwaterm_comp="${XDG_CACHE_HOME:-$HOME/.cache}/zsh/completions/_niwaterm"
if [[ ! -f $_niwaterm_comp ]] && (( $+commands[niwaterm] )); then
  mkdir -p ${_niwaterm_comp:h}
  # 一時ファイルはプロセスごとに分ける。niwatermは起動時に複数のタブのシェルを
  # 同時に立ち上げるため、固定名だと先にmvした1つ以外が"cannot stat"で落ちる。
  # 生成に失敗したときに中途半端なファイルを残さない意味もある
  # （compinitがそれを読むと補完が壊れる）
  _niwaterm_tmp="$_niwaterm_comp.$$"
  if niwaterm complete zsh > $_niwaterm_tmp; then
    mv $_niwaterm_tmp $_niwaterm_comp
    # compinitのdumpを使い回す構成（compinit -C）はfpathを再スキャンしないため、
    # 新しく置いた補完ファイルが拾われるようdumpも捨てる
    rm -f "${ZSH_CACHE_DIR:-$HOME/.cache/zsh}/zcompdump"
  else
    rm -f $_niwaterm_tmp
  fi
  unset _niwaterm_tmp
fi
fpath=(${_niwaterm_comp:h} $fpath)
```

補完が効いているかは`compinit`のdumpを見ると分かる。`grep -c niwaterm ~/.cache/zsh/zcompdump`が0なら、`compinit`の時点でfpathに入っていない。置き場所や順序を直してもまだ0のままなら、補完ファイルが既にあるせいで上のブロックごと飛ばされ、dumpが捨てられていない。dumpと`.zwc`を一度消せば次の起動で拾われる。

生成のたびにバージョンを調べて作り直す（`mise activate`のキャッシュのような）作りにする必要は無い。中身がバージョンに依らないうえ、判定のために`niwaterm --version`を呼ぶ時間が生成そのものと変わらないため。
