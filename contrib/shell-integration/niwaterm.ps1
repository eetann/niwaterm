# niwatermシェル統合（PowerShell）
# タイル内のシェルが自分のgitブランチをniwatermのサイドバーへ通知する。
# プロンプト表示のたびに`niwaterm set-var branch <branch>`相当を呼ぶ（値が変わった時のみ）。
# 導入: $PROFILEに以下を追記する
#   if ($env:NIWATERM_TILE_ID) { . C:\path\to\niwaterm\contrib\shell-integration\niwaterm.ps1 }
#
# NIWATERM_TILE_IDはniwaterm内で起動したシェルにのみ自動設定される環境変数なので、
# niwaterm外のターミナル（この行を無条件でドットソースした場合を含む）では何もしない。
if ($env:NIWATERM_TILE_ID -and (Get-Command niwaterm -ErrorAction SilentlyContinue)) {
    $script:NiwatermLastBranch = $null
    # 既存のprompt関数を上書きしても壊さないよう、元の実装を保持して最後に呼ぶ
    $script:NiwatermOriginalPrompt = $function:prompt

    function global:prompt {
        $branch = git branch --show-current 2>$null
        # 前回送信した値と同じなら送らない（毎プロンプトでniwaterm CLIを起動するコストを避ける）
        if ($branch -ne $script:NiwatermLastBranch) {
            $script:NiwatermLastBranch = $branch
            # Start-Processで非同期起動。プロンプト表示をniwaterm CLI起動でブロックしない
            Start-Process -FilePath "niwaterm" -ArgumentList @("set-var", "branch", "$branch") `
                -WindowStyle Hidden -RedirectStandardOutput "NUL" -RedirectStandardError "NUL"
        }

        if ($script:NiwatermOriginalPrompt) {
            & $script:NiwatermOriginalPrompt
        } else {
            "PS $($executionContext.SessionState.Path.CurrentLocation)$('>' * ($nestedPromptLevel + 1)) "
        }
    }
}
