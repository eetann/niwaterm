# niwatermシェル統合（fish）
# タブ内のシェルが自分のgitブランチ・カレントディレクトリをniwatermのサイドバーへ通知する。
# プロンプト表示のたびに`niwa tab var set branch <branch>`相当を呼ぶ（値が変わった時のみ）。
# 導入: ~/.config/fish/config.fishに以下を追記する
#   test -n "$NIWATERM_TAB_ID"; and source /path/to/niwaterm/contrib/shell-integration/niwaterm.fish
#
# NIWATERM_TAB_IDはniwaterm内で起動したシェルにのみ自動設定される環境変数なので、
# niwaterm外のターミナル（この行を無条件でsourceした場合を含む）では何もしない。
if test -n "$NIWATERM_TAB_ID"; and type -q niwa
    set -g _niwaterm_last_branch ""

    function _niwaterm_report_branch --on-event fish_prompt
        set -l branch (git branch --show-current 2>/dev/null)
        # 前回送信した値と同じなら送らない（毎プロンプトでniwaterm CLIを起動するコストを避ける）
        if test "$branch" != "$_niwaterm_last_branch"
            set -g _niwaterm_last_branch "$branch"
            # バックグラウンド実行かつdisownでジョブ通知を出さない。プロンプト表示をniwaterm CLI起動でブロックしない
            niwa tab var set branch "$branch" >/dev/null 2>&1 &
            disown
        end
    end

    # OSC 133でプロンプトの位置をマークする（libghostty-vtがネイティブにパースする）。
    # niwatermのプロンプトジャンプ（prefix + shift+up/down、コピーモードの { }）がこのマークを辿る。
    # Aがプロンプトの開始、Cがコマンド実行の開始。Cを出さないとコマンド出力の行まで
    # プロンプトの継続行として記録される。
    # 二重に出ても同じ行に同じマークが付くだけなので、fish本体や他ツールとの共存は問題にならない
    function _niwaterm_mark_prompt --on-event fish_prompt
        printf '\e]133;A\a'
    end
    function _niwaterm_mark_output --on-event fish_preexec
        printf '\e]133;C\a'
    end

    # カレントディレクトリをOSC 7で通知する。libghostty-vtがネイティブにパースするため
    # niwaterm CLIのサブプロセス起動は不要。--on-variable PWDでcd時のみ発火する
    function _niwaterm_report_pwd --on-variable PWD
        printf '\e]7;kitty-shell-cwd://%s%s\a' (hostname) "$PWD"
    end
    _niwaterm_report_pwd
end
