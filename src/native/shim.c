// bun:ffi は構造体の値渡しをサポートしないため、
// 値渡しAPIをスカラー引数に展開する薄いラッパー（ghostty-vt関連）。
#include <ghostty/vt.h>
#include <stdlib.h>
#include <string.h>

// GhosttyFormatterTerminalOptions.selectionを省略（NULL）すると、
// アクティブエリアだけでなくスクロールバックを含む画面全体がフォーマットされてしまう
// （ヘッダーコメント: "If NULL, the entire screen is formatted"）。
// niwatermの.termはアクティブエリアだけを描画したいので、毎回アクティブエリアの
// 左上から右下までをselectionとして明示し、ghostty_terminal_selection_format_buf
// でダンプする。selectionはterminalの状態に対するスナップショット参照であり
// フォーマッタオブジェクトのように使い回せないため、呼び出しごとに作り直す。
//
// emit: 0=plain, 1=vt, 2=html (GhosttyFormatterFormat)
int niwa_dump_active(GhosttyTerminal term, int emit, uint8_t *buf, size_t buf_len,
                      size_t *out_written) {
  uint16_t cols = 0;
  uint16_t rows = 0;
  ghostty_terminal_get(term, GHOSTTY_TERMINAL_DATA_COLS, &cols);
  ghostty_terminal_get(term, GHOSTTY_TERMINAL_DATA_ROWS, &rows);

  GhosttyPoint p_start;
  memset(&p_start, 0, sizeof(p_start));
  p_start.tag = GHOSTTY_POINT_TAG_ACTIVE;
  p_start.value.coordinate.x = 0;
  p_start.value.coordinate.y = 0;

  GhosttyPoint p_end;
  memset(&p_end, 0, sizeof(p_end));
  p_end.tag = GHOSTTY_POINT_TAG_ACTIVE;
  p_end.value.coordinate.x = cols > 0 ? cols - 1 : 0;
  p_end.value.coordinate.y = rows > 0 ? rows - 1 : 0;

  GhosttyGridRef start;
  memset(&start, 0, sizeof(start));
  start.size = sizeof(start);
  GhosttyGridRef end;
  memset(&end, 0, sizeof(end));
  end.size = sizeof(end);

  GhosttyResult rc = ghostty_terminal_grid_ref(term, p_start, &start);
  if (rc != GHOSTTY_SUCCESS) return rc;
  rc = ghostty_terminal_grid_ref(term, p_end, &end);
  if (rc != GHOSTTY_SUCCESS) return rc;

  GhosttySelection sel;
  memset(&sel, 0, sizeof(sel));
  sel.size = sizeof(sel);
  sel.start = start;
  sel.end = end;
  sel.rectangle = false;

  GhosttyTerminalSelectionFormatOptions opts;
  memset(&opts, 0, sizeof(opts));
  opts.size = sizeof(opts);
  opts.emit = (GhosttyFormatterFormat)emit;
  opts.unwrap = false;
  opts.trim = false;
  opts.selection = &sel;

  return ghostty_terminal_selection_format_buf(term, opts, buf, buf_len, out_written);
}
