# niwatermシェル統合（zsh）
# タブ内のシェルが自分のgitブランチ・カレントディレクトリをniwatermのサイドバーへ通知する。
# プロンプト表示のたびに`niwa tab var set branch <branch>`相当を呼ぶ（値が変わった時のみ）。
# 導入: ~/.zshrcに以下を追記する
#   [ -n "$NIWATERM_TAB_ID" ] && source /path/to/niwaterm/contrib/shell-integration/niwaterm.zsh
#
# NIWATERM_TAB_IDはniwaterm内で起動したシェルにのみ自動設定される環境変数なので、
# niwaterm外のターミナル（この行を無条件でsourceした場合を含む）では何もしない。
if [[ -n "$NIWATERM_TAB_ID" ]] && (( $+commands[niwa] )); then
  typeset -g _NIWATERM_LAST_BRANCH=""

  _niwaterm_report_branch() {
    local branch
    branch="$(git branch --show-current 2>/dev/null)"
    # 前回送信した値と同じなら送らない（毎プロンプトでniwaterm CLIを起動するコストを避ける）
    if [[ "$branch" != "$_NIWATERM_LAST_BRANCH" ]]; then
      _NIWATERM_LAST_BRANCH="$branch"
      # &! でバックグラウンド実行かつ即disown。プロンプト表示をniwaterm CLI起動でブロックしない
      niwa tab var set branch "$branch" >/dev/null 2>&1 &!
    fi
  }

  autoload -Uz add-zsh-hook
  add-zsh-hook precmd _niwaterm_report_branch

  # OSC 133でプロンプトの位置をマークする（libghostty-vtがネイティブにパースする）。
  # niwatermのプロンプトジャンプ（prefix + shift+up/down、コピーモードの { }）がこのマークを辿る。
  # Aがプロンプトの開始、Cがコマンド実行の開始。Cを出さないとコマンド出力の行まで
  # プロンプトの継続行として記録される。
  # starship等が自前でOSC 133を出す環境で二重に出ても、同じ行に同じマークが付くだけで実害は無い
  _niwaterm_mark_prompt() { print -n '\e]133;A\a'; }
  _niwaterm_mark_output() { print -n '\e]133;C\a'; }
  add-zsh-hook precmd _niwaterm_mark_prompt
  add-zsh-hook preexec _niwaterm_mark_output

  # カレントディレクトリをOSC 7で通知する。libghostty-vtがネイティブにパースするため
  # niwaterm CLIのサブプロセス起動は不要（毎回送ってもコストはほぼゼロ）
  _niwaterm_report_pwd() { print -n '\e]7;kitty-shell-cwd://'"$HOST""$PWD"'\a'; }
  add-zsh-hook precmd _niwaterm_report_pwd
  _niwaterm_report_pwd
fi
