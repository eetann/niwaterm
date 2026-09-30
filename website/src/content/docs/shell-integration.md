---
title: シェル統合と補完
description: ブランチ名・カレントディレクトリ・プロンプトの位置をniwatermへ知らせるシェル統合と、CLIのシェル補完の設置
---

シェルの起動スクリプトに1行足すと、niwatermがタブのブランチ名・カレントディレクトリ・プロンプトの位置を知れるようになる。あわせて、`niwaterm`コマンドのシェル補完の置き方もこのページにまとめる。

## シェル統合

`contrib/shell-integration/`配下のスクリプトをシェルの起動時にsourceすると、プロンプト表示のたびに現在のgitブランチをタブ変数`branch`へ自動反映する（`niwaterm tab var set branch <branch>`相当を内部で呼ぶ）。サイドバーのタブ行にブランチ名が表示されるようになる。zsh/bash/fish/PowerShellに対応している。

同スクリプトはカレントディレクトリもOSC 7（`kitty-shell-cwd://`スキーム）で通知し、タブ変数`cwd`へ自動反映する（`niwaterm tab var set`のCLI呼び出しは経由しない、ターミナルのネイティブ機能）。libghostty-vt（vt-only版）はURIを未パースのまま返す仕様のため、パスのデコードはniwaterm側（`src/bun/pwd-report.ts`）で行っている。ホスト名検証はしていない。ghostty本家はSSH越しの偽装対策としてホスト名を検証する。niwatermはWSLディストロをシェルプロファイルとして正式サポートしており、その場合シェル側とniwaterm本体側のホスト名は常に不一致になるため、意図的に検証を省いている。`niwaterm tile split`/`niwaterm tab new`で`--cwd`省略時、分割元・対象タイルのアクティブタブのこの値がデフォルトの作業ディレクトリとして使われる。Windows上のWSLプロファイルタブはWindows側から見えるUNC形式へ自動変換される（`src/bun/wsl-cwd.ts`）。**zsh/bash/fishはOSC 7送信に対応、PowerShell版シェル統合は現時点でブランチ通知のみ**。OSC 7自体はlibghostty-vt側に制約は無く、niwaterm.ps1へのOSC 7送信追加は今後の対応として残っている。

同スクリプトはプロンプトの位置もOSC 133（セマンティックプロンプト）で通知する。これもlibghostty-vtのネイティブ機能で、niwatermの[プロンプトジャンプ](/niwaterm/jump-and-copy/#プロンプトジャンプコマンド単位で遡る)（prefix + `shift+up` / `shift+down`、コピーモードの `{` / `}`）がこのマークを辿る。zsh/fishはプロンプト開始（A）とコマンド実行開始（C）の両方を、bashはPS0が使える4.4以降で両方（3.2ではAのみ）、PowerShellはPSReadLineの`PSConsoleHostReadLine`を包んで両方を送る。starship等が自前でOSC 133を出す環境で二重に送られても、同じ行に同じマークが付くだけで実害は無い。

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

`NIWATERM_TAB_ID`が無いシェル（niwaterm外のターミナル）では何もしない。PowerShell版は`prompt`関数を上書きするが、既存の`prompt`関数（他ツールのプロンプトカスタマイズ等）を保持して末尾で呼び直すため、他のプロンプト拡張と共存できる。

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
