---
type: Known Issue
title: "WSLのドライブマウント(/mnt/c)配下はUNCパス越しに辿れず、cwdに渡すとspawnがENOENTになる"
description: WSLの9pサーバーが公開するのはディストロのルートファイルシステムだけで、DrvFsのマウント(/mnt/c)はその名前空間に現れない。Linux絶対パスを一律でUNC形式へ変換すると、Windows側のBun.spawnがcwdを解決できずホームディレクトリへフォールバックする
---

# WSLのドライブマウント(/mnt/c)配下はUNCパス越しに辿れず、cwdに渡すとspawnがENOENTになる

## 症状

WSL側のCLIから、Windowsのドライブ上（`/mnt/c/...`）にあるディレクトリを対象に
`niwaterm worktree new` / `worktree open` でBoardを開くと、**タブのcwdが指定したディレクトリではなく
ホームディレクトリになる**。エラーは出ず、シェルが普通に立ち上がるので気づきにくい。

WSLプロファイルのタブが`/mnt/c`配下にいる状態で新しいタブを開いた（タブ追加・タイル分割）ときも同じで、
cwdが引き継がれずホームになる。

`/home/...`のようにディストロのファイルシステム上にあるディレクトリでは起きない。

## 原因

WSLがWindows側へ公開する9pサーバー（`\\wsl.localhost\<distro>\...`）の名前空間には、
**DrvFsのマウント（`/mnt/c`等）が現れない**。そのため`\\wsl.localhost\<distro>\mnt\c\...`は
Windowsから辿れないパスになる。

niwatermはLinux絶対パスをWindows側から辿れる形式へ変換してから使う（CLI→アプリへ渡すとき、
タブが報告したcwdを別のタブへ引き継ぐとき）。ここで`/mnt/c`配下まで一律にUNC形式へ変換すると、
`Bun.spawn`のcwdが解決できずENOENTになる。PTY起動はspawnに失敗するとホームディレクトリへ
フォールバックするため、症状が「cwdがホームになる」という形で出る。

```
[bun] failed to spawn pty with cwd=\\wsl.localhost\NixOS\mnt\c\Users\eetann\...\repo@feat-a,
falling back to home directory: Error: ENOENT: no such file or directory, uv_spawn 'wsl.exe'
```

## 対処

`/mnt/<drive>/...`はWindows側のドライブそのものなので、UNCではなく**ドライブレター
（`C:\...`）へ戻す**。UNC形式への変換はその後に試す。

変換は2箇所にあり、**意図的に重複**している（CLIプロセスがWSL内で動いているかで判定する側と、
対象タブがwsl.exe系プロファイルで起動されたかで判定する側）。片方だけ直すと、
同じディレクトリがCLI側とアプリ側で別物として扱われる。

| ファイル | 関数 | 通る場面 |
| --- | --- | --- |
| `packages/cli/src/ipc-client.ts` | `toAppAccessiblePath` | CLIからアプリへディレクトリのパスを渡すとき・アプリが持つパスと突き合わせるとき |
| `src/bun/wsl-cwd.ts` | `resolveActualCwd` | タブがOSC 7で報告したcwdを新しいタブへ引き継ぐとき |

`/etc/wsl.conf`でマウント先を変えている環境（`/c`等）はこの変換に乗らない（`/mnt/`前提）。
その場合は従来どおりUNCへ変換され、同じ症状が残る。

## 関連

- [Windowsでのビルド・実行手順](/build/windows-build.md) — WSL→WindowsのIPC経路（TCPブリッジ）
- [WSLミラーモードでTCPブリッジがlistenできず、CLIが繋がらない](/known-issues/wsl-mirrored-mode-breaks-tcp-bridge.md) — 同じ経路で症状が出る別原因
