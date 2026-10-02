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

  # 次に履歴へ入るコマンドの番号。PS0の時点で履歴の末尾がこの番号なら、それが今から実行する
  # コマンドだと分かる（先頭が空白・直前と同じ等で履歴に残らなかったコマンドは末尾が1つ前のまま）
  _niwaterm_record_histno() { _NIWATERM_HISTNO=$HISTCMD; }

  # コマンド実行の開始（OSC 133のC）。実行するコマンド行を付ける（kittyの拡張cmdline_url）。
  # niwatermはアプリ終了時に実行中だったコマンドを覚えておき、設定のresume.allowに載っていれば
  # 次回起動時に打ち直す。区切りの;・エスケープの%・制御文字だけをパーセントエンコードする。
  # 履歴に残らなかったコマンドはコマンド行を送らない（先頭空白で履歴から外す慣習を尊重する）
  _niwaterm_mark_output() {
    local entry num cmd
    entry=$(HISTTIMEFORMAT= builtin history 1)
    entry=${entry#"${entry%%[![:space:]]*}"}
    num=${entry%%[[:space:]]*}
    # historyの出力は「番号・空白2つ・コマンド行」
    cmd=${entry#"$num  "}
    if [[ -z "$num" || "$num" != "$_NIWATERM_HISTNO" || -z "$cmd" || "$cmd" == ' '* ]]; then
      printf '\e]133;C\a'
      return
    fi
    cmd=${cmd//\%/%25}
    cmd=${cmd//;/%3B}
    cmd=${cmd//$'\n'/%0A}
    cmd=${cmd//$'\r'/%0D}
    cmd=${cmd//$'\e'/%1B}
    cmd=${cmd//$'\a'/%07}
    printf '\e]133;C;cmdline_url=%s\a' "$cmd"
  }

  # 既存のPROMPT_COMMANDを壊さないよう先頭に追加する（bash 3.2でも動く文字列連結形式）
  PROMPT_COMMAND="_niwaterm_mark_prompt;_niwaterm_record_histno;_niwaterm_report_branch;_niwaterm_report_pwd${PROMPT_COMMAND:+;$PROMPT_COMMAND}"
  # PS0はコマンドを読み取った直後・実行直前に展開されるため、他のツールと奪い合うDEBUGトラップを
  # 張らずに済む。展開時点で履歴には今のコマンドが入っている。PS0が無いbash 3.2では単に無視され、
  # コマンド出力の行がプロンプトの継続行として記録される（ジャンプ自体は動く）
  PS0='$(_niwaterm_mark_output)'"${PS0}"
  _niwaterm_report_pwd
fi
