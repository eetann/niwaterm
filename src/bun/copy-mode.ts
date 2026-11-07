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

import {
  type CompiledCopyModeBinding,
  type CompiledCopyModeKeymap,
  type CompiledCopyModeTable,
  type CopyModeAction,
  type CopyModeSearchAction,
  isCustomBindingRef,
} from "@niwaterm/config";
import { splitCells } from "../shared/wide-char";

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

/**
 * 検索の一致箇所。画面座標で、桁は両端とも含む（startが一致の先頭セル、endが末尾セル）。
 * 折り返された行をまたいで一致するとstartとendの行が分かれる
 */
export interface CopyModeMatch {
  start: CopyModePoint;
  end: CopyModePoint;
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
  /** 連続キー（"g g"等）の途中まで打ったキー列（canonical表記）。途中でなければ空 */
  pendingKeys: string[];
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
  /** niwa.keybindでコピーモードの表へ割り当てた関数ハンドラを呼ぶ。handlerIdはniwa-api.tsのレジストリのキー */
  | { type: "custom"; handlerId: string }
  | { type: "exit" };

export interface CopyModeKeyResult {
  state: CopyModeState;
  effect: CopyModeEffect;
  /** コピーモードのキーとして解釈できたか（falseなら未割当キーで何も起きていない） */
  handled: boolean;
}

/** キー入力の最小表現。webview側でKeyboardEventから組み立てて渡す */
export interface CopyModeKey {
  /**
   * キーを@niwaterm/configのcanonicalizeParsed表記にした候補。Shiftで打つ記号（$ { 等）は
   * shift+付きと無しの両方を入れ、先頭から順に表を引く。検索文字列だけを足す入力（IME確定・ペースト）は空
   */
  keys: string[];
  /** 検索文字列の入力中に表で引けなかったとき、検索文字列へ足す1文字。足すものが無ければnull */
  text: string | null;
}

/**
 * terminal-sessionへ渡す1打分の入力。キーの解釈に使う表と、関数ハンドラを実行する手段を添える
 * （どちらも設定ファイルから作られ、bun側のメインプロセスが持つため）
 */
export interface CopyModeKeyPress {
  key: CopyModeKey;
  keymap: CompiledCopyModeKeymap;
  runHandler: (handlerId: string) => void;
}

export function createCopyModeState(cursor: CopyModePoint): CopyModeState {
  return {
    cursor: { ...cursor },
    anchor: null,
    selectionMode: "none",
    desiredX: cursor.x,
    pendingKeys: [],
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
  for (const cell of splitCells(trimmedLine(line))) {
    if (col >= cols) break;
    starts.push(col);
    col += cell.width;
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
  for (const cell of splitCells(line)) {
    cells.push({ ch: cell.text, col });
    col += cell.width;
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

/** 行テキストの最初の非空白セルの桁（全角は2桁を占める）。非空白が無ければ0 */
export function firstNonBlankColumn(line: string): number {
  return cellsOf(line).find((cell) => charClass(cell.ch) !== "blank")?.col ?? 0;
}

/** 行の最初の非空白文字（^） */
function firstNonBlank(ctx: CopyModeContext, cursor: CopyModePoint): Motion {
  const line = lineAt(ctx, cursor.y);
  if (line === null) return { cursor, updateDesiredX: true };
  return { cursor: { x: firstNonBlankColumn(line), y: cursor.y }, updateDesiredX: true };
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
export function isCaseSensitiveQuery(query: string): boolean {
  return query !== query.toLowerCase();
}

/**
 * 一致の中から、fromの次（forward）／前（backward）にあるものを1つ選ぶ。端まで行ったら
 * 反対の端から折り返す（vimのwrapscan相当）ので、一致がfromの位置にしか無ければそれを返す。
 * acceptが偽を返す一致は飛ばす（smartcaseで大文字小文字まで一致するかの確認に使う）
 */
export function pickCopyModeMatch(params: {
  matches: CopyModeMatch[];
  from: CopyModePoint;
  direction: CopyModeSearchDirection;
  accept?: (match: CopyModeMatch) => boolean;
}): CopyModeMatch | null {
  const { from, direction, accept } = params;
  const sorted = [...params.matches].sort((a, b) => comparePoints(a.start, b.start));
  const ordered =
    direction === "forward"
      ? [
          ...sorted.filter((m) => comparePoints(m.start, from) > 0),
          ...sorted.filter((m) => comparePoints(m.start, from) <= 0),
        ]
      : [
          ...sorted.filter((m) => comparePoints(m.start, from) < 0).reverse(),
          ...sorted.filter((m) => comparePoints(m.start, from) >= 0).reverse(),
        ];
  return ordered.find((m) => !accept || accept(m)) ?? null;
}

/** 一致をハイライト用にビューポート内の行ごとの桁区間へ落とす。折り返し行をまたぐ一致は行ごとに分ける */
export function copyModeMatchRows(
  matches: CopyModeMatch[],
  ctx: Pick<CopyModeContext, "cols" | "viewportRows" | "viewportOffset">,
): Array<{ y: number; startX: number; endX: number }> {
  return matches.flatMap((m) =>
    copyModeSelectionRows({ start: m.start, end: m.end, mode: "char" }, ctx),
  );
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

/** 外から与える選択範囲（マウスで選んだ範囲の引き継ぎ用）。どちらも画面座標で、両端のセルを含む */
export interface CopyModeInitialSelection {
  /** 選択の始点（ドラッグを始めた側） */
  anchor: CopyModePoint;
  /** 選択の終点（ドラッグを終えた側）。コピーモードのカーソルはここに置く */
  cursor: CopyModePoint;
}

/**
 * 与えた範囲を文字選択した状態にする。直前の検索（n/Nで繰り返す分）は残し、
 * 打ちかけの連続キーと検索文字列の入力は捨てる
 */
export function selectCopyModeRange(
  state: CopyModeState,
  selection: CopyModeInitialSelection,
): CopyModeState {
  return {
    ...state,
    cursor: { ...selection.cursor },
    anchor: { ...selection.anchor },
    selectionMode: "char",
    desiredX: selection.cursor.x,
    pendingKeys: [],
    searchInput: null,
  };
}

// ---- キー処理 ----

function withMotion(state: CopyModeState, motion: Motion): CopyModeState {
  return {
    ...state,
    cursor: motion.cursor,
    desiredX: motion.updateDesiredX ? motion.cursor.x : state.desiredX,
  };
}

function handled(
  state: CopyModeState,
  effect: CopyModeEffect = { type: "none" },
): CopyModeKeyResult {
  return { state, effect, handled: true };
}

function unhandled(state: CopyModeState): CopyModeKeyResult {
  return { state: { ...state, pendingKeys: [] }, effect: { type: "none" }, handled: false };
}

function lookupBinding<A extends string>(
  table: CompiledCopyModeTable<A>,
  prefix: readonly string[],
  keys: readonly string[],
): CompiledCopyModeBinding<A> | undefined {
  for (const k of keys) {
    const entry = table.bindings.get([...prefix, k].join(" "));
    if (entry) return entry;
  }
  return undefined;
}

type SequenceMatch<A extends string> =
  | { kind: "match"; binding: CompiledCopyModeBinding<A> }
  | { kind: "pending"; keys: string[] }
  | { kind: "none" };

/**
 * 途中まで打った連続キーに今のキーを足して表を引く。完全一致を連続キーの途中より優先する
 * （"g"と"g g"の両方があれば"g"が即座に発火する）。続きとして成り立たないキーが来たら、
 * 途中までの列を捨ててそのキー単独で引き直す（viでgの後にjを押すとjとして動くのと同じ）
 */
function matchSequence<A extends string>(
  table: CompiledCopyModeTable<A>,
  pending: readonly string[],
  keys: readonly string[],
): SequenceMatch<A> {
  const binding = lookupBinding(table, pending, keys);
  if (binding) return { kind: "match", binding };
  for (const k of keys) {
    const sequence = [...pending, k];
    if (table.pendingPrefixes.has(sequence.join(" "))) return { kind: "pending", keys: sequence };
  }
  if (pending.length > 0) return matchSequence(table, [], keys);
  return { kind: "none" };
}

function withoutSearchInput(state: CopyModeState): CopyModeKeyResult {
  return handled({ ...state, searchInput: null });
}

function runSearchInputAction(
  state: CopyModeState,
  input: CopyModeSearch,
  action: CopyModeSearchAction,
): CopyModeKeyResult {
  switch (action) {
    case "copy-search-cancel":
      return withoutSearchInput(state);
    case "copy-search-clear":
      return handled({ ...state, searchInput: { ...input, query: "" } });
    case "copy-search-delete-char":
      // 空の状態で消そうとしたら検索そのものを取りやめる（vimのコマンドラインと同じ）
      if (input.query === "") return withoutSearchInput(state);
      return handled({
        ...state,
        searchInput: { ...input, query: [...input.query].slice(0, -1).join("") },
      });
    case "copy-search-confirm": {
      // 空のまま確定すると直前の検索文字列を使い回す（vimの / + Enter と同じ）
      const query = input.query !== "" ? input.query : (state.lastSearch?.query ?? "");
      if (query === "") return withoutSearchInput(state);
      const search: CopyModeSearch = { direction: input.direction, query };
      return handled(
        { ...state, searchInput: null, lastSearch: search },
        { type: "search", search },
      );
    }
    default: {
      const exhaustive: never = action;
      throw new Error(`unknown copy mode search action: ${String(exhaustive)}`);
    }
  }
}

/**
 * 検索文字列の入力中（/ ? の後）のキー処理。表に無いキーは移動キーとしては解釈せず、
 * 1文字なら検索文字列へ足し、それ以外も飲み込む（PTYへ抜けて画面が動くと入力中の文脈が壊れるため）
 */
function applySearchInputKey(
  state: CopyModeState,
  key: CopyModeKey,
  table: CompiledCopyModeTable<CopyModeSearchAction>,
): CopyModeKeyResult {
  const input = state.searchInput;
  if (!input) return unhandled(state);
  const binding = lookupBinding(table, [], key.keys);
  if (binding) {
    if (isCustomBindingRef(binding.target)) {
      return handled(state, { type: "custom", handlerId: binding.target.id });
    }
    return runSearchInputAction(state, input, binding.target);
  }
  if (key.text !== null) {
    return handled({ ...state, searchInput: { ...input, query: input.query + key.text } });
  }
  return handled(state);
}

function toggleSelection(state: CopyModeState, mode: "char" | "line"): CopyModeState {
  if (state.selectionMode === mode) return { ...state, selectionMode: "none", anchor: null };
  return { ...state, selectionMode: mode, anchor: state.anchor ?? { ...state.cursor } };
}

/** コピーモードのアクション1つを実行する。stateは連続キーの途中状態を解除済みで渡す */
function runCopyModeAction(
  state: CopyModeState,
  action: CopyModeAction,
  ctx: CopyModeContext,
): CopyModeKeyResult {
  const halfPage = Math.max(Math.floor(ctx.viewportRows / 2), 1);
  const fullPage = Math.max(ctx.viewportRows - 1, 1);
  const moveRows = (delta: number) =>
    handled(withMotion(state, verticalMove(ctx, state.cursor, state.desiredX, delta)));
  const moveToRow = (y: number) => moveRows(y - state.cursor.y);

  switch (action) {
    case "copy-cursor-left":
      return handled(withMotion(state, horizontalMove(ctx, state.cursor, -1)));
    case "copy-cursor-right":
      return handled(withMotion(state, horizontalMove(ctx, state.cursor, 1)));
    case "copy-cursor-down":
      return moveRows(1);
    case "copy-cursor-up":
      return moveRows(-1);
    case "copy-line-start":
      return handled(withMotion(state, lineStart(state.cursor)));
    case "copy-first-non-blank":
      return handled(withMotion(state, firstNonBlank(ctx, state.cursor)));
    case "copy-line-end":
      return handled(withMotion(state, lastNonBlank(ctx, state.cursor)));
    case "copy-word-forward":
      return handled(withMotion(state, wordForward(ctx, state.cursor)));
    case "copy-word-backward":
      return handled(withMotion(state, wordBackward(ctx, state.cursor)));
    case "copy-word-end":
      return handled(withMotion(state, wordEnd(ctx, state.cursor)));
    case "copy-top":
      return handled(withMotion(state, { cursor: { x: 0, y: 0 }, updateDesiredX: true }));
    case "copy-bottom":
      return handled(
        withMotion(state, {
          cursor: { x: 0, y: Math.max(ctx.totalRows - 1, 0) },
          updateDesiredX: true,
        }),
      );
    case "copy-screen-top":
      return moveToRow(ctx.viewportOffset);
    case "copy-screen-middle":
      return moveToRow(ctx.viewportOffset + Math.floor((ctx.viewportRows - 1) / 2));
    case "copy-screen-bottom":
      return moveToRow(ctx.viewportOffset + ctx.viewportRows - 1);
    case "copy-half-page-up":
      return moveRows(-halfPage);
    case "copy-half-page-down":
      return moveRows(halfPage);
    case "copy-page-up":
      return moveRows(-fullPage);
    case "copy-page-down":
      return moveRows(fullPage);
    case "copy-search-forward":
    case "copy-search-backward":
      return handled({
        ...state,
        searchInput: {
          direction: action === "copy-search-forward" ? "forward" : "backward",
          query: "",
        },
      });
    case "copy-search-next":
    case "copy-search-prev": {
      const last = state.lastSearch;
      if (!last) return handled(state);
      // prevは「直前の検索の逆向き」。lastSearch自体の向きは上書きしない（vimのNと同じ）
      const direction: CopyModeSearchDirection =
        action === "copy-search-next"
          ? last.direction
          : last.direction === "forward"
            ? "backward"
            : "forward";
      return handled(state, { type: "search", search: { direction, query: last.query } });
    }
    case "copy-prompt-up":
      return handled(state, { type: "jumpPrompt", direction: "up" });
    case "copy-prompt-down":
      return handled(state, { type: "jumpPrompt", direction: "down" });
    case "copy-select-char":
      return handled(toggleSelection(state, "char"));
    case "copy-select-line":
      return handled(toggleSelection(state, "line"));
    case "copy-yank": {
      // 選択していない状態のヤンクは、viの「カーソル行をヤンク」と同じく1行コピーとして扱う
      const range = copyModeRange(state, ctx.cols) ?? {
        start: { x: 0, y: state.cursor.y },
        end: { x: Math.max(ctx.cols - 1, 0), y: state.cursor.y },
        mode: "line" as const,
      };
      return handled(state, { type: "yank", range });
    }
    case "copy-cancel":
      // 選択中なら選択解除だけ（viのvisualモード離脱と同じ）。選択していなければコピーモードを抜ける
      if (state.selectionMode !== "none") {
        return handled({ ...state, selectionMode: "none", anchor: null });
      }
      return handled(state, { type: "exit" });
    case "copy-exit":
      return handled(state, { type: "exit" });
    default: {
      // COPY_MODE_ACTIONSへ足したアクションのcase書き忘れをコンパイル時に弾く
      const exhaustive: never = action;
      throw new Error(`unknown copy mode action: ${String(exhaustive)}`);
    }
  }
}

/**
 * コピーモード中の1キーを処理する。副作用（スクロール・クリップボード・検索の走査・関数ハンドラの実行）は
 * 起こさず、次の状態と呼び出し側にやってほしいこと（CopyModeEffect）だけを返す
 */
export function applyCopyModeKey(
  state: CopyModeState,
  key: CopyModeKey,
  ctx: CopyModeContext,
  keymap: CompiledCopyModeKeymap,
): CopyModeKeyResult {
  if (state.searchInput) return applySearchInputKey(state, key, keymap.search);

  const match = matchSequence(keymap.normal, state.pendingKeys, key.keys);
  switch (match.kind) {
    case "none":
      return unhandled(state);
    case "pending":
      return handled({ ...state, pendingKeys: match.keys });
    case "match": {
      const cleared = { ...state, pendingKeys: [] };
      const { target } = match.binding;
      if (isCustomBindingRef(target)) {
        return handled(cleared, { type: "custom", handlerId: target.id });
      }
      return runCopyModeAction(cleared, target, ctx);
    }
  }
}
