// bun:ffi は構造体の値渡しをサポートしないため、
// 値渡しAPIをスカラー引数に展開する薄いラッパー（ghostty-vt関連）。
#include <ghostty/vt.h>
#include <stdlib.h>
#include <string.h>

// GhosttyFormatterTerminalOptions.selectionを省略（NULL）すると、
// アクティブエリアだけでなくスクロールバックを含む画面全体がフォーマットされてしまう
// （ヘッダーコメント: "If NULL, the entire screen is formatted"）。
// niwatermの.termは可視範囲だけを描画したいので、毎回その範囲の
// 左上から右下までをselectionとして明示し、ghostty_terminal_selection_format_buf
// でダンプする。selectionはterminalの状態に対するスナップショット参照であり
// フォーマッタオブジェクトのように使い回せないため、呼び出しごとに作り直す。
//
// emit: 0=plain, 1=vt, 2=html (GhosttyFormatterFormat)
// use_viewport: 0=アクティブエリア（スクロールバック無視・常に最新）,
//               1=ビューポート（ghostty_terminal_scroll_viewportでスクロールした位置に追従）
int niwa_dump_screen(GhosttyTerminal term, int emit, int use_viewport, uint8_t *buf,
                      size_t buf_len, size_t *out_written) {
  uint16_t cols = 0;
  uint16_t rows = 0;
  ghostty_terminal_get(term, GHOSTTY_TERMINAL_DATA_COLS, &cols);
  ghostty_terminal_get(term, GHOSTTY_TERMINAL_DATA_ROWS, &rows);

  GhosttyPointTag tag = use_viewport ? GHOSTTY_POINT_TAG_VIEWPORT : GHOSTTY_POINT_TAG_ACTIVE;

  GhosttyPoint p_start;
  memset(&p_start, 0, sizeof(p_start));
  p_start.tag = tag;
  p_start.value.coordinate.x = 0;
  p_start.value.coordinate.y = 0;

  GhosttyPoint p_end;
  memset(&p_end, 0, sizeof(p_end));
  p_end.tag = tag;
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

// ghostty_terminal_scroll_viewportもGhosttyTerminalScrollViewportを値渡しするため、
// tag+valueをスカラー引数に展開してshim側で組み立てる。
// tag: GhosttyTerminalScrollViewportTag (0=TOP, 1=BOTTOM, 2=DELTA, 3=ROW)
// value: DELTAならintptr_tの相対行数（上がマイナス）、ROWならsize_tの絶対行オフセット。
//        TOP/BOTTOMでは無視される
void niwa_scroll_viewport(GhosttyTerminal term, int32_t tag, int64_t value) {
  GhosttyTerminalScrollViewport behavior;
  memset(&behavior, 0, sizeof(behavior));
  behavior.tag = (GhosttyTerminalScrollViewportTag)tag;
  if (tag == GHOSTTY_SCROLL_VIEWPORT_DELTA) {
    behavior.value.delta = (intptr_t)value;
  } else if (tag == GHOSTTY_SCROLL_VIEWPORT_ROW) {
    behavior.value.row = (size_t)value;
  }
  ghostty_terminal_scroll_viewport(term, behavior);
}
