# niwatermシェル統合（fish）
# タブ内のシェルが自分のgitブランチ・カレントディレクトリをniwatermのサイドバーへ通知する。
# プロンプト表示のたびに`niwaterm set-var branch <branch>`相当を呼ぶ（値が変わった時のみ）。
# 導入: ~/.config/fish/config.fishに以下を追記する
#   test -n "$NIWATERM_TAB_ID"; and source /path/to/niwaterm/contrib/shell-integration/niwaterm.fish
#
# NIWATERM_TAB_IDはniwaterm内で起動したシェルにのみ自動設定される環境変数なので、
# niwaterm外のターミナル（この行を無条件でsourceした場合を含む）では何もしない。
if test -n "$NIWATERM_TAB_ID"; and type -q niwaterm
    set -g _niwaterm_last_branch ""

    function _niwaterm_report_branch --on-event fish_prompt
        set -l branch (git branch --show-current 2>/dev/null)
        # 前回送信した値と同じなら送らない（毎プロンプトでniwaterm CLIを起動するコストを避ける）
        if test "$branch" != "$_niwaterm_last_branch"
            set -g _niwaterm_last_branch "$branch"
            # バックグラウンド実行かつdisownでジョブ通知を出さない。プロンプト表示をniwaterm CLI起動でブロックしない
            niwaterm set-var branch "$branch" >/dev/null 2>&1 &
            disown
        end
    end

    # カレントディレクトリをOSC 7で通知する。libghostty-vtがネイティブにパースするため
    # niwaterm CLIのサブプロセス起動は不要。--on-variable PWDでcd時のみ発火する
    function _niwaterm_report_pwd --on-variable PWD
        printf '\e]7;kitty-shell-cwd://%s%s\a' (hostname) "$PWD"
    end
    _niwaterm_report_pwd
end
