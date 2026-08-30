// PTY内の子プロセスへ「そのPTYを制御端末(controlling terminal)として持たせる」ためだけの
// 薄いラッパー。PTYの最初のプロセスとしてこれをexecし、本来のシェルへ引き継ぐ。
//
// なぜ必要か: Bun.Terminal（Bun.spawnのterminalオプション）は子プロセスを新しい
// プロセスグループにはするが、setsid() + ioctl(TIOCSCTTY)を行わないためPTYが子の制御端末に
// ならない。その結果、niwaterm本体を端末から起動していると、PTY内の子は
// 「標準入出力=PTY、制御端末=niwatermの起動元tty」というちぐはぐな状態になる。
// fzfのように/dev/tty（=制御端末）へUIを描くプログラムは起動元の端末へ描画しようとし、
// かつその端末から見てバックグラウンドプロセスグループなのでSIGTTIN/SIGTTOUで停止する。
// 詳細: docs/known-issues/macos-pty-child-controlling-terminal.md
//
// Windowsは仕組み自体が異なる（ConPTY）ため対象外。POSIX（macOS/Linux）専用。
#include <stdio.h>
#include <sys/ioctl.h>
#include <unistd.h>

int main(int argc, char **argv) {
  if (argc < 2) {
    fprintf(stderr, "usage: niwaterm-ptyexec <command> [args...]\n");
    return 2;
  }
  // 新しいセッションを作り、制御端末を持たない状態にする。既にプロセスグループリーダーだと
  // 失敗するが、その場合でも続けてTIOCSCTTYを試す価値はあるので戻り値は見ない
  setsid();
  // fd 0 はBun.Terminalが割り当てたPTYスレーブ。これを制御端末に設定する。
  // 失敗しても従来どおり（制御端末が無い/起動元のまま）起動はできるためexecへ進む
  ioctl(STDIN_FILENO, TIOCSCTTY, 0);
  execvp(argv[1], &argv[1]);
  // execvpが戻るのは失敗時のみ。PTYへエラーを出してから終了する
  perror(argv[1]);
  return 127;
}
