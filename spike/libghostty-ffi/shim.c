// bun:ffi は構造体の値渡しをサポートしないため、
// 値渡しAPIをスカラー引数に展開する薄いラッパー。
#include <ghostty/vt.h>
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

int niwa_formatter_new(GhosttyFormatter *fmt, GhosttyTerminal term) {
  GhosttyFormatterTerminalOptions opts;
  memset(&opts, 0, sizeof(opts));
  opts.size = sizeof(opts);
  opts.emit = GHOSTTY_FORMATTER_FORMAT_PLAIN;
  opts.unwrap = true;
  opts.trim = true;
  return ghostty_formatter_terminal_new(NULL, fmt, term, opts);
}
