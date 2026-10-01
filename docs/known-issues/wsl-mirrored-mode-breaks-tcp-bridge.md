---
type: Known Issue
title: "WSLミラーモードでTCPブリッジがlistenできず、CLIが繋がらない"
description: WSL2をミラーモード(networkingMode=mirrored)で使うと、WSL側のエフェメラルポート範囲がWindowsホスト側でも予約され、その範囲のポートはWindowsでbindするとEADDRINUSEになる。netstatにもnetshのexcludedportrangeにも現れないため原因が掴みにくい。加えてミラーモードではWSL用仮想アダプタのIPへ到達できず、WSLからWindowsホストへはループバック経由で届く
---

# WSLミラーモードでTCPブリッジがlistenできず、CLIが繋がらない

WSLディストロのタブから`niwa`コマンドを実行すると、Windows側アプリが正常に起動しているのに
すべてのサブコマンドが接続エラーになる。

```
layout applyに失敗しました: WSLからWindows側niwatermアプリ(...)へ接続できませんでした。
```

WSL→WindowsのIPC経路（TCPブリッジ）の仕組み自体は
[Windows実機ビルド手順](/build/windows-build.md)の「6-2. WSL→WindowsはTCPブリッジ経由で接続する」を参照。
ここでは、その経路がミラーモード（`%USERPROFILE%\.wslconfig`の`networkingMode=mirrored`）で
壊れる2つの理由を記録する。**症状が「アプリは動いているのにCLIだけ全滅」なら、まずこれを疑う。**

## 1. WSLのエフェメラルポート範囲がWindows側でも予約される

ミラーモードではWSL VMとWindowsホストがネットワークスタックを共有するため、
**WSL側のエフェメラルポート範囲（`/proc/sys/net/ipv4/ip_local_port_range`）に含まれるポートは、
Windows側でbindしようとするとEADDRINUSEで失敗する**。誰もlistenしていなくても失敗する。

この予約はWindows側からは見えない。`netstat -ano`にも
`netsh interface ipv4 show excludedportrange protocol=tcp`にも現れないため、
「ポートは空いているのにbindだけできない」という状態になり原因を掴みにくい。

エフェメラルポート範囲はディストロ・カーネル設定によって変わる（Linux既定は32768-60999だが、
WSLでは44620-48715のような別の範囲になることがある）。**特定のポート番号を選び直しても
根本解決にはならない**——範囲自体が環境によって動くため。

niwatermがブリッジのポートを固定していないのはこのためでもある。OSに割り当てさせれば
予約済みの範囲は最初から選ばれないので、この問題も他アプリとのポート衝突も原理的に起きない。
実際のポート番号はUnix domain socketと同じディレクトリの`bridge-port`ファイルでCLIに伝える。

なお、ブリッジのbind失敗はIPCサーバー本体を巻き込まないようbest effortで無視する設計だが、
無言で握り潰すとこの状況をアプリ側から観測できないため、成否をアプリのログに出している。
**アプリ起動ログに`[bun] wsl bridge listening on ...`が出ているか**が最初の切り分けになる。

## 2. ミラーモードではWSL用仮想アダプタのIPへ到達できない

NATモード（WSL2の既定）では、WSLのデフォルトゲートウェイ＝Windowsホスト側の
`vEthernet (WSL)`アダプタのIPであり、そこへ接続すればWindowsホストに届く。

ミラーモードではこれが成り立たない。

- WSLのデフォルトゲートウェイは**実LANのルータ**になる（Windowsホストではない）
- `vEthernet (WSL)`アダプタはWindows側に残っているが、WSLからそのIPへ接続してもタイムアウトする
- 代わりに、WSLからWindowsホストのlistenへは**ループバック(`127.0.0.1`)で届く**

どちらのモードで動いているかを同期的に確実に判定する手段がないため、niwatermは
**listen側は両方のアドレスでlistenし、接続側は両方を順に試す**（繋がらない側は即座に
接続拒否になるため実用上の遅延はない）。

## 切り分け手順

WSL側から、Windows側のbunで実際にbindを試すのが最も速い。

```sh
# Windows側でbindできるポート範囲を調べる（WSLから実行）
cat > /mnt/c/Users/<user>/bindtest.js <<'EOF'
const net = require("node:net");
for (const p of [40000, 45000, 47000, 49000]) {  // 調べたい範囲に置き換える
  const s = net.createServer();
  s.once("error", (e) => console.log("FAIL", p, e.code));
  s.listen(p, "127.0.0.1", () => { console.log("OK", p); s.close(); });
}
EOF
powershell.exe -NoProfile -Command "& '<bun.exeのパス>' 'C:\Users\<user>\bindtest.js'"

# WSL側のエフェメラルポート範囲（この範囲と重なるポートはWindows側でbindできない）
cat /proc/sys/net/ipv4/ip_local_port_range
```

`Get-NetTCPConnection`や`netstat`で「空いている」ように見えても、上のbindテストがEADDRINUSEを
返すならエフェメラルポート範囲との衝突である。
