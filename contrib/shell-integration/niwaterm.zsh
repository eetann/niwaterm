# niwatermシェル統合（zsh）
# タブ内のシェルが自分のgitブランチ・カレントディレクトリをniwatermのサイドバーへ通知する。
# プロンプト表示のたびに`niwaterm set-var branch <branch>`相当を呼ぶ（値が変わった時のみ）。
# 導入: ~/.zshrcに以下を追記する
#   [ -n "$NIWATERM_TAB_ID" ] && source /path/to/niwaterm/contrib/shell-integration/niwaterm.zsh
#
# NIWATERM_TAB_IDはniwaterm内で起動したシェルにのみ自動設定される環境変数なので、
# niwaterm外のターミナル（この行を無条件でsourceした場合を含む）では何もしない。
if [[ -n "$NIWATERM_TAB_ID" ]] && (( $+commands[niwaterm] )); then
  typeset -g _NIWATERM_LAST_BRANCH=""

  _niwaterm_report_branch() {
    local branch
    branch="$(git branch --show-current 2>/dev/null)"
    # 前回送信した値と同じなら送らない（毎プロンプトでniwaterm CLIを起動するコストを避ける）
    if [[ "$branch" != "$_NIWATERM_LAST_BRANCH" ]]; then
      _NIWATERM_LAST_BRANCH="$branch"
      # &! でバックグラウンド実行かつ即disown。プロンプト表示をniwaterm CLI起動でブロックしない
      niwaterm set-var branch "$branch" >/dev/null 2>&1 &!
    fi
  }

  autoload -Uz add-zsh-hook
  add-zsh-hook precmd _niwaterm_report_branch

  # カレントディレクトリをOSC 7で通知する。libghostty-vtがネイティブにパースするため
  # niwaterm CLIのサブプロセス起動は不要（毎回送ってもコストはほぼゼロ）
  _niwaterm_report_pwd() { print -n '\e]7;kitty-shell-cwd://'"$HOST""$PWD"'\a'; }
  add-zsh-hook precmd _niwaterm_report_pwd
  _niwaterm_report_pwd
fi
