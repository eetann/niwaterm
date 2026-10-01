---
type: Known Issue
title: 10秒以上待つIPCリクエストが両側のタイムアウトで切られる
description: popup open --wait/--capture-stdoutのようにレスポンスを長時間待つIPCリクエストは、CLI側のAbortSignalとBun.serveの既定idleTimeoutという2つの10秒の壁に別々に引っかかる。fzf-niwaではこれがfzfの二重起動として現れる
---

# 10秒以上待つIPCリクエストが両側のタイムアウトで切られる

`niwa popup open --wait` / `--capture-stdout` は、ポップアップが閉じるまでレスポンスを返さない。
待ち時間の上限は利用者の操作次第（fzfで候補を選び終えるまで）でいくらでも伸びるが、
IPCのクライアント・サーバー双方に既定10秒の打ち切りがあるため、素直に書くと10秒で切られる。

## 症状

`fzf-niwa`（`popup open --capture-stdout`のラッパー）では、ポップアップ内のfzfを10秒以上
触っていると、選択結果が呼び出し元へ渡らず、代わりにポップアップを使わない通常のfzfが
起動する。ポップアップ側のfzfはまだ画面に残っているため、利用者からは
「候補を選んでポップアップが閉じた瞬間に、もう一度fzfが立ち上がった」ように見える。

`fzf-niwa`は`popup open`が失敗すると標準入力をローカルのfzfへ流すフォールバックを持つので、
CLIがタイムアウトで失敗した時点でその経路に入る。つまり二重起動は原因ではなく結果。

## 原因1: CLI側のAbortSignal

`packages/cli/src/ipc-client.ts`のIPCリクエストは、アプリ未起動時に無限に待たないよう
`AbortSignal.timeout()`を持つ。短時間で終わる操作にはこれで足りるが、待機系リクエストに
当てると「ポップアップは開いたままCLIだけが失敗する」状態になる。

**対応**: 待機系リクエストだけタイムアウトを外す。代わりに、投げる前にpingで疎通を確かめて
接続先ホストを1つに絞る（WSLのミラーモードでは、誰もlistenしていないポートへの接続が
接続拒否ではなく無応答になるため、タイムアウトを外したままだと候補ホストの1つ目で
永久に止まる。詳細: [wsl-mirrored-mode-breaks-tcp-bridge.md](./wsl-mirrored-mode-breaks-tcp-bridge.md)）。

## 原因2: Bun.serveの既定idleTimeout

`Bun.serve()`は既定で10秒のidleTimeoutを持つ。「idle」はコネクションにデータが流れていない
ことを指し、ハンドラが応答を保留している間もidle扱いになる。そのためCLI側のタイムアウトだけを
外しても、今度はサーバーがコネクションを切りに来る（クライアントには
`The socket connection was closed unexpectedly`として届く）。

**対応**: IPCサーバーの`Bun.serve()`に`idleTimeout: 0`を渡して無効化する。
`unix`側とWSLブリッジのTCP側の両方に必要。

## 切り分けのコツ

2つの壁がどちらも10秒なので、症状だけでは区別できない。エラー文言で見分ける。

- `TimeoutError: The operation timed out` → クライアント側のAbortSignal
- `The socket connection was closed unexpectedly` → サーバー側のidleTimeout
  （アプリのログには`Bun.serve() timed out a request after 10 seconds`も出る）

再現はGUI操作なしで確認できる。`niwa popup open --capture-stdout "sleep 25; echo ok"`を
実行し、25秒後に`ok`が返れば両方の壁を越えられている。
