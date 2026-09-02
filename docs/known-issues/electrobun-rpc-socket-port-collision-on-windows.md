---
type: Known Issue
title: "ElectrobunのRPCソケットポート衝突でWindowsの後発インスタンスがターミナルを描画しない"
description: niwaterm-dailyを起動した状態でniwaterm-wipを起動すると、wip側のターミナルが1文字も描画されない。原因はElectrobunのwebview→bun RPCが127.0.0.1の固定レンジ(50000〜)のWebSocketを使い、Windowsでは既にlisten中のポートへの重複bindが成功してしまうため、後発アプリのwebviewが先発アプリのbunプロセスへ繋がること。ポートをずらす方向は原理的に効かず、ソケットを閉じてプロセス内のネイティブブリッジへ逃がすしかない
---

# ElectrobunのRPCソケットポート衝突でWindowsの後発インスタンスがターミナルを描画しない

## 症状

`niwaterm-daily`（普段遣いビルド）を起動した状態で`niwaterm-wip`（開発中ビルド）を起動すると、
wip側のウィンドウは開くが**ターミナルが1文字も描画されない**。サイドバーの枠だけが出て、
ワークスペース一覧もタイルもタブバーも表示されない。

アプリ自体は生きている。`niwaterm-dev ping`はpongを返し、`niwaterm-dev list`も
（永続化から復元した）ワークスペース・タイル・タブを正しく列挙する。にもかかわらず
`niwaterm-dev tab capture --tab <tabId>`は`tab not found`を返す。この
**「listには出るのにcaptureは404」**という食い違いが本問題の目印になる。

起動順を入れ替えれば症状も入れ替わる（**後から起動した方**が必ず壊れる）。
Windows実機でのみ発生し、macOSでは発生しない。

## 根本原因

Electrobunのwebview→bun方向のRPCは、webviewから
`ws://127.0.0.1:${HOST_SOCKET_PORT}/socket?webviewId=${WEBVIEW_ID}`へ張るWebSocketで運ばれる
（`api/browser/index.ts`の`Electroview.initSocketToHost`）。このポートはネイティブ層
（`ElectrobunCore.dll`）が**50000から上へ空きポートを探して**決め、preloadが
`window.__electrobunHostSocketPort`としてwebviewへ注入する。

ところがWindowsは、既にlisten中のアドレス:ポートに対する重複bindを（`SO_REUSEADDR`により）
**成功させてしまう**。そのため後発アプリのポート探索は50000から一歩も進まず、
「bindには成功したが接続は一切来ない死んだlistener」を掴んだまま、その番号をwebviewへ注入する。
webviewはその番号へ繋ぎに行き、OSは**先発アプリのlistener**へ接続を渡す。

Windows実機で採取した一次証拠（daily 06:09:54起動、wip 06:10:46起動）:

```
TCP  127.0.0.1:50000  0.0.0.0:0        LISTENING    26472   <- daily の bun
TCP  127.0.0.1:50000  0.0.0.0:0        LISTENING    37640   <- wip の bun（重複bindが成功している）
TCP  127.0.0.1:50000  127.0.0.1:52592  ESTABLISHED  26472   <- daily の bun が accept している
TCP  127.0.0.1:52592  127.0.0.1:50000  ESTABLISHED  15940   <- wip の WebView2 プロセス
```

`15940`はwipのWebView2（親は`28356` → その親がwipのbun `37640`）であり、
**wipのwebviewがdailyのbunへ繋がっている**ことがそのまま読み取れる。

macOSではlistenソケットの重複bindが`EADDRINUSE`で失敗するため、ポート探索が正しく
50001へ進む。[Hutchのelectrobunリリースロックがwip/dailyの同時devモード起動をブロックする](./hutch-electrobun-release-lock-blocks-concurrent-dev.md)の対策
（`HUTCH_HOME`分離）をmacOS実機でのみ検証していた時点では表面化しなかった。

## 描画されないところまでの連鎖

1. wipのwebviewが送る`ready`がdaily側のbunへ届き、`webviewId`が一致しないため捨てられる
2. wipのbunは`ready`を受け取れないので初回`render`を送らない
3. mainviewの`#tile-tree`が空のままで`.term`要素が生成されない
4. `.term`が無いのでResizeObserverが発火せず、`resize`メッセージがbunへ届かない
5. `board.ts`の`handleResize`が呼ばれず`pendingSpawnByTabId`が永久に消化されない
   → **PTYセッションが一度も起動しない**（正しいcols/rowsが判明してから起動する設計のため。
   [[TASK-0045]]・[[TASK-0047]]のSIGWINCH取りこぼし対策と同じく「サイズ確定待ち」がここでも効いている）
6. `board.ts`の`getTabText`が`sessions.get(tabId)`を引けず`null`を返す → `tab capture`が404

なお**bun→webview方向は壊れない**。こちらはネイティブ層がwebviewへスクリプト注入する
プロセス内経路のフォールバックを持つため、壊れた状態でも`niwaterm-dev font-size`のような
config更新はwebviewに反映される。「片方向だけ死んでいる」のが切り分けの決め手になる。

## 対策

**ポート番号をずらす方向は原理的に効かない**。外部から50000を占有して両者を50001へ押し出しても、
そこで同じ重複bindが起きるだけで、「先発が勝ち後発が死ぬ」構図はどの番号でも変わらない。
ポート探索のロジック自体は`ElectrobunCore.dll`（Zig製のプリビルドバイナリ。Hutchが
`~/.hutch-<variant>/releases/electrobun/<version>/<platform>/`へ展開する）の中にあり、
niwaterm側からは変更できない。環境変数での上書きも用意されていない。

そこで**ソケットを使わない経路へ逃がす**。`Electroview`はWebSocketが未接続のとき、
`window.__electrobunHostBridge`（Windowsでは`window.chrome.webview.hostObjects.hostBridge`）
というプロセス内のネイティブブリッジへ自動フォールバックする。`hostSocket`は
`Electroview`のpublicフィールドなので、外から`close()`すれば以降のsendは全てそちらへ回る。

`src/mainview/index.ts`の起動処理で、`ready`送信後に一定時間bunからの応答（`config`/`render`）が
無ければ`electroview.hostSocket?.close()`して`ready`を再送する。単独起動時は応答が即座に来て
タイマーが空振りするため、通常のWebSocket経路の性能には影響しない。

## 切り分け手順

Windows実機で同種の症状に当たったら、まずこれを確認する。

```bash
powershell.exe -NoProfile -Command "netstat -ano | Select-String ':50000'"
```

同じ`127.0.0.1:50000`に対して**LISTENINGが2行**出ていたら本問題。どちらのPIDがどのアプリかは
次で確認できる（`ESTABLISHED`の相手側PIDがWebView2プロセスなら、その親を辿って
どちらのアプリのwebviewかが分かる）。

```bash
powershell.exe -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { \$_.Name -match 'bun|msedgewebview2' } | Select-Object ProcessId,ParentProcessId,Name,ExecutablePath | Format-Table -AutoSize"
```
