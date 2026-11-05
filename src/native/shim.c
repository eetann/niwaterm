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
// bun:ffiはmacOS(arm64)で引数が10個以上ある関数を正しく呼べない（9個までは正常。
// 10個目以降がゴミ値になったりセグフォで落ちる。詳細:
// docs/known-issues/bun-ffi-breaks-with-ten-or-more-args.md）。
// niwa_dump_selectionは指定項目が多いため、引数を並べるのではなく
// int32を並べただけの構造体をポインタで受け取る。
// JS側はInt32Arrayをそのまま渡せばよく、パディングも生じない
typedef struct {
  /** GhosttyFormatterFormat (0=plain, 1=vt, 2=html) */
  int32_t emit;
  /** GhosttyPointTag (0=ACTIVE, 1=VIEWPORT, 2=SCREEN, 3=HISTORY) */
  int32_t tag;
  int32_t start_x;
  int32_t start_y;
  int32_t end_x;
  int32_t end_y;
  /** 矩形選択にするか */
  int32_t rectangle;
  /** 折り返された行を1行に連結するか */
  int32_t unwrap;
  /** 行末の空白を落とすか */
  int32_t trim;
} NiwaDumpSelectionOptions;

int niwa_dump_selection(GhosttyTerminal term, const NiwaDumpSelectionOptions *o, uint8_t *buf,
                        size_t buf_len, size_t *out_written) {
  GhosttyPoint p_start;
  memset(&p_start, 0, sizeof(p_start));
  p_start.tag = (GhosttyPointTag)o->tag;
  p_start.value.coordinate.x = (uint16_t)o->start_x;
  p_start.value.coordinate.y = (uint32_t)o->start_y;

  GhosttyPoint p_end;
  memset(&p_end, 0, sizeof(p_end));
  p_end.tag = (GhosttyPointTag)o->tag;
  p_end.value.coordinate.x = (uint16_t)o->end_x;
  p_end.value.coordinate.y = (uint32_t)o->end_y;

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
  sel.rectangle = o->rectangle != 0;

  GhosttyTerminalSelectionFormatOptions opts;
  memset(&opts, 0, sizeof(opts));
  opts.size = sizeof(opts);
  opts.emit = (GhosttyFormatterFormat)o->emit;
  opts.unwrap = o->unwrap != 0;
  opts.trim = o->trim != 0;
  opts.selection = &sel;

  return ghostty_terminal_selection_format_buf(term, opts, buf, buf_len, out_written);
}

// 画面（アクティブエリアまたはビューポート）全体をダンプする。
// use_viewport: 0=アクティブエリア（スクロールバック無視・常に最新）,
//               1=ビューポート（ghostty_terminal_scroll_viewportでスクロールした位置に追従）
int niwa_dump_screen(GhosttyTerminal term, int emit, int use_viewport, uint8_t *buf,
                      size_t buf_len, size_t *out_written) {
  uint16_t cols = 0;
  uint16_t rows = 0;
  ghostty_terminal_get(term, GHOSTTY_TERMINAL_DATA_COLS, &cols);
  ghostty_terminal_get(term, GHOSTTY_TERMINAL_DATA_ROWS, &rows);

  NiwaDumpSelectionOptions opts;
  memset(&opts, 0, sizeof(opts));
  opts.emit = emit;
  opts.tag = use_viewport ? GHOSTTY_POINT_TAG_VIEWPORT : GHOSTTY_POINT_TAG_ACTIVE;
  opts.end_x = cols > 0 ? cols - 1 : 0;
  opts.end_y = rows > 0 ? rows - 1 : 0;
  return niwa_dump_selection(term, &opts, buf, buf_len, out_written);
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

// GhosttyMousePosition（float x, y）の値渡しをスカラー引数へ展開する。
// マウスイベントの位置はターミナル描画領域の左上を原点とするピクセル座標で、
// 負値・領域外の値も許容される（libghostty-vt側がビューポート外判定に使う）。
void niwa_mouse_event_set_position(GhosttyMouseEvent event, float x, float y) {
  GhosttyMousePosition pos;
  pos.x = x;
  pos.y = y;
  ghostty_mouse_event_set_position(event, pos);
}

// プロンプトブロックの高さの上限。これを超えて継続行が続く場合、シェルが
// OSC 133のC（コマンド実行の開始）を出しておらず出力行まで継続行として
// 記録されているとみなし、コマンド行の推定をあきらめてブロック先頭へ戻す
#define NIWA_MAX_PROMPT_BLOCK_ROWS 8

// niwa_find_promptの結果。bun:ffiは構造体を返せないためint32を並べた領域へ書き込む
// （JS側はInt32Arrayをそのまま渡せばよい）
typedef struct {
  /** OSC 133のAでマークされた行。プロンプトブロックの先頭で、画面座標 */
  int32_t prompt_row;
  /** コマンドを打った行（プロンプトブロックの最終行）。単一行プロンプトならprompt_rowと同じ */
  int32_t input_row;
} NiwaPromptLocation;

// 画面座標yの行を引く。解決できなければ0以外を返す
static int niwa_row_at(GhosttyTerminal term, int64_t y, GhosttyGridRef *out_ref,
                       GhosttyRow *out_row) {
  GhosttyPoint point;
  memset(&point, 0, sizeof(point));
  point.tag = GHOSTTY_POINT_TAG_SCREEN;
  point.value.coordinate.x = 0;
  point.value.coordinate.y = (uint32_t)y;

  memset(out_ref, 0, sizeof(*out_ref));
  out_ref->size = sizeof(*out_ref);
  if (ghostty_terminal_grid_ref(term, point, out_ref) != GHOSTTY_SUCCESS) return 1;
  return ghostty_grid_ref_row(out_ref, out_row) != GHOSTTY_SUCCESS;
}

static GhosttyRowSemanticPrompt niwa_row_semantic(GhosttyRow row) {
  GhosttyRowSemanticPrompt semantic = GHOSTTY_ROW_SEMANTIC_NONE;
  if (ghostty_row_get(row, GHOSTTY_ROW_DATA_SEMANTIC_PROMPT, &semantic) != GHOSTTY_SUCCESS) {
    return GHOSTTY_ROW_SEMANTIC_NONE;
  }
  return semantic;
}

// OSC 133でプロンプトの先頭行としてマークされた行を、画面座標のfrom_yから
// direction方向（-1=上へ、1=下へ）に探す。見つかればoutを埋めてGHOSTTY_SUCCESSを返し、
// last_yまで走査して見つからなければGHOSTTY_NO_VALUEを返す。
// from_y自身も走査対象に含めるかは呼び出し側が起点をずらして決める。
//
// 複数行プロンプト・折り返したプロンプトの2行目以降は
// GHOSTTY_ROW_SEMANTIC_PROMPT_CONTINUATIONになるため、GHOSTTY_ROW_SEMANTIC_PROMPTだけを
// 拾えば1プロンプトにつき1回だけ止まる。
//
// 1行ずつJSから呼ぶとスクロールバック1万行で1万回のFFI往復になるうえ、
// grid_refの解決はヘッダーのコメント通り軽くないため、走査はC側で回して最初の一致で打ち切る。
int niwa_find_prompt(GhosttyTerminal term, uint32_t from_y, int32_t direction, uint32_t last_y,
                     NiwaPromptLocation *out) {
  if (direction == 0) return GHOSTTY_INVALID_VALUE;
  int32_t step = direction > 0 ? 1 : -1;

  for (int64_t y = (int64_t)from_y;; y += step) {
    if (step > 0 ? y > (int64_t)last_y : y < (int64_t)last_y) break;
    if (y < 0) break;

    GhosttyGridRef ref;
    GhosttyRow row;
    // スクロールバックの外へ流れた行など、解決できない行は飛ばさず打ち切る
    // （その先も解決できないため）
    if (niwa_row_at(term, y, &ref, &row) != 0) break;
    if (niwa_row_semantic(row) != GHOSTTY_ROW_SEMANTIC_PROMPT) continue;

    // プロンプトが複数行のとき、マークが付くのは1行目（powerlevel10kならコマンドの2行上の
    // 区切り行）。コマンドを打った行はブロックの最終行なので、継続行を下へ辿って行き着く
    int64_t input_row = y;
    for (int64_t next = y + 1; next - y <= NIWA_MAX_PROMPT_BLOCK_ROWS; next++) {
      GhosttyGridRef next_ref;
      GhosttyRow next_row;
      if (niwa_row_at(term, next, &next_ref, &next_row) != 0) break;
      if (niwa_row_semantic(next_row) != GHOSTTY_ROW_SEMANTIC_PROMPT_CONTINUATION) break;
      input_row = next;
    }
    if (input_row - y >= NIWA_MAX_PROMPT_BLOCK_ROWS) input_row = y;

    out->prompt_row = (int32_t)y;
    out->input_row = (int32_t)input_row;
    return GHOSTTY_SUCCESS;
  }

  return GHOSTTY_NO_VALUE;
}

// GhosttyStringの値を組み立てて検索文字列へ渡す。lenが0なら検索を止める（NULL扱い）
int niwa_search_set_needle(GhosttySearch search, const uint8_t *needle, size_t len) {
  if (len == 0) return ghostty_search_set(search, GHOSTTY_SEARCH_OPT_NEEDLE, NULL);
  GhosttyString value = {needle, len};
  return ghostty_search_set(search, GHOSTTY_SEARCH_OPT_NEEDLE, &value);
}

// niwa_search_matchesの結果1件。画面座標で、桁は両端とも含む
typedef struct {
  int32_t start_x;
  int32_t start_y;
  int32_t end_x;
  int32_t end_y;
} NiwaSearchMatch;

// 検索を端末の現状へ追いつかせ、一致を画面座標へ変換してoutへ書き込む。
// viewport_onlyが0ならスクロールバック全体を最後まで走査し（ghostty_search_run）、
// 0以外ならビューポートに掛かる一致だけを1回分のfeedで集める（描画のたびに呼ぶハイライト用）。
// 一致はGhosttySelectionで返るがgrid refは次の端末操作で無効になるため、
// JS側へ持ち出す前にここで座標へ落としておく。
// *out_lenには変換できた一致の総数を書き、capを超えていればcap件だけ書いてGHOSTTY_OUT_OF_SPACEを返す
int niwa_search_matches(GhosttyTerminal term, GhosttySearch search, int32_t viewport_only,
                        NiwaSearchMatch *out, size_t cap, size_t *out_len) {
  *out_len = 0;
  GhosttyResult rc = viewport_only ? ghostty_search_feed(search) : ghostty_search_run(search);
  if (rc != GHOSTTY_SUCCESS) return rc;

  GhosttySearchData data =
      viewport_only ? GHOSTTY_SEARCH_DATA_VIEWPORT_MATCHES : GHOSTTY_SEARCH_DATA_MATCHES;
  GhosttySelectionBuffer probe = {NULL, 0, 0};
  rc = ghostty_search_get(search, data, &probe);
  if (rc == GHOSTTY_SUCCESS) return GHOSTTY_SUCCESS;
  if (rc != GHOSTTY_OUT_OF_SPACE) return rc;

  size_t total = probe.len;
  GhosttySelection *selections = malloc(sizeof(GhosttySelection) * total);
  if (selections == NULL) return GHOSTTY_OUT_OF_MEMORY;
  GhosttySelectionBuffer buf = {selections, total, 0};
  rc = ghostty_search_get(search, data, &buf);
  if (rc != GHOSTTY_SUCCESS) {
    free(selections);
    return rc;
  }

  size_t count = 0;
  for (size_t i = 0; i < buf.len; i++) {
    GhosttyPointCoordinate start, end;
    if (ghostty_terminal_point_from_grid_ref(term, &selections[i].start, GHOSTTY_POINT_TAG_SCREEN,
                                             &start) != GHOSTTY_SUCCESS)
      continue;
    if (ghostty_terminal_point_from_grid_ref(term, &selections[i].end, GHOSTTY_POINT_TAG_SCREEN,
                                             &end) != GHOSTTY_SUCCESS)
      continue;
    if (count < cap) {
      out[count].start_x = start.x;
      out[count].start_y = (int32_t)start.y;
      out[count].end_x = end.x;
      out[count].end_y = (int32_t)end.y;
    }
    count++;
  }
  free(selections);
  *out_len = count;
  return count > cap ? GHOSTTY_OUT_OF_SPACE : GHOSTTY_SUCCESS;
}
