// bun:ffi は構造体の値渡しをサポートしないため、
// 値渡しAPIをスカラー引数に展開する薄いラッパー（ghostty-vt関連）。
#include <ghostty/vt.h>
#include <stdlib.h>
#include <string.h>

int niwa_terminal_new(GhosttyTerminal *term, uint16_t cols, uint16_t rows,
                      size_t max_scrollback) {
  GhosttyTerminalOptions opts;
  memset(&opts, 0, sizeof(opts));
  opts.cols = cols;
  opts.rows = rows;
  opts.max_scrollback = max_scrollback;
  return ghostty_terminal_new(NULL, term, opts);
}

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
