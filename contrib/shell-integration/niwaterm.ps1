# niwatermシェル統合（PowerShell）
#
# このファイルはUTF-8 BOM付きで保存する。Windows PowerShell 5.1はBOMの無い.ps1を
# OSのANSIコードページ（日本語環境ならCP932）として読むため、BOMを落とすと
# 日本語コメントが壊れてスクリプト全体がパースエラーになる。
# タブ内のシェルが自分のgitブランチをniwatermのサイドバーへ通知する。
# プロンプト表示のたびに`niwa tab var set branch <branch>`相当を呼ぶ（値が変わった時のみ）。
# 導入: $PROFILEに以下を追記する
#   if ($env:NIWATERM_TAB_ID) { . C:\path\to\niwaterm\contrib\shell-integration\niwaterm.ps1 }
#
# NIWATERM_TAB_IDはniwaterm内で起動したシェルにのみ自動設定される環境変数なので、
# niwaterm外のターミナル（この行を無条件でドットソースした場合を含む）では何もしない。
if ($env:NIWATERM_TAB_ID -and (Get-Command niwa -ErrorAction SilentlyContinue)) {
    $script:NiwatermLastBranch = $null
    # 既存のprompt関数を上書きしても壊さないよう、元の実装を保持して最後に呼ぶ
    $script:NiwatermOriginalPrompt = $function:prompt

    # OSC 133でプロンプトの位置をマークする（libghostty-vtがネイティブにパースする）。
    # niwatermのプロンプトジャンプ（prefix + shift+up/down、コピーモードの { }）がこのマークを辿る。
    # PowerShell 5.1でも動くよう、エスケープ文字は`eではなく[char]で組み立てる
    $script:NiwatermOscPromptStart = "$([char]27)]133;A$([char]7)"
    $script:NiwatermOscOutputStart = "$([char]27)]133;C$([char]7)"

    # コマンド実行の開始（OSC 133のC）。PowerShellにはpreexecに当たるフックが無いため、
    # PSReadLineが1行読み終えた直後を差し込み口にする。Cを出さないとコマンド出力の行まで
    # プロンプトの継続行として記録される
    $script:NiwatermOriginalReadLine = $function:PSConsoleHostReadLine
    if ($script:NiwatermOriginalReadLine) {
        function global:PSConsoleHostReadLine {
            $line = & $script:NiwatermOriginalReadLine
            [Console]::Write($script:NiwatermOscOutputStart)
            $line
        }
    }

    function global:prompt {
        [Console]::Write($script:NiwatermOscPromptStart)
        $branch = git branch --show-current 2>$null
        # 前回送信した値と同じなら送らない（毎プロンプトでniwaterm CLIを起動するコストを避ける）
        if ($branch -ne $script:NiwatermLastBranch) {
            $script:NiwatermLastBranch = $branch
            # Start-Processで非同期起動。プロンプト表示をniwaterm CLI起動でブロックしない
            Start-Process -FilePath "niwa" -ArgumentList @("tab", "var", "set", "branch", "$branch") `
                -WindowStyle Hidden -RedirectStandardOutput "NUL" -RedirectStandardError "NUL"
        }

        if ($script:NiwatermOriginalPrompt) {
            & $script:NiwatermOriginalPrompt
        } else {
            "PS $($executionContext.SessionState.Path.CurrentLocation)$('>' * ($nestedPromptLevel + 1)) "
        }
    }
}
