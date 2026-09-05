---
type: Known Issue
title: "macOS: 端末から起動するとPTY内のfzf等（/dev/ttyを開くプログラム）が無反応になる"
description: Bun.TerminalはPTYを子プロセスの制御端末に設定しないため、niwatermを端末から起動すると子はアプリの起動元ttyを引き継ぎ、/dev/ttyを開くプログラム（fzf等）がSIGTTIN/SIGTTOUで停止する。切り分けの証拠と、ptyexecラッパーによる対応内容を記録する
---

# macOS: 端末から起動するとPTY内のfzf等（/dev/ttyを開くプログラム）が無反応になる

## 症状

niwatermのpopup（`popup open --capture-stdout`、`fzf-niwaterm`、`niwa.popup.run`）や通常タブでfzfを実行すると、**popup枠は開くのに中身が真っ白のまま何も表示されず、キー入力にも反応しない**。`popup close`しても中のプロセスは残り続け、試すたびに停止状態(`ps`のSTATが`T`)のfzfが積み上がる。

発生条件は**niwatermアプリ自体を「制御端末を持つ状態」で起動したかどうか**で決まる。

| アプリの起動方法 | アプリの制御端末 | popup内のfzf |
| --- | --- | --- |
| 端末から`mise run start`（tmux・niwatermのタブ等） | 起動元のtty | **固まる（無反応）** |
| 制御端末の無いシェルから起動（CI・エージェント経由等） | 無し | 動く |
| パッケージ版`.app`をFinder/Dockから起動 | 無し | 動く |

同じ症状は`sudo`・`gpg`・`ssh`のパスワードプロンプトなど、**`/dev/tty`を明示的に開くプログラム全般**で起きうる。Windowsは仕組みが異なる（ConPTY）ため対象外。

## 根本原因

`Bun.Terminal`（`Bun.spawn`の`terminal`オプション）は、子プロセスを**新しいプロセスグループにはするが、`setsid()` + `ioctl(TIOCSCTTY)`は行わない**。つまり**PTYが子プロセスの制御端末にならない**。

その結果、アプリが端末から起動されていると、PTY内の子プロセスは「標準入出力＝PTY、制御端末＝アプリの起動元tty」というちぐはぐな状態になる。fzfはUIの描画に`/dev/tty`（＝制御端末）を使うため、描画先がniwatermのPTYではなく**起動元の端末**になってしまう。さらに子は起動元ttyから見ればバックグラウンドプロセスグループなので、`/dev/tty`への読み書きで`SIGTTIN`/`SIGTTOU`を受けて停止する。これが「popupは空、プロセスは残る」の正体。

制御端末が無い状態でアプリを起動した場合は`/dev/tty`のオープン自体が失敗し、fzfが標準入力（＝PTY）へフォールバックするため、結果的に正常に動く。

## 切り分けの証拠

実機（macOS、アプリ同梱Bun 1.4.0 / システムBun 1.3.13）で確認した内容。

| 確認 | 結果 |
| --- | --- |
| アプリの制御端末（`ps -o tty=`） | `ttys035`（`mise run start`した端末） |
| popup内zsh・fzfの制御端末 | `ttys035`（＝**アプリのttyを引き継いでいる**） |
| fzfのfd 2（stderr） | `/dev/ttys060`（＝popupのPTY。標準入出力は正しくPTY） |
| fzfのfd 3/5 | `/dev/tty`（＝`ttys035`へ解決される） |
| fzf・zshのプロセス状態 | `T`（SIGTTIN/SIGTTOUで停止） |
| 最小再現（`Bun.Terminal`で子に`ps -o tty= -p $$`を実行させる） | 制御端末なしで起動すると`??`、ありで起動すると起動元tty。**どちらの場合もPTY自身にはならない** |
| 同梱Bun 1.4.0・システムBun 1.3.13の両方 | 同じ（Bunのバージョンでは解決しない） |

`Bun.Terminal`のAPIには制御端末に関するオプションが無い（`TerminalOptions`は`cols`/`rows`/`name`/`data`/`exit`/`drain`のみ）。

## 対応

**PTYの最初のプロセスとして薄いラッパー`niwaterm-ptyexec`（`src/native/ptyexec.c`）を挟み、`setsid()` + `ioctl(TIOCSCTTY)`で標準入力（＝PTYスレーブ）を制御端末に設定してから本来のシェルへ`exec`する**ようにした（`src/bun/pty.ts`の`withPtyExec`）。`mise run build:native`で`vendor/libghostty/lib/niwaterm-ptyexec`へ生成し、実行時は`findNativeArtifact`（`src/bun/native-artifacts.ts`）でrepoルート方向へ探索する。ラッパーが見つからない場合（`build:native`未実行）とWindows（ConPTY）はラップせず従来どおり起動する。

実機（macOS、`python3 -c "import pty; pty.spawn(['mise','run','start'])"`で制御端末を持たせて起動）で確認した結果:

| 確認 | 対応前 | 対応後 |
| --- | --- | --- |
| popup内zshの制御端末 | アプリの起動元tty | popup自身のPTY |
| popup内zshのプロセス状態 | `T`（SIGTTOU/SIGTTINで停止） | `Ss`（セッションリーダーとして正常動作） |
| popup内のfzf描画 | 何も出ない | 正常に描画・操作できる |
| popupを閉じた後 | fzfが停止状態で残り続ける | 残らない |

`prefix+w`（ghq選択→Board作成）まで含めて実機で通ることを確認済み。

## 検討した他の案

- **アプリ起動時に制御端末を切り離す**（`ioctl(TIOCNOTTY)`）: 実装は数行で済むが、子は制御端末なしのままなので`sudo`・`gpg`等`/dev/tty`必須のプログラムは動かない
- **起動スクリプト側で切り離す**（`mise run start`を新セッションで起動）: devモード限定の対処にとどまり、端末からCtrl+Cで止められなくなる

Bun側で`Bun.Terminal`がPTYを制御端末に設定するようになれば、このラッパーは不要になる。
