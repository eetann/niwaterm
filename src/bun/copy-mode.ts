// vi風コピーモード（キーボードでのテキスト選択）の状態機械。
// libghostty-vt・PTY・DOMのどれにも依存しない純粋関数の集まりで、terminal-session.tsが
// 「行テキストのスナップショット（CopyModeContext）を用意する」「選択範囲のテキストを
// libghostty-vtから取り出す」「ビューポートをスクロールする」といった副作用側を担う。
//
// 座標系: カーソル・アンカーは常に画面座標（スクロールバックを含む絶対行。libghostty-vtの
// GHOSTTY_POINT_TAG_SCREENと同じ空間）で持つ。ビューポート座標で持つとスクロール一つで
// 選択範囲がズレるため。ビューポート座標への変換は描画直前に行う。
//
// 列は「グリッドの桁」であって文字数ではない（全角文字は2桁を占める）。行テキストと桁の
// 対応付けはcellStarts()に集約する。

import { isWideChar } from "../shared/wide-char";

export type CopyModeSelectionMode = "none" | "char" | "line";

export interface CopyModePoint {
  /** 桁（0起点。全角文字は2桁を占めるため文字数とは一致しない） */
  x: number;
  /** 画面座標の行（0起点。0はスクロールバックの最上行） */
  y: number;
}

/** 選択中の範囲。startがendより前（y昇順、同一行ならx昇順）に正規化済み */
export interface CopyModeRange {
  start: CopyModePoint;
  end: CopyModePoint;
  mode: "char" | "line";
}

export type CopyModeSearchDirection = "forward" | "backward";

export interface CopyModeSearch {
  direction: CopyModeSearchDirection;
  query: string;
}

/** 検索の一致箇所。桁は両端とも含む（startXが一致の先頭セル、endXが末尾セル） */
export interface CopyModeMatch {
  /** 画面座標の行 */
  y: number;
  startX: number;
  endX: number;
}

export interface CopyModeState {
  cursor: CopyModePoint;
  /** 選択の始点。selectionModeが"none"の間はnull */
  anchor: CopyModePoint | null;
  selectionMode: CopyModeSelectionMode;
  /**
   * j/kで行を移動しても保ちたい「本来いたい桁」（viのdesired column）。
   * 短い行を通過しても元の桁に戻れるようにするため、カーソルの桁とは別に持つ
   */
  desiredX: number;
  /** ggの1打目のgを受け取った状態か */
  pendingG: boolean;
  /** 検索文字列の入力中（/ か ? を押してからEnter/Escapeまで）。入力中でなければnull */
  searchInput: CopyModeSearch | null;
  /** 直近に実行した検索。n/Nで繰り返すために保持する */
  lastSearch: CopyModeSearch | null;
}

/**
 * キー処理に必要な画面のスナップショット。linesはビューポート全体を含む必要は無いが、
 * 少なくともカーソル行を含んでいないと桁のクランプ・単語移動ができない
 * （呼び出し側はビューポート±1行を渡す。行が無い場合は移動をあきらめてクランプしない）
 */
export interface CopyModeContext {
  cols: number;
  /** ビューポートの行数 */
  viewportRows: number;
  /** ビューポート先頭の画面座標行 */
  viewportOffset: number;
  /** 画面全体（スクロールバック込み）の行数 */
  totalRows: number;
  /** lines[0]が対応する画面座標行 */
  firstLineRow: number;
  lines: string[];
}

export type CopyModeEffect =
  | { type: "none" }
  /** 選択範囲をクリップボードへ入れてコピーモードを抜ける */
  | { type: "yank"; range: CopyModeRange }
  /**
   * 検索を実行してカーソルを一致箇所へ移す。スクロールバック全体の走査には
   * ビューポート外の行テキストが要るため、実際の探索は呼び出し側（terminal-session.ts）が行う
   */
  | { type: "search"; search: CopyModeSearch }
  /**
   * OSC 133でマークされた前後のプロンプト行へカーソルを移す。行のマークはlibghostty-vtの
   * グリッドにしか無く行テキストからは分からないため、探索は呼び出し側が行う
   */
  | { type: "jumpPrompt"; direction: "up" | "down" }
  | { type: "exit" };

export interface CopyModeKeyResult {
  state: CopyModeState;
  effect: CopyModeEffect;
  /** コピーモードのキーとして解釈できたか（falseなら未割当キーで何も起きていない） */
  handled: boolean;
}

/** キー入力の最小表現。webviewのKeyboardEventから必要な分だけを写して渡す */
export interface CopyModeKey {
  /** KeyboardEvent.key相当（"g"/"G"/"$"/"ArrowDown"/"Escape"など。大文字小文字を区別する） */
  key: string;
  ctrl: boolean;
}

export function createCopyModeState(cursor: CopyModePoint): CopyModeState {
  return {
    cursor: { ...cursor },
    anchor: null,
    selectionMode: "none",
    desiredX: cursor.x,
    pendingG: false,
    searchInput: null,
    lastSearch: null,
  };
}

// ---- 行テキストと桁の対応付け ----

/**
 * 行の「セルの開始桁」を左から並べる。全角文字は2桁を占めるため開始桁が1つ飛びになる。
 * h/lでの移動やクランプをこの配列上の前後移動として扱えば、全角文字の途中の桁に
 * カーソルが乗ることが無い。
 *
 * 行末の空白は含めない（viと同じく、カーソルは行の中身より右へは出ない）。
 * 中身が無い行でも0桁には乗れるよう、空配列にはせず[0]を返す
 */
export function cellStarts(line: string, cols: number): number[] {
  const starts: number[] = [];
  let col = 0;
  for (const ch of trimmedLine(line)) {
    if (col >= cols) break;
    starts.push(col);
    col += isWideChar(ch.codePointAt(0) ?? 0) ? 2 : 1;
  }
  if (starts.length === 0) starts.push(0);
  return starts;
}

/** 桁colを含むセルの開始桁（col以下で最大の開始桁）を返す */
function snapToCellStart(starts: number[], col: number): number {
  let result = 0;
  for (const start of starts) {
    if (start > col) break;
    result = start;
  }
  return result;
}

function lineAt(ctx: CopyModeContext, y: number): string | null {
  const index = y - ctx.firstLineRow;
  if (index < 0 || index >= ctx.lines.length) return null;
  return ctx.lines[index] ?? null;
}

/** 末尾の空白を落とした行テキスト（$・単語移動が「行の中身」だけを見るため） */
function trimmedLine(line: string): string {
  return line.replace(/\s+$/u, "");
}

// ---- 単語（viのw/b/eが扱う小文字wordの定義に合わせる） ----

type CharClass = "blank" | "word" | "punct";

function charClass(ch: string): CharClass {
  if (/\s/u.test(ch)) return "blank";
  // ASCII英数字・アンダースコアに加え、非ASCII（日本語など）も単語構成文字として扱う。
  // viは非ASCIIを別クラスにする実装もあるが、日本語の文中でw/bが1文字ずつ進むのは実用的でない
  if (/[\p{L}\p{N}_]/u.test(ch)) return "word";
  return "punct";
}

/** 行を文字単位に分解し、各文字の開始桁を添える（サロゲートペア・全角対応） */
function cellsOf(line: string): Array<{ ch: string; col: number }> {
  const cells: Array<{ ch: string; col: number }> = [];
  let col = 0;
  for (const ch of line) {
    cells.push({ ch, col });
    col += isWideChar(ch.codePointAt(0) ?? 0) ? 2 : 1;
  }
  return cells;
}

/** 桁colに対応する文字インデックス。行末より右ならcells.length（＝行末の外）を返す */
function cellIndexAtColumn(cells: Array<{ ch: string; col: number }>, col: number): number {
  for (let i = cells.length - 1; i >= 0; i--) {
    const cell = cells[i];
    if (cell && cell.col <= col) return i;
  }
  return 0;
}

// ---- 移動 ----

interface Motion {
  cursor: CopyModePoint;
  /** desiredXを移動先の桁で更新するか（j/kのような縦移動ではfalse） */
  updateDesiredX: boolean;
}

function horizontalMove(ctx: CopyModeContext, cursor: CopyModePoint, delta: number): Motion {
  const line = lineAt(ctx, cursor.y);
  if (line === null) return { cursor, updateDesiredX: true };
  const starts = cellStarts(line, ctx.cols);
  const current = starts.indexOf(snapToCellStart(starts, cursor.x));
  const next = Math.min(Math.max(current + delta, 0), starts.length - 1);
  return { cursor: { x: starts[next] ?? 0, y: cursor.y }, updateDesiredX: true };
}

function verticalMove(
  ctx: CopyModeContext,
  cursor: CopyModePoint,
  desiredX: number,
  delta: number,
): Motion {
  const y = Math.min(Math.max(cursor.y + delta, 0), Math.max(ctx.totalRows - 1, 0));
  return { cursor: { x: columnForDesiredX(ctx, y, desiredX), y }, updateDesiredX: false };
}

/**
 * 行yでdesiredXに最も近い（それを超えない）セルの開始桁を求める。
 * 行テキストが手元に無い（スクロール前でビューポート外）場合はdesiredXをそのまま返し、
 * スクロール後のclampCopyModeCursorで補正させる
 */
function columnForDesiredX(ctx: CopyModeContext, y: number, desiredX: number): number {
  const line = lineAt(ctx, y);
  if (line === null) return desiredX;
  return snapToCellStart(cellStarts(line, ctx.cols), desiredX);
}

/** 行頭（0桁） */
function lineStart(cursor: CopyModePoint): Motion {
  return { cursor: { x: 0, y: cursor.y }, updateDesiredX: true };
}

/** 行の最初の非空白文字（^） */
function firstNonBlank(ctx: CopyModeContext, cursor: CopyModePoint): Motion {
  const line = lineAt(ctx, cursor.y);
  if (line === null) return { cursor, updateDesiredX: true };
  const cells = cellsOf(line);
  const found = cells.find((cell) => charClass(cell.ch) !== "blank");
  return { cursor: { x: found?.col ?? 0, y: cursor.y }, updateDesiredX: true };
}

/** 行の最後の非空白文字（$）。空行なら0桁 */
function lastNonBlank(ctx: CopyModeContext, cursor: CopyModePoint): Motion {
  const line = lineAt(ctx, cursor.y);
  if (line === null) return { cursor, updateDesiredX: true };
  const cells = cellsOf(trimmedLine(line));
  const last = cells.at(-1);
  return { cursor: { x: last?.col ?? 0, y: cursor.y }, updateDesiredX: true };
}

/**
 * 次の単語の先頭へ（w）。行末まで単語が無ければ次の行の最初の非空白文字へ送る。
 * 行テキストが手元に無い行まで来たらそこで止める（スクロール跨ぎの単語移動は追わない）
 */
function wordForward(ctx: CopyModeContext, cursor: CopyModePoint): Motion {
  let y = cursor.y;
  let line = lineAt(ctx, y);
  if (line === null) return { cursor, updateDesiredX: true };
  const cells = cellsOf(trimmedLine(line));
  let index = cellIndexAtColumn(cells, cursor.x);
  const startCell = cells[index];
  if (startCell && startCell.col <= cursor.x && index < cells.length) {
    // 現在の単語（同じ文字クラスの連なり）を抜けてから、空白を飛ばす
    const cls = charClass(startCell.ch);
    if (cls !== "blank") {
      while (index < cells.length && charClass(cells[index]?.ch ?? "") === cls) index++;
    }
    while (index < cells.length && charClass(cells[index]?.ch ?? "") === "blank") index++;
    const target = cells[index];
    if (target) return { cursor: { x: target.col, y }, updateDesiredX: true };
  }
  // 行内に次の単語が無いので次の行の先頭の単語を探す
  for (y = cursor.y + 1; y <= ctx.totalRows - 1; y++) {
    line = lineAt(ctx, y);
    if (line === null) return { cursor: { x: cursor.x, y: y - 1 }, updateDesiredX: true };
    const nextCells = cellsOf(trimmedLine(line));
    const found = nextCells.find((cell) => charClass(cell.ch) !== "blank");
    if (found) return { cursor: { x: found.col, y }, updateDesiredX: true };
    // 空行はviと同じく単語の区切りとみなして止まる
    if (nextCells.length === 0) return { cursor: { x: 0, y }, updateDesiredX: true };
  }
  return { cursor, updateDesiredX: true };
}

/** 前の単語の先頭へ（b）。行頭まで単語が無ければ前の行の最後の単語へ戻る */
function wordBackward(ctx: CopyModeContext, cursor: CopyModePoint): Motion {
  let y = cursor.y;
  let line = lineAt(ctx, y);
  if (line === null) return { cursor, updateDesiredX: true };
  let cells = cellsOf(trimmedLine(line));
  let index = cellIndexAtColumn(cells, cursor.x);
  // カーソルが行末より右（末尾空白の上）にいる場合は行末の文字から始める
  if (cells.length > 0 && cursor.x > (cells.at(-1)?.col ?? 0)) index = cells.length;
  index--;
  while (index >= 0 && charClass(cells[index]?.ch ?? "") === "blank") index--;
  if (index >= 0) {
    const cls = charClass(cells[index]?.ch ?? "");
    while (index > 0 && charClass(cells[index - 1]?.ch ?? "") === cls) index--;
    const target = cells[index];
    if (target) return { cursor: { x: target.col, y }, updateDesiredX: true };
  }
  for (y = cursor.y - 1; y >= 0; y--) {
    line = lineAt(ctx, y);
    if (line === null) return { cursor: { x: cursor.x, y: y + 1 }, updateDesiredX: true };
    cells = cellsOf(trimmedLine(line));
    if (cells.length === 0) return { cursor: { x: 0, y }, updateDesiredX: true };
    let last = cells.length - 1;
    const cls = charClass(cells[last]?.ch ?? "");
    while (last > 0 && charClass(cells[last - 1]?.ch ?? "") === cls) last--;
    const target = cells[last];
    if (target) return { cursor: { x: target.col, y }, updateDesiredX: true };
  }
  return { cursor, updateDesiredX: true };
}

/** 単語の末尾へ（e）。現在位置が既に単語末尾なら次の単語の末尾へ進む */
function wordEnd(ctx: CopyModeContext, cursor: CopyModePoint): Motion {
  let y = cursor.y;
  let line = lineAt(ctx, y);
  if (line === null) return { cursor, updateDesiredX: true };
  let cells = cellsOf(trimmedLine(line));
  let index = cellIndexAtColumn(cells, cursor.x) + 1;
  for (;;) {
    while (index < cells.length && charClass(cells[index]?.ch ?? "") === "blank") index++;
    if (index < cells.length) {
      const cls = charClass(cells[index]?.ch ?? "");
      while (index + 1 < cells.length && charClass(cells[index + 1]?.ch ?? "") === cls) index++;
      const target = cells[index];
      if (target) return { cursor: { x: target.col, y }, updateDesiredX: true };
    }
    y++;
    if (y > ctx.totalRows - 1) return { cursor, updateDesiredX: true };
    line = lineAt(ctx, y);
    if (line === null) return { cursor: { x: cursor.x, y: y - 1 }, updateDesiredX: true };
    cells = cellsOf(trimmedLine(line));
    index = 0;
  }
}

// ---- 選択範囲 ----

function comparePoints(a: CopyModePoint, b: CopyModePoint): number {
  if (a.y !== b.y) return a.y - b.y;
  return a.x - b.x;
}

/** 現在の選択範囲を正規化して返す（選択していなければnull） */
export function copyModeRange(state: CopyModeState, cols: number): CopyModeRange | null {
  if (state.selectionMode === "none" || !state.anchor) return null;
  const [start, end] =
    comparePoints(state.anchor, state.cursor) <= 0
      ? [state.anchor, state.cursor]
      : [state.cursor, state.anchor];
  if (state.selectionMode === "line") {
    return {
      start: { x: 0, y: start.y },
      end: { x: Math.max(cols - 1, 0), y: end.y },
      mode: "line",
    };
  }
  return { start: { ...start }, end: { ...end }, mode: "char" };
}

/** 選択範囲をビューポート座標の行区間へ落とす（画面外の行は捨てる）。webviewのハイライト描画用 */
export function copyModeSelectionRows(
  range: CopyModeRange,
  ctx: Pick<CopyModeContext, "cols" | "viewportRows" | "viewportOffset">,
): Array<{ y: number; startX: number; endX: number }> {
  const rows: Array<{ y: number; startX: number; endX: number }> = [];
  const from = Math.max(range.start.y, ctx.viewportOffset);
  const to = Math.min(range.end.y, ctx.viewportOffset + ctx.viewportRows - 1);
  for (let y = from; y <= to; y++) {
    const startX = y === range.start.y ? range.start.x : 0;
    const endX = y === range.end.y ? range.end.x : Math.max(ctx.cols - 1, 0);
    rows.push({ y: y - ctx.viewportOffset, startX, endX });
  }
  return rows;
}

// ---- 検索（/ ? n N）----

/**
 * 大文字を含むクエリのときだけ大文字小文字を区別する（vimのsmartcase）。
 * ターミナルのログはパス・オプション名など小文字が主体で、常に区別ありだと打ちづらいため
 */
function isCaseSensitiveQuery(query: string): boolean {
  return query !== query.toLowerCase();
}

/** 文字列インデックス→桁の対応表（末尾に行全体の幅を1つ余分に持つ） */
function columnMap(line: string): number[] {
  const map: number[] = Array.from({ length: line.length + 1 }, () => 0);
  let col = 0;
  let index = 0;
  for (const ch of line) {
    for (let k = 0; k < ch.length; k++) map[index + k] = col;
    index += ch.length;
    col += isWideChar(ch.codePointAt(0) ?? 0) ? 2 : 1;
  }
  map[line.length] = col;
  return map;
}

/** 1行の中の一致をすべて桁区間で返す（左から順） */
function matchesInLine(line: string, query: string): Array<{ startX: number; endX: number }> {
  const results: Array<{ startX: number; endX: number }> = [];
  if (query === "") return results;
  const caseSensitive = isCaseSensitiveQuery(query);
  const lowered = line.toLowerCase();
  // toLowerCaseで長さが変わる文字（İなど）が含まれる行は桁の対応が崩れるため区別ありで探す
  const usable = !caseSensitive && lowered.length === line.length;
  const haystack = usable ? lowered : line;
  const needle = usable ? query.toLowerCase() : query;
  const map = columnMap(line);
  let from = 0;
  for (;;) {
    const index = haystack.indexOf(needle, from);
    if (index < 0) return results;
    const startX = map[index] ?? 0;
    const endX = Math.max((map[index + needle.length] ?? startX + 1) - 1, startX);
    results.push({ startX, endX });
    // 重なり合う一致も拾えるよう1文字だけ進める
    from = index + 1;
  }
}

/** 与えられた行テキストの中の一致をすべて返す（ハイライト用） */
export function findCopyModeMatches(params: {
  lines: string[];
  firstLineRow: number;
  query: string;
}): CopyModeMatch[] {
  const matches: CopyModeMatch[] = [];
  params.lines.forEach((line, i) => {
    for (const m of matchesInLine(line, params.query)) {
      matches.push({ y: params.firstLineRow + i, startX: m.startX, endX: m.endX });
    }
  });
  return matches;
}

/**
 * 与えられた行テキストの中から、fromの次（forward）／前（backward）の一致を1つ返す。
 * fromがnullなら範囲の端から探す（折り返し検索の2周目で使う）
 */
export function findCopyModeMatch(params: {
  lines: string[];
  firstLineRow: number;
  query: string;
  direction: CopyModeSearchDirection;
  /** この位置ちょうどは一致とみなさない起点。範囲全体を探すならnull */
  from: CopyModePoint | null;
}): CopyModeMatch | null {
  const { lines, firstLineRow, query, direction, from } = params;
  if (query === "") return null;
  const forward = direction === "forward";
  for (
    let i = forward ? 0 : lines.length - 1;
    forward ? i < lines.length : i >= 0;
    i += forward ? 1 : -1
  ) {
    const y = firstLineRow + i;
    if (from && (forward ? y < from.y : y > from.y)) continue;
    const found = matchesInLine(lines[i] ?? "", query);
    const ordered = forward ? found : [...found].reverse();
    for (const m of ordered) {
      if (from && y === from.y && (forward ? m.startX <= from.x : m.startX >= from.x)) continue;
      return { y, startX: m.startX, endX: m.endX };
    }
  }
  return null;
}

// ---- スクロール・クランプ ----

/** カーソルがビューポートに入るために必要なビューポート先頭行（現在位置で足りるならそのまま返す） */
export function viewportOffsetForCursor(state: CopyModeState, ctx: CopyModeContext): number {
  const maxOffset = Math.max(ctx.totalRows - ctx.viewportRows, 0);
  let offset = ctx.viewportOffset;
  if (state.cursor.y < offset) offset = state.cursor.y;
  else if (state.cursor.y > offset + ctx.viewportRows - 1) {
    offset = state.cursor.y - ctx.viewportRows + 1;
  }
  return Math.min(Math.max(offset, 0), maxOffset);
}

/**
 * スクロール後に改めて行テキストを引き直し、カーソルの桁をセル境界へ揃える。
 * 移動時点ではビューポート外で行テキストが無く桁を確定できないケース（gg/G/Ctrl+d等）の後始末
 */
export function clampCopyModeCursor(state: CopyModeState, ctx: CopyModeContext): CopyModeState {
  const y = Math.min(Math.max(state.cursor.y, 0), Math.max(ctx.totalRows - 1, 0));
  const line = lineAt(ctx, y);
  const x =
    line === null
      ? Math.min(Math.max(state.cursor.x, 0), Math.max(ctx.cols - 1, 0))
      : snapToCellStart(cellStarts(line, ctx.cols), Math.max(state.cursor.x, 0));
  if (y === state.cursor.y && x === state.cursor.x) return state;
  return { ...state, cursor: { x, y } };
}

// ---- キー処理 ----

/** ArrowLeft等のKeyboardEvent.key表記をコピーモード内部の名前へ寄せる（1文字キーはそのまま） */
function normalizeKey(key: string): string {
  switch (key) {
    case "ArrowLeft":
      return "left";
    case "ArrowRight":
      return "right";
    case "ArrowUp":
      return "up";
    case "ArrowDown":
      return "down";
    case "Escape":
      return "escape";
    case "Backspace":
      return "backspace";
    case "Enter":
      return "enter";
    case "Home":
      return "home";
    case "End":
      return "end";
    case "PageUp":
      return "pageup";
    case "PageDown":
      return "pagedown";
    default:
      return key;
  }
}

function withMotion(state: CopyModeState, motion: Motion): CopyModeState {
  return {
    ...state,
    cursor: motion.cursor,
    desiredX: motion.updateDesiredX ? motion.cursor.x : state.desiredX,
    pendingG: false,
  };
}

function unhandled(state: CopyModeState): CopyModeKeyResult {
  return { state: { ...state, pendingG: false }, effect: { type: "none" }, handled: false };
}

function withoutSearchInput(state: CopyModeState): CopyModeKeyResult {
  return { state: { ...state, searchInput: null }, effect: { type: "none" }, handled: true };
}

/**
 * 検索文字列の入力中（/ ? の後）のキー処理。移動キーとしては解釈せず、
 * 未割当のキーも飲み込む（PTYへ抜けて画面が動くと入力中の文脈が壊れるため）
 */
function applySearchInputKey(state: CopyModeState, key: CopyModeKey): CopyModeKeyResult {
  const input = state.searchInput;
  if (!input) return unhandled(state);
  const name = normalizeKey(key.key);
  const dropLastChar = (query: string): string => [...query].slice(0, -1).join("");

  if (key.ctrl) {
    switch (name) {
      case "c":
      case "[":
        return withoutSearchInput(state);
      case "u":
        return {
          state: { ...state, searchInput: { ...input, query: "" } },
          effect: { type: "none" },
          handled: true,
        };
      case "h":
        return {
          state: { ...state, searchInput: { ...input, query: dropLastChar(input.query) } },
          effect: { type: "none" },
          handled: true,
        };
      default:
        return { state, effect: { type: "none" }, handled: true };
    }
  }

  switch (name) {
    case "escape":
      return withoutSearchInput(state);
    case "backspace":
      // 空の状態でのBackspaceは検索そのものを取りやめる（vimのコマンドラインと同じ）
      if (input.query === "") return withoutSearchInput(state);
      return {
        state: { ...state, searchInput: { ...input, query: dropLastChar(input.query) } },
        effect: { type: "none" },
        handled: true,
      };
    case "enter": {
      // 空のままEnterは直前の検索文字列を使い回す（vimの / + Enter と同じ）
      const query = input.query !== "" ? input.query : (state.lastSearch?.query ?? "");
      if (query === "") return withoutSearchInput(state);
      const search: CopyModeSearch = { direction: input.direction, query };
      return {
        state: { ...state, searchInput: null, lastSearch: search },
        effect: { type: "search", search },
        handled: true,
      };
    }
    default:
      break;
  }

  // 1文字のキー（記号・空白・IME確定済みの日本語1文字を含む）だけを検索文字列へ足す
  if ([...key.key].length === 1) {
    return {
      state: { ...state, searchInput: { ...input, query: input.query + key.key } },
      effect: { type: "none" },
      handled: true,
    };
  }
  return { state, effect: { type: "none" }, handled: true };
}

/**
 * コピーモード中の1キーを処理する。副作用（スクロール・クリップボード・検索の走査）は起こさず、
 * 次の状態と呼び出し側にやってほしいこと（CopyModeEffect）だけを返す
 */
export function applyCopyModeKey(
  state: CopyModeState,
  key: CopyModeKey,
  ctx: CopyModeContext,
): CopyModeKeyResult {
  if (state.searchInput) return applySearchInputKey(state, key);

  const name = normalizeKey(key.key);
  const halfPage = Math.max(Math.floor(ctx.viewportRows / 2), 1);
  const fullPage = Math.max(ctx.viewportRows - 1, 1);

  if (key.ctrl) {
    switch (name) {
      case "u":
        return {
          state: withMotion(state, verticalMove(ctx, state.cursor, state.desiredX, -halfPage)),
          effect: { type: "none" },
          handled: true,
        };
      case "d":
        return {
          state: withMotion(state, verticalMove(ctx, state.cursor, state.desiredX, halfPage)),
          effect: { type: "none" },
          handled: true,
        };
      case "b":
        return {
          state: withMotion(state, verticalMove(ctx, state.cursor, state.desiredX, -fullPage)),
          effect: { type: "none" },
          handled: true,
        };
      case "f":
        return {
          state: withMotion(state, verticalMove(ctx, state.cursor, state.desiredX, fullPage)),
          effect: { type: "none" },
          handled: true,
        };
      case "c":
      case "[":
        return { state, effect: { type: "exit" }, handled: true };
      default:
        return unhandled(state);
    }
  }

  // ggの2打目待ち。g以外が来たら待ちを解除して、そのキーを通常どおり解釈する
  if (state.pendingG) {
    const cleared = { ...state, pendingG: false };
    if (name === "g") {
      return {
        state: withMotion(cleared, { cursor: { x: 0, y: 0 }, updateDesiredX: true }),
        effect: { type: "none" },
        handled: true,
      };
    }
    return applyCopyModeKey(cleared, key, ctx);
  }

  switch (name) {
    case "h":
    case "left":
      return {
        state: withMotion(state, horizontalMove(ctx, state.cursor, -1)),
        effect: { type: "none" },
        handled: true,
      };
    case "l":
    case "right":
      return {
        state: withMotion(state, horizontalMove(ctx, state.cursor, 1)),
        effect: { type: "none" },
        handled: true,
      };
    case "j":
    case "down":
      return {
        state: withMotion(state, verticalMove(ctx, state.cursor, state.desiredX, 1)),
        effect: { type: "none" },
        handled: true,
      };
    case "k":
    case "up":
      return {
        state: withMotion(state, verticalMove(ctx, state.cursor, state.desiredX, -1)),
        effect: { type: "none" },
        handled: true,
      };
    case "0":
    case "home":
      return {
        state: withMotion(state, lineStart(state.cursor)),
        effect: { type: "none" },
        handled: true,
      };
    case "^":
      return {
        state: withMotion(state, firstNonBlank(ctx, state.cursor)),
        effect: { type: "none" },
        handled: true,
      };
    case "$":
    case "end":
      return {
        state: withMotion(state, lastNonBlank(ctx, state.cursor)),
        effect: { type: "none" },
        handled: true,
      };
    case "w":
      return {
        state: withMotion(state, wordForward(ctx, state.cursor)),
        effect: { type: "none" },
        handled: true,
      };
    case "b":
      return {
        state: withMotion(state, wordBackward(ctx, state.cursor)),
        effect: { type: "none" },
        handled: true,
      };
    case "e":
      return {
        state: withMotion(state, wordEnd(ctx, state.cursor)),
        effect: { type: "none" },
        handled: true,
      };
    case "g":
      return { state: { ...state, pendingG: true }, effect: { type: "none" }, handled: true };
    case "G":
      return {
        state: withMotion(state, {
          cursor: { x: 0, y: Math.max(ctx.totalRows - 1, 0) },
          updateDesiredX: true,
        }),
        effect: { type: "none" },
        handled: true,
      };
    case "H":
      return {
        state: withMotion(
          state,
          verticalMove(ctx, state.cursor, state.desiredX, ctx.viewportOffset - state.cursor.y),
        ),
        effect: { type: "none" },
        handled: true,
      };
    case "M": {
      const middle = ctx.viewportOffset + Math.floor((ctx.viewportRows - 1) / 2);
      return {
        state: withMotion(
          state,
          verticalMove(ctx, state.cursor, state.desiredX, middle - state.cursor.y),
        ),
        effect: { type: "none" },
        handled: true,
      };
    }
    case "L": {
      const bottom = ctx.viewportOffset + ctx.viewportRows - 1;
      return {
        state: withMotion(
          state,
          verticalMove(ctx, state.cursor, state.desiredX, bottom - state.cursor.y),
        ),
        effect: { type: "none" },
        handled: true,
      };
    }
    case "pageup":
      return {
        state: withMotion(state, verticalMove(ctx, state.cursor, state.desiredX, -fullPage)),
        effect: { type: "none" },
        handled: true,
      };
    case "pagedown":
      return {
        state: withMotion(state, verticalMove(ctx, state.cursor, state.desiredX, fullPage)),
        effect: { type: "none" },
        handled: true,
      };
    case "/":
    case "?":
      return {
        state: {
          ...state,
          pendingG: false,
          searchInput: { direction: name === "/" ? "forward" : "backward", query: "" },
        },
        effect: { type: "none" },
        handled: true,
      };
    case "n":
    case "N": {
      const last = state.lastSearch;
      const cleared = { ...state, pendingG: false };
      if (!last) return { state: cleared, effect: { type: "none" }, handled: true };
      // Nは「直前の検索の逆向き」。lastSearch自体の向きは上書きしない（vimと同じ）
      const direction: CopyModeSearchDirection =
        name === "n" ? last.direction : last.direction === "forward" ? "backward" : "forward";
      return {
        state: cleared,
        effect: { type: "search", search: { direction, query: last.query } },
        handled: true,
      };
    }
    // viの段落移動（{ }）に充てる。シェルのプロンプトはセッションの段落の切れ目そのもので、
    // tmuxのコピーモードも{ }を段落移動に使っている
    case "{":
      return {
        state: { ...state, pendingG: false },
        effect: { type: "jumpPrompt", direction: "up" },
        handled: true,
      };
    case "}":
      return {
        state: { ...state, pendingG: false },
        effect: { type: "jumpPrompt", direction: "down" },
        handled: true,
      };
    case "v":
      return {
        state: {
          ...state,
          pendingG: false,
          ...(state.selectionMode === "char"
            ? { selectionMode: "none" as const, anchor: null }
            : { selectionMode: "char" as const, anchor: state.anchor ?? { ...state.cursor } }),
        },
        effect: { type: "none" },
        handled: true,
      };
    case "V":
      return {
        state: {
          ...state,
          pendingG: false,
          ...(state.selectionMode === "line"
            ? { selectionMode: "none" as const, anchor: null }
            : { selectionMode: "line" as const, anchor: state.anchor ?? { ...state.cursor } }),
        },
        effect: { type: "none" },
        handled: true,
      };
    case "y":
    case "enter": {
      // 選択していない状態のyは、viの「カーソル行をヤンク」と同じく1行コピーとして扱う
      const range = copyModeRange(state, ctx.cols) ?? {
        start: { x: 0, y: state.cursor.y },
        end: { x: Math.max(ctx.cols - 1, 0), y: state.cursor.y },
        mode: "line" as const,
      };
      return { state, effect: { type: "yank", range }, handled: true };
    }
    case "escape":
      // 選択中のEscapeは選択解除だけ（viのvisualモード離脱と同じ）。選択していなければコピーモードを抜ける
      if (state.selectionMode !== "none") {
        return {
          state: { ...state, selectionMode: "none", anchor: null, pendingG: false },
          effect: { type: "none" },
          handled: true,
        };
      }
      return { state, effect: { type: "exit" }, handled: true };
    case "q":
      return { state, effect: { type: "exit" }, handled: true };
    default:
      return unhandled(state);
  }
}
