---
type: Known Issue
title: "Hutchのelectrobunリリースロックがwip/dailyの同時devモード起動をブロックする"
description: electrobun devを2つのプロジェクトで同時に動かすと、後発側のビルドがpreBuildにすら到達せず無期限にスタックする。原因はHutchがユーザーのホーム配下に置く`~/.hutch/releases/electrobun/<version>/<platform>.lock`を、起動中のdevプロセスは共有ロックで保持し続ける一方、新しく起動する側は排他ロックで取りに行くため。project_rootやアプリ名の分離では回避できず、HUTCH_HOME自体を分ける必要がある
---

# Hutchのelectrobunリリースロックがwip/dailyの同時devモード起動をブロックする

## 症状

`niwaterm-wip`（開発中ビルド）と`niwaterm-daily`（普段遣いビルド）のどちらか一方を
`mise run start`（`electrobun dev`）で起動している状態で、もう一方を`mise run start`すると、
後から起動した側のビルドが**`preBuild`にすら到達せず**完全にスタックする。
ログには何も出力されず、`build/`配下も更新されない。

先発側のプロセスを停止すると、後発側は待たされていた分の遅延なく**即座に**ビルドを完走して起動する。

macOS・Windowsの両方で再現する（2026-08-30、macOS実機で一次証拠を取得）。

## 根本原因

Hutch（`electrobun dev`が内部で使うビルドツール、Zig実装）は、electrobun本体のネイティブ
アーティファクトが導入済みかを確認するために、`src/electrobun_artifacts.zig`の`ensure()`で
次のロックを取る。

```zig
const root = <hutch_home>/releases/electrobun/<version>/<platform>;
const lock_path = root ++ ".lock";
const lock = try release_store.acquirePersistentFileLock(init.io, lock_path); // ← 常に .exclusive・ブロッキング
defer lock.close(init.io);

const local_status = try localInstallationStatus(...);
if (local_status == .valid) return root; // 既に導入済みなら何もせず返る
```

`acquirePersistentFileLock`は`file_locks.openBlockingWithContention(..., .exclusive)`を呼ぶため、
**「もう入っているか確認するだけ」の処理でも必ず排他ロックを待つ**。

一方、起動中の`electrobun dev`プロセスは、同じファイルを`store_locks.acquireObjectLease`で
**共有ロック**として掴み続ける。`ObjectLease.makeInheritable`が`FD_CLOEXEC`を明示的に外すため、
このリースは子プロセスへも継承され、devプロセスが生きている限り解放されない。

結果として、**共有ロックを保持したままの先発プロセス vs 排他ロックを要求する後発プロセス**という
構図になり、後発は先発が死ぬまで`openat`で無期限にブロックされる。

ロックのパスは`<hutch_home>/releases/...`＝**ユーザーのホーム配下でグローバル**なので、
以下の対策はいずれもこの競合には効かない。

| 既に実施済みの分離                                    | 効かない理由                                          |
| ----------------------------------------------------- | ----------------------------------------------------- |
| project_rootの分離（git worktree、[[TASK-0056]]）    | ロックパスにproject_rootが含まれない                  |
| `buildFolder`のアプリ名別分離                         | 同上                                                  |
| `identifier`のアプリ名別分離（[[TASK-0057]]）        | 同上                                                  |
| `appSupportDir`・IPCソケットの分離                    | ランタイム側のリソース分離であり、ビルド側とは別レイヤー |

## 一次証拠（macOS実機、2026-08-30）

1. wipを`electrobun dev`で起動 → 正常に起動。
2. その状態でdailyを`mise run start` → **2分40秒待ってもログ1行のまま**、`build/`も更新されない。
3. スタック中のdaily側`hutch-engine`を`sample`で調べると、メインスレッドが`openat`で停止している。

   ```
   2629 main (in hutch-engine) + 32800
     2629 openat (in libsystem_kernel.dylib) + 76
       2629 __openat (in libsystem_kernel.dylib) + 8
   ```

4. `lsof`で保有ロックを比較すると、先発のwip側`hutch-engine`だけが
   `~/.hutch/releases/electrobun/2.0.1/macos-arm64.lock`を開いており、後発のdaily側は持っていない。
5. `flock(LOCK_SH|LOCK_NB)`／`flock(LOCK_EX|LOCK_NB)`で外部からプローブすると、当該ロックは
   **SHARED held**（共有で保持されている＝排他要求は待たされる）と判定される。
6. wip側の`hutch-engine`をkillした**瞬間**、daily側のビルドが一気に流れて起動が完了した。

## 対策

`HUTCH_HOME`環境変数でHutchのストア自体をアプリ名別に分ける。`mise.toml`の`start`タスクが
`$HOME/.hutch-wip` / `$HOME/.hutch-daily`を自動で設定するため、通常は意識する必要はない
（Windows実機向けには`win:start`タスクがPowerShell側の`$env:HUTCH_HOME`として明示的に渡す）。

`HUTCH_HOME`はHutch本体（`src/release_store.zig`の`resolveHutchHomeFromEnviron`）と
npmブートストラップ（`node_modules/electrobun/bin/resolve-hutch.cjs`）の両方が尊重する。

検証結果（macOS実機、2026-08-30）: dailyを`~/.hutch`、wipを`~/.hutch-wip`で起動したところ、
**両方がwatcher（ホットリロード）付きのまま同時に稼働**し、wip側の起動時間は4秒だった
（分離前は2分40秒待っても起動しない）。IPCソケットも両方が正常にlistenしている。

### 初回のセットアップ

新しい`HUTCH_HOME`は空なので、初回起動時にelectrobun・cottontail・bunツールチェーンの
ダウンロードが走る（約171MB）。既存のストアをコピーすれば省ける。

```bash
cp -R ~/.hutch ~/.hutch-wip    # 開発中ビルド用
cp -R ~/.hutch ~/.hutch-daily  # 普段遣いビルド用
```

`start`タスクは`HUTCH_HOME`が未作成のときにこの案内を表示する。

## 補足: 以前の「`graph.lock`が原因」という記録は誤り

[[TASK-0058]]では`~/.hutch/state/locks/graph.lock`をユーザー単位のグローバルロックとして
原因に挙げていたが、これは誤りだった。`graph.lock`は`store_locks.acquireGraph`が
**共有モード**でのみ取得しており（排他で取るのは`hutch reset`等の手動メンテナンスのみ）、
複数プロセスが同時に保持できる。当時の観察でこれを「LOCK HELD」と判定していたのは、
PowerShellの`[System.IO.File]::Open(..., 'None')`が**排他オープン**であり、
共有ロック保持中でも失敗するためで、ブロックの原因ではなく相関を見ていた。

## 上流への影響

Hutch側で「まず共有ロックで検証し、実際に書き込みが要るときだけ排他へ昇格する」形にすれば
根本解決するが、現状はniwaterm側から手が届かない。`blackboardsh/hutch`・`blackboardsh/electrobun`
いずれのGitHub issueにも該当する報告は見当たらない（[[TASK-0058]]の調査時点）。
