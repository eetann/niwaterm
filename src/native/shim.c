// bun:ffi は構造体の値渡しをサポートしないため、
// 値渡しAPIをスカラー引数に展開する薄いラッパー。
// また、node-ptyがBun Worker内で動かないため、PTY機能もここで提供する。
#include <ghostty/vt.h>
#include <signal.h>
#include <stdlib.h>
#include <string.h>
#include <sys/ioctl.h>
#include <sys/wait.h>
#include <unistd.h>
#include <util.h>

int niwa_terminal_new(GhosttyTerminal *term, uint16_t cols, uint16_t rows,
                      size_t max_scrollback) {
  GhosttyTerminalOptions opts;
  memset(&opts, 0, sizeof(opts));
  opts.cols = cols;
  opts.rows = rows;
  opts.max_scrollback = max_scrollback;
  return ghostty_terminal_new(NULL, term, opts);
}

// PTYを開いてシェルをspawnする。戻り値はpid（負数はエラー）、*out_fd にmaster fd。
int niwa_pty_spawn(int *out_fd, uint16_t cols, uint16_t rows, const char *path,
                   const char *cwd, const char *term) {
  struct winsize ws;
  memset(&ws, 0, sizeof(ws));
  ws.ws_col = cols;
  ws.ws_row = rows;

  int master_fd = -1;
  pid_t pid = forkpty(&master_fd, NULL, NULL, &ws);
  if (pid < 0) return -1;
  if (pid == 0) {
    // 子プロセス: ログインシェルとして起動
    if (cwd != NULL && cwd[0] != '\0') chdir(cwd);
    if (term != NULL && term[0] != '\0') setenv("TERM", term, 1);
    char *argv[] = {(char *)path, "-il", NULL};
    execvp(path, argv);
    _exit(127);
  }
  *out_fd = master_fd;
  return (int)pid;
}

int niwa_pty_resize(int fd, uint16_t cols, uint16_t rows) {
  struct winsize ws;
  memset(&ws, 0, sizeof(ws));
  ws.ws_col = cols;
  ws.ws_row = rows;
  return ioctl(fd, TIOCSWINSZ, &ws);
}

// WNOHANGでexitを確認する。未終了なら-1、終了していればexit code(>=0)。
int niwa_pty_check_exit(int pid) {
  int status = 0;
  pid_t r = waitpid(pid, &status, WNOHANG);
  if (r != pid) return -1;
  if (WIFEXITED(status)) return WEXITSTATUS(status);
  if (WIFSIGNALED(status)) return 128 + WTERMSIG(status);
  return 0;
}

int niwa_pty_kill(int pid) { return kill(pid, SIGHUP); }

// emit: 0=plain, 1=vt, 2=html (GhosttyFormatterFormat)
int niwa_formatter_new(GhosttyFormatter *fmt, GhosttyTerminal term, int emit) {
  GhosttyFormatterTerminalOptions opts;
  memset(&opts, 0, sizeof(opts));
  opts.size = sizeof(opts);
  opts.emit = (GhosttyFormatterFormat)emit;
  opts.unwrap = false;
  opts.trim = false;
  return ghostty_formatter_terminal_new(NULL, fmt, term, opts);
}
