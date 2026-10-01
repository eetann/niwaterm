# niwatermシェル統合（bash）
# タブ内のシェルが自分のgitブランチ・カレントディレクトリをniwatermのサイドバーへ通知する。
# プロンプト表示のたびに`niwa tab var set branch <branch>`相当を呼ぶ（値が変わった時のみ）。
# 導入: ~/.bashrcに以下を追記する
#   [ -n "$NIWATERM_TAB_ID" ] && source /path/to/niwaterm/contrib/shell-integration/niwaterm.bash
#
# NIWATERM_TAB_IDはniwaterm内で起動したシェルにのみ自動設定される環境変数なので、
# niwaterm外のターミナル（この行を無条件でsourceした場合を含む）では何もしない。
if [[ -n "$NIWATERM_TAB_ID" ]] && command -v niwa >/dev/null 2>&1; then
  _NIWATERM_LAST_BRANCH=""

  _niwaterm_report_branch() {
    local branch
    branch="$(git branch --show-current 2>/dev/null)"
    # 前回送信した値と同じなら送らない（毎プロンプトでniwaterm CLIを起動するコストを避ける）
    if [[ "$branch" != "$_NIWATERM_LAST_BRANCH" ]]; then
      _NIWATERM_LAST_BRANCH="$branch"
      # バックグラウンド実行かつdisownでジョブ通知を出さない。プロンプト表示をniwaterm CLI起動でブロックしない
      niwa tab var set branch "$branch" >/dev/null 2>&1 &
      disown
    fi
  }

  # カレントディレクトリをOSC 7で通知する。libghostty-vtがネイティブにパースするため
  # niwaterm CLIのサブプロセス起動は不要（毎回送ってもコストはほぼゼロ）
  _niwaterm_report_pwd() { printf '\e]7;kitty-shell-cwd://%s%s\a' "$HOSTNAME" "$PWD"; }

  # OSC 133でプロンプトの位置をマークする（libghostty-vtがネイティブにパースする）。
  # niwatermのプロンプトジャンプ（prefix + shift+up/down、コピーモードの { }）がこのマークを辿る。
  # starship等が自前でOSC 133を出す環境で二重に出ても、同じ行に同じマークが付くだけで実害は無い
  _niwaterm_mark_prompt() { printf '\e]133;A\a'; }

  # 既存のPROMPT_COMMANDを壊さないよう先頭に追加する（bash 3.2でも動く文字列連結形式）
  PROMPT_COMMAND="_niwaterm_mark_prompt;_niwaterm_report_branch;_niwaterm_report_pwd${PROMPT_COMMAND:+;$PROMPT_COMMAND}"
  # コマンド実行の開始（OSC 133のC）。PS0はコマンドを読み取った直後・実行直前に展開されるため、
  # 他のツールと奪い合うDEBUGトラップを張らずに済む。PS0が無いbash 3.2では単に無視され、
  # コマンド出力の行がプロンプトの継続行として記録される（ジャンプ自体は動く）
  PS0='\e]133;C\a'"${PS0}"
  _niwaterm_report_pwd
fi
