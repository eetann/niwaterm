// libghostty-vt の bun:ffi バインディング
import {
  CFunction,
  dlopen,
  FFIType,
  JSCallback,
  type Pointer,
  ptr,
  read,
  toArrayBuffer,
} from "bun:ffi";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { findNativeArtifact } from "./native-artifacts";
import { decodePng } from "./png-decode";

// ネイティブ成果物の配置と命名はプラットフォームで異なる。
// zigはWindowsのみDLL本体をbin/へ出す（lib/に入るのはリンク用のインポートライブラリ）
const nativeLayout =
  process.platform === "win32"
    ? { subdir: "bin", vt: "ghostty-vt.dll", shim: "niwashim.dll" }
    : { subdir: "lib", vt: "libghostty-vt.dylib", shim: "libniwashim.dylib" };

const libSubdir = join("vendor/libghostty", nativeLayout.subdir);

// ビルド成果物(build/内)から実行されるため、repoルートのvendorを上方向に探索する
function findLibDir(): string {
  const found = findNativeArtifact(join(libSubdir, nativeLayout.vt));
  if (found) return dirname(found);
  throw new Error(
    `${libSubdir} が見つからない。\`mise run build:native\` の前に libghostty-vt をビルドすること`,
  );
}

export const libDir = findLibDir();

// shimはghostty-vtに依存する。WindowsのローダーはDLL自身と同じディレクトリを
// 依存DLLの探索対象にしない（macOSの@loader_path rpathに相当するものが無い）ため、
// shimを先に開くとERROR_MOD_NOT_FOUND(126)で失敗する。
// 先にghostty-vtを開いてプロセスにロード済みにしておくと、名前解決がそちらに当たって解決する
const vt = dlopen(join(libDir, nativeLayout.vt), {
  ghostty_terminal_new: {
    args: [FFIType.ptr, FFIType.ptr, FFIType.u16, FFIType.u16],
    returns: FFIType.i32,
  },
  ghostty_terminal_vt_write: {
    args: [FFIType.ptr, FFIType.ptr, FFIType.u64],
    returns: FFIType.void,
  },
  ghostty_terminal_resize: {
    args: [FFIType.ptr, FFIType.u16, FFIType.u16, FFIType.u32, FFIType.u32],
    returns: FFIType.i32,
  },
  ghostty_terminal_get: {
    args: [FFIType.ptr, FFIType.i32, FFIType.ptr],
    returns: FFIType.i32,
  },
  ghostty_terminal_set: {
    args: [FFIType.ptr, FFIType.i32, FFIType.ptr],
    returns: FFIType.i32,
  },
  ghostty_terminal_free: {
    args: [FFIType.ptr],
    returns: FFIType.void,
  },
  // マウスレポート（DECSET 1000系）のエンコーダ。イベント1件ごとにoptionを詰めてencodeする
  ghostty_mouse_encoder_new: {
    args: [FFIType.ptr, FFIType.ptr],
    returns: FFIType.i32,
  },
  ghostty_mouse_encoder_free: {
    args: [FFIType.ptr],
    returns: FFIType.void,
  },
  ghostty_mouse_encoder_setopt: {
    args: [FFIType.ptr, FFIType.i32, FFIType.ptr],
    returns: FFIType.void,
  },
  ghostty_mouse_encoder_setopt_from_terminal: {
    args: [FFIType.ptr, FFIType.ptr],
    returns: FFIType.void,
  },
  ghostty_mouse_encoder_encode: {
    args: [FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.u64, FFIType.ptr],
    returns: FFIType.i32,
  },
  ghostty_mouse_event_new: {
    args: [FFIType.ptr, FFIType.ptr],
    returns: FFIType.i32,
  },
  ghostty_mouse_event_free: {
    args: [FFIType.ptr],
    returns: FFIType.void,
  },
  ghostty_mouse_event_set_action: {
    args: [FFIType.ptr, FFIType.i32],
    returns: FFIType.void,
  },
  ghostty_mouse_event_set_button: {
    args: [FFIType.ptr, FFIType.i32],
    returns: FFIType.void,
  },
  ghostty_mouse_event_clear_button: {
    args: [FFIType.ptr],
    returns: FFIType.void,
  },
  ghostty_mouse_event_set_mods: {
    args: [FFIType.ptr, FFIType.u16],
    returns: FFIType.void,
  },
  ghostty_paste_encode: {
    args: [FFIType.ptr, FFIType.u64, FFIType.bool, FFIType.ptr, FFIType.u64, FFIType.ptr],
    returns: FFIType.i32,
  },
  // カーソルの視覚的な形状（bar/block/underline）はghostty_terminal_getでは取得できず、
  // render state経由でのみ読める（GHOSTTY_RENDER_STATE_DATA_CURSOR_VISUAL_STYLE）
  ghostty_render_state_new: {
    args: [FFIType.ptr, FFIType.ptr],
    returns: FFIType.i32,
  },
  ghostty_render_state_free: {
    args: [FFIType.ptr],
    returns: FFIType.void,
  },
  ghostty_render_state_update: {
    args: [FFIType.ptr, FFIType.ptr],
    returns: FFIType.i32,
  },
  ghostty_render_state_get: {
    args: [FFIType.ptr, FFIType.i32, FFIType.ptr],
    returns: FFIType.i32,
  },
  // スクロールバックを含む画面の文字列検索。一致の読み出しと座標変換はshimのniwa_search_matchesで行う
  ghostty_search_new: {
    args: [FFIType.ptr, FFIType.ptr, FFIType.ptr],
    returns: FFIType.i32,
  },
  ghostty_search_free: {
    args: [FFIType.ptr],
    returns: FFIType.void,
  },
  // プロセス全体の設定（PNGデコーダ）。PNGデコーダへ渡されるアロケータで出力を確保する
  ghostty_sys_set: {
    args: [FFIType.i32, FFIType.ptr],
    returns: FFIType.i32,
  },
  ghostty_alloc: {
    args: [FFIType.ptr, FFIType.u64],
    returns: FFIType.ptr,
  },
  // Kitty graphics protocol。解釈と画像の保持はlibghostty-vtが行い、描画は組み込み側の責務
  ghostty_kitty_graphics_get: {
    args: [FFIType.ptr, FFIType.i32, FFIType.ptr],
    returns: FFIType.i32,
  },
  ghostty_kitty_graphics_image: {
    args: [FFIType.ptr, FFIType.u32],
    returns: FFIType.ptr,
  },
  ghostty_kitty_graphics_image_get: {
    args: [FFIType.ptr, FFIType.i32, FFIType.ptr],
    returns: FFIType.i32,
  },
  ghostty_kitty_graphics_placement_iterator_new: {
    args: [FFIType.ptr, FFIType.ptr],
    returns: FFIType.i32,
  },
  ghostty_kitty_graphics_placement_iterator_free: {
    args: [FFIType.ptr],
    returns: FFIType.void,
  },
  ghostty_kitty_graphics_placement_next: {
    args: [FFIType.ptr],
    returns: FFIType.bool,
  },
  ghostty_kitty_graphics_placement_get: {
    args: [FFIType.ptr, FFIType.i32, FFIType.ptr],
    returns: FFIType.i32,
  },
  ghostty_kitty_graphics_placement_render_info: {
    args: [FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.ptr],
    returns: FFIType.i32,
  },
});

// GhosttySysOption
const SYS_OPT_DECODE_PNG = 1;

/**
 * Kitty graphics protocolのPNGペイロード（f=100）を展開するコールバック。libghostty-vtは
 * PNGデコーダを持たず、未設定だとPNGの画像を拒否する。設定はプロセス全体で1つなので
 * モジュール読み込み時に1度だけ登録し、参照を持ち続けてGCから守る
 */
const decodePngCallback = new JSCallback(
  (_userdata: Pointer, allocator: Pointer, data: Pointer, len: number | bigint, out: Pointer) => {
    const n = Number(len);
    if (!data || n === 0) return false;
    const decoded = decodePng(new Uint8Array(toArrayBuffer(data, 0, n)));
    if (!decoded) return false;
    const size = decoded.rgba.length;
    const dest = vt.symbols.ghostty_alloc(allocator, BigInt(size));
    if (!dest) return false;
    new Uint8Array(toArrayBuffer(dest, 0, size)).set(decoded.rgba);
    // GhosttySysImage { uint32 width; uint32 height; uint8_t* data; size_t data_len; }
    const outView = new DataView(toArrayBuffer(out, 0, 24));
    outView.setUint32(0, decoded.width, true);
    outView.setUint32(4, decoded.height, true);
    outView.setBigUint64(8, BigInt(dest), true);
    outView.setBigUint64(16, BigInt(size), true);
    return true;
  },
  {
    args: [FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.u64, FFIType.ptr],
    returns: FFIType.bool,
  },
);
vt.symbols.ghostty_sys_set(SYS_OPT_DECODE_PNG, decodePngCallback.ptr);

const shim = dlopen(join(libDir, nativeLayout.shim), {
  niwa_dump_screen: {
    args: [FFIType.ptr, FFIType.i32, FFIType.i32, FFIType.ptr, FFIType.u64, FFIType.ptr],
    returns: FFIType.i32,
  },
  // 引数はNiwaDumpSelectionOptions（int32が9個）のポインタで渡す。
  // bun:ffiは引数10個以上の関数を正しく呼べないため（docs/known-issues参照）
  niwa_dump_selection: {
    args: [FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.u64, FFIType.ptr],
    returns: FFIType.i32,
  },
  niwa_scroll_viewport: {
    args: [FFIType.ptr, FFIType.i32, FFIType.i64],
    returns: FFIType.void,
  },
  niwa_mouse_event_set_position: {
    args: [FFIType.ptr, FFIType.f32, FFIType.f32],
    returns: FFIType.void,
  },
  // 結果はNiwaPromptLocation（int32が3個）のポインタで受け取る
  niwa_find_prompt: {
    args: [FFIType.ptr, FFIType.u32, FFIType.i32, FFIType.u32, FFIType.ptr],
    returns: FFIType.i32,
  },
  niwa_search_set_needle: {
    args: [FFIType.ptr, FFIType.ptr, FFIType.u64],
    returns: FFIType.i32,
  },
  // 結果はNiwaSearchMatch（int32が4個）を並べた領域へ書き込まれる
  niwa_search_matches: {
    args: [FFIType.ptr, FFIType.ptr, FFIType.i32, FFIType.ptr, FFIType.u64, FFIType.ptr],
    returns: FFIType.i32,
  },
});

// GhosttyTerminalOption
const OPT_WRITE_PTY = 1;
const OPT_BELL = 2;
const OPT_CLIPBOARD_WRITE = 26;
const OPT_SCROLLBACK_MAX_BYTES = 27;
const OPT_SCROLLBACK_MAX_LINES = 28;
const OPT_PWD_CHANGED = 25;
const OPT_SIZE = 6;
const OPT_KITTY_IMAGE_STORAGE_LIMIT = 15;
const OPT_KITTY_IMAGE_MEDIUM_FILE = 16;
const OPT_KITTY_IMAGE_MEDIUM_TEMP_FILE = 17;
const OPT_SEMANTIC_PROMPT = 42;

// GhosttySemanticPromptKind。未知の値（将来の追加分）は無視する
const SEMANTIC_PROMPT_KINDS = {
  1: "promptStart",
  2: "inputStart",
  3: "outputStart",
  4: "commandEnd",
} as const;

/** シェル統合がOSC 133で報告したコマンドの段階 */
export interface SemanticPromptEvent {
  kind: (typeof SEMANTIC_PROMPT_KINDS)[keyof typeof SEMANTIC_PROMPT_KINDS];
  /** outputStartで実行されるコマンド行（kittyの`cmdline_url`等をデコード済み）。送られなければ空文字列 */
  command: string;
  /** commandEndで報告された終了コード。報告が無ければnull */
  exitCode: number | null;
}

// GhosttyClipboardWriteResult
const CLIPBOARD_WRITE_RESULT_SUCCESS = 0;

// GhosttyClipboardWriteReply { size_t size; i32 result; bool remember } = 16バイト
const clipboardWriteReplyBuf = new Uint8Array(16);
const clipboardWriteReplyView = new DataView(clipboardWriteReplyBuf.buffer);
clipboardWriteReplyView.setBigUint64(0, 16n, true);

// GhosttyClipboardWrite::replyの関数ポインタはlibghostty-vt内の固定の関数なので、
// 書き込みのたびにCFunctionを作らないようポインタ値ごとに使い回す
let clipboardWriteReplyFn: { ptr: number; call: ReturnType<typeof CFunction> } | null = null;

/**
 * クリップボード書き込み要求へ応答する。応答せずにコールバックから戻ると
 * libghostty-vtは書き込み拒否として扱い、OSC 5522ではEPERMがプログラムへ返る。
 * replyは要求のコールバック実行中に呼ぶ必要がある。
 */
function replyClipboardWrite(writePtr: Pointer, result: number): void {
  // GhosttyClipboardWrite::reply（size 8 + location 8 + contents 8 + contents_len 8
  // + name 16 + granted/can_remember 8 + ctx 8 の後ろ）
  const replyPtr = Number(read.ptr(writePtr, 64));
  if (!replyPtr) return;
  if (clipboardWriteReplyFn?.ptr !== replyPtr) {
    clipboardWriteReplyFn?.call.close();
    const call = CFunction({
      ptr: replyPtr as Pointer,
      args: [FFIType.ptr, FFIType.ptr],
      returns: FFIType.void,
    });
    clipboardWriteReplyFn = { ptr: replyPtr, call };
  }
  clipboardWriteReplyView.setInt32(8, result, true);
  clipboardWriteReplyBuf[12] = 0; // remember
  clipboardWriteReplyFn.call(writePtr, ptr(clipboardWriteReplyBuf));
}

// GhosttyMode = uint16_t（bit0-14=値, bit15=ANSIフラグ。DEC privateなモードはフラグなし）
const MODE_BRACKETED_PASTE = 2004;
// マウスレポートの有効化モード（トラッキング種別）と報告フォーマット。
// libghostty-vt側ではどちらも単一のenumへ畳まれるため、ここでは
// 「エンコーダの設定を取り直す必要があるか」の判定にだけ使う
const MOUSE_MODES = [9, 1000, 1002, 1003, 1005, 1006, 1015, 1016] as const;
/** ボタン非押下時の移動も報告するモード（DECSET 1003） */
const MODE_MOUSE_ANY_EVENT = 1003;

// GhosttyTerminalData
const DATA_MOUSE_TRACKING = 11;
const DATA_CURSOR_X = 3;
const DATA_CURSOR_Y = 4;
const DATA_CURSOR_VISIBLE = 7;
const DATA_VIEWPORT_ACTIVE = 32;
const DATA_MODE = 37;
const DATA_PWD = 13;
/** GhosttyTerminalScrollbar { uint64 total; uint64 offset; uint64 len; } を書き出す */
const DATA_SCROLLBAR = 9;
const DATA_KITTY_GRAPHICS = 30;
const DATA_MOUSE_SHAPE = 41;

// GhosttyKittyGraphicsData
const KITTY_DATA_PLACEMENT_ITERATOR = 1;
const KITTY_DATA_GENERATION = 2;

// GhosttyKittyGraphicsPlacementData
const KITTY_PLACEMENT_IMAGE_ID = 1;
const KITTY_PLACEMENT_X_OFFSET = 4;
const KITTY_PLACEMENT_Y_OFFSET = 5;
const KITTY_PLACEMENT_Z = 12;

// GhosttyKittyGraphicsImageData
const KITTY_IMAGE_WIDTH = 3;
const KITTY_IMAGE_HEIGHT = 4;
const KITTY_IMAGE_FORMAT = 5;
const KITTY_IMAGE_DATA_PTR = 7;
const KITTY_IMAGE_DATA_LEN = 8;
const KITTY_IMAGE_GENERATION = 9;

// GhosttyKittyImageFormatの値ごとの1ピクセルあたりのバイト数（PNGは保存前にRGBAへ展開されるため来ない）
const KITTY_IMAGE_BYTES_PER_PIXEL: Record<number, number> = { 0: 3, 1: 4, 3: 2, 4: 1 };

/**
 * Kitty graphicsの画像保存の上限（バイト）。0だと無効になり画像を一切受け付けない。
 * 主画面・代替画面それぞれに効く
 */
const KITTY_IMAGE_STORAGE_LIMIT = 64n * 1024n * 1024n;

// GhosttyRenderStateData
const RENDER_DATA_CURSOR_VISUAL_STYLE = 10;

// GhosttyRenderStateCursorVisualStyle（インデックスがそのままenum値に対応する）
const CURSOR_SHAPES = ["bar", "block", "underline", "block_hollow"] as const;
export type CursorShape = (typeof CURSOR_SHAPES)[number];

// GhosttyMouseShape（インデックスがそのままenum値に対応する）。値はCSSのcursorプロパティの名前で、
// OSC 22で指定される名前もCSSのcursorと同じ語彙
const MOUSE_SHAPES = [
  "default",
  "context-menu",
  "help",
  "pointer",
  "progress",
  "wait",
  "cell",
  "crosshair",
  "text",
  "vertical-text",
  "alias",
  "copy",
  "move",
  "no-drop",
  "not-allowed",
  "grab",
  "grabbing",
  "all-scroll",
  "col-resize",
  "row-resize",
  "n-resize",
  "e-resize",
  "s-resize",
  "w-resize",
  "ne-resize",
  "nw-resize",
  "se-resize",
  "sw-resize",
  "ew-resize",
  "ns-resize",
  "nesw-resize",
  "nwse-resize",
  "zoom-in",
  "zoom-out",
] as const;
export type MouseShape = (typeof MOUSE_SHAPES)[number];

// GhosttyMouseEncoderOption
const MOUSE_OPT_SIZE = 2;
const MOUSE_OPT_ANY_BUTTON_PRESSED = 3;
const MOUSE_OPT_TRACK_LAST_CELL = 4;

// GhosttyMouseAction
const MOUSE_ACTIONS = { press: 0, release: 1, motion: 2 } as const;

// GhosttyMouseButton。four以降はX11由来のホイール割り当て（4=上, 5=下, 6=左, 7=右）で、
// libghostty-vt側がSGR等のボタンコード（64〜67）へ変換する
const MOUSE_BUTTONS = {
  left: 1,
  right: 2,
  middle: 3,
  wheelUp: 4,
  wheelDown: 5,
  wheelLeft: 6,
  wheelRight: 7,
} as const;

// GhosttyMods
const MODS_SHIFT = 1 << 0;
const MODS_CTRL = 1 << 1;
const MODS_ALT = 1 << 2;
const MODS_SUPER = 1 << 3;

export type MouseAction = keyof typeof MOUSE_ACTIONS;
export type MouseButton = keyof typeof MOUSE_BUTTONS;

export interface MouseMods {
  shift?: boolean;
  ctrl?: boolean;
  alt?: boolean;
  super?: boolean;
}

/** webview側で観測したマウス操作。RPCでそのまま運ぶためプリミティブのみで構成する */
export interface MouseEventInput {
  action: MouseAction;
  /** 押されている（または離された）ボタン。ボタンを伴わない移動はnull */
  button: MouseButton | null;
  /** ターミナル描画領域(.term)の左上を原点とするピクセル座標。領域外の負値・超過値も許容する */
  x: number;
  y: number;
  mods: MouseMods;
  /** このイベント時点でいずれかのボタンが押されているか（領域外へのドラッグ継続判定に使う） */
  anyButtonPressed: boolean;
}

// GhosttyFormatterFormat
const FORMAT_PLAIN = 0;
const FORMAT_HTML = 2;

// GhosttyTerminalScrollViewportTag
const SCROLL_VIEWPORT_TOP = 0;
const SCROLL_VIEWPORT_BOTTOM = 1;
const SCROLL_VIEWPORT_DELTA = 2;
const SCROLL_VIEWPORT_ROW = 3;
const SCROLL_VIEWPORT_DELTA_PROMPT = 4;

// GhosttyPointTag
const POINT_TAG_SCREEN = 2;

const EMPTY_BYTES = new Uint8Array(0);

export interface CursorState {
  x: number;
  y: number;
  visible: boolean;
  shape: CursorShape;
}

/** Kitty graphicsの配置1件。座標はビューポート基準で、寸法はターミナルに伝えたセル寸法基準のピクセル */
export interface KittyPlacement {
  /** 描く画像（KittyImage.key） */
  imageKey: string;
  /** 左上のセル。上へスクロールアウトしかけた配置ではrowが負になる */
  col: number;
  row: number;
  /** セル左上からのずらし量 */
  xOffset: number;
  yOffset: number;
  /** 描画サイズ */
  width: number;
  height: number;
  /** 画像から切り出す範囲 */
  sourceX: number;
  sourceY: number;
  sourceWidth: number;
  sourceHeight: number;
  /** 負なら文字より奥、0以上なら文字より手前に描く */
  z: number;
}

export interface KittyImage {
  /**
   * 画像の世代番号。同じ画像IDの再送でも変わり、プロセス全体で一意なので
   * そのままキャッシュのキーに使える
   */
  key: string;
  width: number;
  height: number;
  /** 1ピクセル4バイトのRGBAをbase64にしたもの */
  rgbaBase64: string;
}

export interface KittyGraphicsState {
  placements: KittyPlacement[];
  /** placementsが参照する画像。同じ画像を複数の配置で使っても1件にまとめる */
  images: KittyImage[];
}

const EMPTY_KITTY_GRAPHICS: KittyGraphicsState = { placements: [], images: [] };

/** libghostty-vtが保持している画素を、webviewでそのまま使えるRGBAへ揃える */
function toRgba(pixels: Uint8Array, bytesPerPixel: number): Uint8Array {
  if (bytesPerPixel === 4) return pixels;
  const count = pixels.length / bytesPerPixel;
  const out = new Uint8Array(count * 4);
  for (let i = 0; i < count; i++) {
    const src = i * bytesPerPixel;
    const dst = i * 4;
    if (bytesPerPixel === 3) {
      out[dst] = pixels[src] ?? 0;
      out[dst + 1] = pixels[src + 1] ?? 0;
      out[dst + 2] = pixels[src + 2] ?? 0;
      out[dst + 3] = 255;
    } else {
      const gray = pixels[src] ?? 0;
      out[dst] = gray;
      out[dst + 1] = gray;
      out[dst + 2] = gray;
      out[dst + 3] = bytesPerPixel === 2 ? (pixels[src + 1] ?? 0) : 255;
    }
  }
  return out;
}

// 呼び出し元が指定しなかった場合のスクロールバック上限。
// 設定ファイル経由の既定値は@niwaterm/configのdefaultTerminalConfig.scrollbackが持つ
const FALLBACK_MAX_SCROLLBACK = 10_000;

/** findPromptが返すプロンプトの位置。行はいずれも画面座標（スクロールバックを含む絶対行） */
export interface PromptLocation {
  /** OSC 133のAでマークされた行。プロンプトブロックの先頭で、powerlevel10kなら区切りの空行 */
  row: number;
  /** コマンドを打った行（プロンプトブロックの最終行）。単一行プロンプトならrowと同じ */
  inputRow: number;
}

/** searchMatchesが返す一致。画面座標（スクロールバックを含む絶対行）で、桁は両端とも含む */
export interface SearchMatch {
  start: { x: number; y: number };
  end: { x: number; y: number };
}

// GhosttyResult
const RESULT_OUT_OF_SPACE = -3;

export function createGhosttyTerminal(
  cols: number,
  rows: number,
  maxScrollback = FALLBACK_MAX_SCROLLBACK,
) {
  const handle = new BigUint64Array(1);
  let rc = vt.symbols.ghostty_terminal_new(null, ptr(handle), cols, rows);
  if (rc !== 0) throw new Error(`ghostty_terminal_new failed: ${rc}`);
  const term = read.ptr(ptr(handle)) as Pointer;

  // スクロールバック上限は生成時オプションではなく生成後のsetで指定する
  // （ghostty_terminal_newはcols/rowsしか受け取らない）。
  // バイト数の上限はNULLで解除し、行数だけで上限を決める。libghostty-vtの既定は
  // 10000バイトで、行数をいくら大きくしてもバイト数側が先に上限へ達して900行ほどで
  // 頭打ちになる（詳細: docs/known-issues/libghostty-vt-scrollback-byte-limit.md）
  vt.symbols.ghostty_terminal_set(term, OPT_SCROLLBACK_MAX_BYTES, null);
  setScrollbackMaxLines(maxScrollback);

  // カーソル形状（DECSCUSR）読み取り専用のrender state。行データ等は一切使わない
  const renderStateHandle = new BigUint64Array(1);
  rc = vt.symbols.ghostty_render_state_new(null, ptr(renderStateHandle));
  if (rc !== 0) throw new Error(`ghostty_render_state_new failed: ${rc}`);
  const renderState = read.ptr(ptr(renderStateHandle)) as Pointer;

  // マウスレポートのエンコードにはグリッドサイズとセルサイズが要るため、resizeの値を控えておく。
  // セルサイズはwebview側の実測が届く（resize）まで不明なので0始まりにする
  let currentCols = cols;
  let currentRows = rows;
  let currentCellWidthPx = 0;
  let currentCellHeightPx = 0;
  let writePtyCallback: JSCallback | null = null;
  let clipboardCallback: JSCallback | null = null;
  let pwdChangedCallback: JSCallback | null = null;
  let bellCallback: JSCallback | null = null;
  let semanticPromptCallback: JSCallback | null = null;
  const writtenBuf = new BigUint64Array(1);
  // GhosttyTerminalScrollbar（uint64 x 3）の受け皿
  const scrollbarBuf = new Uint8Array(24);
  const scrollbarView = new DataView(scrollbarBuf.buffer);
  // NiwaDumpSelectionOptions（int32 x 9）の詰め先。呼び出しごとに使い回す
  const dumpSelectionOpts = new Int32Array(9);
  const u16Out = new Uint16Array(1);
  const u8Out = new Uint8Array(1);
  const i32Out = new Int32Array(1);
  // NiwaPromptLocation（int32 x 2）の受け皿。呼び出しごとに使い回す
  const promptLocation = new Int32Array(2);
  // GhosttySearchは初めて検索したときに作る。端末1つにつき1つを使い回し、検索文字列だけ差し替える
  let search: Pointer | null = null;
  let searchNeedle = "";
  // NiwaSearchMatch（int32 x 4）の並び。足りなければ必要数に合わせて作り直す
  let searchMatchBuf = new Int32Array(4 * 256);

  // ---- Kitty graphics protocol ----
  vt.symbols.ghostty_terminal_set(
    term,
    OPT_KITTY_IMAGE_STORAGE_LIMIT,
    ptr(new BigUint64Array([KITTY_IMAGE_STORAGE_LIMIT])),
  );
  // ファイル経由の転送（t=f/t=t）を受け付ける。kitten icat等は手元のターミナルと判断すると
  // こちらを優先し、読めなければ（WSLディストロ内のパスをWindows側から開けない等）エスケープ
  // シーケンスへ直接埋め込む転送へフォールバックする
  vt.symbols.ghostty_terminal_set(term, OPT_KITTY_IMAGE_MEDIUM_FILE, ptr(new Uint8Array([1])));
  const tempDir = new TextEncoder().encode(tmpdir());
  // GhosttyString { const uint8_t* ptr; size_t len; }
  const tempDirString = new BigUint64Array([BigInt(ptr(tempDir)), BigInt(tempDir.length)]);
  vt.symbols.ghostty_terminal_set(term, OPT_KITTY_IMAGE_MEDIUM_TEMP_FILE, ptr(tempDirString));

  const kittyIteratorHandle = new BigUint64Array(1);
  rc = vt.symbols.ghostty_kitty_graphics_placement_iterator_new(null, ptr(kittyIteratorHandle));
  if (rc !== 0) throw new Error(`ghostty_kitty_graphics_placement_iterator_new failed: ${rc}`);
  const kittyIterator = read.ptr(ptr(kittyIteratorHandle)) as Pointer;
  const kittyHandleOut = new BigUint64Array(1);
  const u32Out = new Uint32Array(1);
  const u64Out = new BigUint64Array(1);
  // GhosttyKittyGraphicsPlacementRenderInfo。先頭のsize_tへ構造体サイズ（56）を入れて渡す
  const renderInfoBuf = new Uint8Array(56);
  const renderInfoView = new DataView(renderInfoBuf.buffer);
  renderInfoView.setBigUint64(0, 56n, true);
  /** 画像の世代番号 → base64化したRGBA。同じ画像を描画のたびに変換し直さないためのもの */
  let kittyImageCache = new Map<string, KittyImage>();

  // XTWINOPS（CSI 14/16/18 t）へ応答する。画像を表示するツールの多くはこれでセルのピクセル寸法を
  // 知り、何セル分の大きさで送るかを決める。セル寸法が未確定のうちは応答しない
  const sizeCallback = new JSCallback(
    (_term: Pointer, _userdata: Pointer, out: Pointer) => {
      const cellWidth = Math.round(currentCellWidthPx);
      const cellHeight = Math.round(currentCellHeightPx);
      if (cellWidth <= 0 || cellHeight <= 0) return false;
      // GhosttySizeReportSize { uint16 rows; uint16 columns; uint32 cell_width; uint32 cell_height; }
      const outView = new DataView(toArrayBuffer(out, 0, 12));
      outView.setUint16(0, currentRows, true);
      outView.setUint16(2, currentCols, true);
      outView.setUint32(4, cellWidth, true);
      outView.setUint32(8, cellHeight, true);
      return true;
    },
    {
      args: [FFIType.ptr, FFIType.ptr, FFIType.ptr],
      returns: FFIType.bool,
    },
  );
  vt.symbols.ghostty_terminal_set(term, OPT_SIZE, sizeCallback.ptr);

  function kittyPlacementU32(data: number): number {
    vt.symbols.ghostty_kitty_graphics_placement_get(kittyIterator, data, ptr(u32Out));
    return u32Out[0] ?? 0;
  }

  function kittyImageU32(image: Pointer, data: number): number {
    vt.symbols.ghostty_kitty_graphics_image_get(image, data, ptr(u32Out));
    return u32Out[0] ?? 0;
  }

  /** 画像の画素をRGBAのbase64へ変換する。画素の受信が済んでいなければnull */
  function readKittyImage(image: Pointer, key: string): KittyImage | null {
    const bytesPerPixel = KITTY_IMAGE_BYTES_PER_PIXEL[kittyImageU32(image, KITTY_IMAGE_FORMAT)];
    if (!bytesPerPixel) return null;
    if (vt.symbols.ghostty_kitty_graphics_image_get(image, KITTY_IMAGE_DATA_PTR, ptr(u64Out)) !== 0)
      return null;
    const dataPtr = Number(u64Out[0]) as Pointer;
    vt.symbols.ghostty_kitty_graphics_image_get(image, KITTY_IMAGE_DATA_LEN, ptr(u64Out));
    const len = Number(u64Out[0]);
    if (!dataPtr || len === 0) return null;
    const pixels = new Uint8Array(toArrayBuffer(dataPtr, 0, len));
    return {
      key,
      width: kittyImageU32(image, KITTY_IMAGE_WIDTH),
      height: kittyImageU32(image, KITTY_IMAGE_HEIGHT),
      rgbaBase64: Buffer.from(toRgba(pixels, bytesPerPixel)).toString("base64"),
    };
  }

  /**
   * ビューポートに少しでも掛かっているKitty graphicsの配置と、その画像を取り出す。
   * スクロールでも位置が動くため、画像の出入りが無くても描画のたびに呼び直す
   */
  function kittyGraphics(): KittyGraphicsState {
    if (vt.symbols.ghostty_terminal_get(term, DATA_KITTY_GRAPHICS, ptr(kittyHandleOut)) !== 0) {
      return EMPTY_KITTY_GRAPHICS;
    }
    const graphics = Number(kittyHandleOut[0]) as Pointer;
    if (!graphics) return EMPTY_KITTY_GRAPHICS;
    // 一度も画像を受け取っていないターミナル（大半のタブ）はここで打ち切る
    vt.symbols.ghostty_kitty_graphics_get(graphics, KITTY_DATA_GENERATION, ptr(u64Out));
    if (u64Out[0] === 0n) {
      kittyImageCache.clear();
      return EMPTY_KITTY_GRAPHICS;
    }
    vt.symbols.ghostty_kitty_graphics_get(
      graphics,
      KITTY_DATA_PLACEMENT_ITERATOR,
      ptr(kittyIteratorHandle),
    );

    const placements: KittyPlacement[] = [];
    const images = new Map<string, KittyImage>();
    while (vt.symbols.ghostty_kitty_graphics_placement_next(kittyIterator)) {
      const image = vt.symbols.ghostty_kitty_graphics_image(
        graphics,
        kittyPlacementU32(KITTY_PLACEMENT_IMAGE_ID),
      ) as Pointer | null;
      if (!image) continue;
      const rc = vt.symbols.ghostty_kitty_graphics_placement_render_info(
        kittyIterator,
        image,
        term,
        ptr(renderInfoBuf),
      );
      // 仮想配置（Unicodeプレースホルダ）はviewport_visibleがfalseで来る。未対応なので描かない
      if (rc !== 0 || renderInfoBuf[32] === 0) continue;

      vt.symbols.ghostty_kitty_graphics_image_get(image, KITTY_IMAGE_GENERATION, ptr(u64Out));
      const key = String(u64Out[0]);
      if (!images.has(key)) {
        const cached = kittyImageCache.get(key) ?? readKittyImage(image, key);
        if (!cached) continue;
        images.set(key, cached);
      }
      vt.symbols.ghostty_kitty_graphics_placement_get(
        kittyIterator,
        KITTY_PLACEMENT_Z,
        ptr(i32Out),
      );
      placements.push({
        imageKey: key,
        col: renderInfoView.getInt32(24, true),
        row: renderInfoView.getInt32(28, true),
        xOffset: kittyPlacementU32(KITTY_PLACEMENT_X_OFFSET),
        yOffset: kittyPlacementU32(KITTY_PLACEMENT_Y_OFFSET),
        width: renderInfoView.getUint32(8, true),
        height: renderInfoView.getUint32(12, true),
        sourceX: renderInfoView.getUint32(36, true),
        sourceY: renderInfoView.getUint32(40, true),
        sourceWidth: renderInfoView.getUint32(44, true),
        sourceHeight: renderInfoView.getUint32(48, true),
        z: i32Out[0] ?? 0,
      });
    }
    // 画面から消えた画像の変換結果は捨てる（再び映れば変換し直す）
    kittyImageCache = images;
    return { placements, images: [...images.values()] };
  }

  /** DSR等のクエリ応答をPTYへ書き戻すコールバックを登録する */
  function onWritePty(fn: (data: Uint8Array) => void): void {
    writePtyCallback = new JSCallback(
      (_term: Pointer, _userdata: Pointer, data: Pointer, len: number | bigint) => {
        const n = Number(len);
        if (n > 0) fn(new Uint8Array(toArrayBuffer(data, 0, n)).slice());
      },
      {
        args: [FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.u64],
        returns: FFIType.void,
      },
    );
    vt.symbols.ghostty_terminal_set(term, OPT_WRITE_PTY, writePtyCallback.ptr);
  }

  /**
   * OSC 52等によるクリップボード書き込みを受けるコールバックを登録する。
   * fnにはtext/plain表現のバイト列を渡す（text/plainがなければ先頭の表現）。
   */
  function onClipboardWrite(fn: (data: Uint8Array) => void): void {
    // GhosttyClipboardWrite { size_t size; i32 location; GhosttyClipboardContent* contents; size_t contents_len; ... }
    // GhosttyClipboardContent { GhosttyString mime; GhosttyString data } / GhosttyString { ptr; size_t len } = 32バイト
    clipboardCallback = new JSCallback(
      (_term: Pointer, _userdata: Pointer, writePtr: Pointer) => {
        const contents = read.ptr(writePtr, 16) as Pointer;
        const len = Number(read.u64(writePtr, 24));
        // クリア要求（len=0）は何もしないが、拒否扱いにはせず成功を返す
        if (contents && len > 0) {
          let chosen = 0;
          for (let i = 0; i < len; i++) {
            const mimePtr = read.ptr(contents, i * 32) as Pointer;
            const mimeLen = Number(read.u64(contents, i * 32 + 8));
            if (!mimePtr) continue;
            const mime = new TextDecoder().decode(
              new Uint8Array(toArrayBuffer(mimePtr, 0, mimeLen)),
            );
            if (mime === "text/plain") {
              chosen = i;
              break;
            }
          }
          const dataPtr = read.ptr(contents, chosen * 32 + 16) as Pointer;
          const dataLen = Number(read.u64(contents, chosen * 32 + 24));
          if (dataPtr && dataLen > 0) {
            fn(new Uint8Array(toArrayBuffer(dataPtr, 0, dataLen)).slice());
          }
        }
        replyClipboardWrite(writePtr, CLIPBOARD_WRITE_RESULT_SUCCESS);
      },
      {
        args: [FFIType.ptr, FFIType.ptr, FFIType.ptr],
        returns: FFIType.void,
      },
    );
    vt.symbols.ghostty_terminal_set(term, OPT_CLIPBOARD_WRITE, clipboardCallback.ptr);
  }

  const pwdBuf = new Uint8Array(16); // GhosttyString { const uint8_t* ptr; size_t len; }

  /**
   * カレントディレクトリの変化を受けるコールバックを登録する（OSC 7 / OSC 9 / OSC 1337）。
   * libghostty-vt（vt-only版）はURIパースを行わず、シェルが送った生のペイロードをそのまま返す
   * （OSC 7なら`file://host/path`等のURI丸ごと、OSC 9/1337なら生パス）。
   * デコードは呼び出し側（terminal-session.ts）の責務。
   * シェル側が空文字列を送った場合（pwd不明の通知）はfnを呼ばない。
   */
  function onPwdChanged(fn: (cwd: string) => void): void {
    pwdChangedCallback = new JSCallback(
      (_term: Pointer, _userdata: Pointer) => {
        const rc = vt.symbols.ghostty_terminal_get(term, DATA_PWD, ptr(pwdBuf));
        if (rc !== 0) return;
        const strPtr = read.ptr(ptr(pwdBuf), 0) as Pointer;
        const len = Number(read.u64(ptr(pwdBuf), 8));
        if (!strPtr || len === 0) return;
        fn(new TextDecoder().decode(new Uint8Array(toArrayBuffer(strPtr, 0, len))));
      },
      {
        args: [FFIType.ptr, FFIType.ptr],
        returns: FFIType.void,
      },
    );
    vt.symbols.ghostty_terminal_set(term, OPT_PWD_CHANGED, pwdChangedCallback.ptr);
  }

  /** BEL文字(0x07)を受け取った時に呼ばれるコールバックを登録する */
  function onBell(fn: () => void): void {
    bellCallback = new JSCallback(
      (_term: Pointer, _userdata: Pointer) => {
        fn();
      },
      {
        args: [FFIType.ptr, FFIType.ptr],
        returns: FFIType.void,
      },
    );
    vt.symbols.ghostty_terminal_set(term, OPT_BELL, bellCallback.ptr);
  }

  /** シェル統合のOSC 133（プロンプト開始・入力開始・出力開始・コマンド終了）を受けるコールバックを登録する */
  function onSemanticPrompt(fn: (event: SemanticPromptEvent) => void): void {
    // GhosttyTerminalSemanticPrompt { size_t size; i32 kind; i32 prompt_kind; bool has_exit_code;
    //   i32 exit_code; GhosttyString command; GhosttyString error } = 56バイト。文字列はコールバック中のみ有効
    semanticPromptCallback = new JSCallback(
      (_term: Pointer, _userdata: Pointer, eventPtr: Pointer) => {
        const kind =
          SEMANTIC_PROMPT_KINDS[read.i32(eventPtr, 8) as keyof typeof SEMANTIC_PROMPT_KINDS];
        if (!kind) return;
        const commandPtr = read.ptr(eventPtr, 24) as Pointer;
        const commandLen = Number(read.u64(eventPtr, 32));
        const command =
          commandPtr && commandLen > 0
            ? new TextDecoder().decode(new Uint8Array(toArrayBuffer(commandPtr, 0, commandLen)))
            : "";
        const exitCode = read.u8(eventPtr, 16) !== 0 ? read.i32(eventPtr, 20) : null;
        fn({ kind, command, exitCode });
      },
      {
        args: [FFIType.ptr, FFIType.ptr, FFIType.ptr],
        returns: FFIType.void,
      },
    );
    vt.symbols.ghostty_terminal_set(term, OPT_SEMANTIC_PROMPT, semanticPromptCallback.ptr);
  }

  // GhosttyTerminalModeConfig { GhosttyMode mode(uint16); bool value; } のレイアウト（4バイト）。
  // modeを埋めてghostty_terminal_get(DATA_MODE)を呼ぶと、valueに現在値が返る
  const modeConfig = new Uint8Array(4);
  const modeConfigView = new DataView(modeConfig.buffer);

  function modeEnabled(mode: number): boolean {
    modeConfigView.setUint16(0, mode, true);
    const rc = vt.symbols.ghostty_terminal_get(term, DATA_MODE, ptr(modeConfig));
    return rc === 0 && modeConfig[2] !== 0;
  }

  /** bracketed pasteモード（DEC 2004）が有効か */
  function bracketedPaste(): boolean {
    return modeEnabled(MODE_BRACKETED_PASTE);
  }

  /** ペースト文字列をPTY書き込み用に整形する（危険バイト除去 + bracketed paste包み） */
  function encodePaste(text: string): Uint8Array {
    if (text.length === 0) return new Uint8Array(0);
    const bracketed = bracketedPaste();
    // ghostty_paste_encodeは入力をin-placeで書き換えるため毎回コピーを渡す
    const src = new TextEncoder().encode(text);
    let buf = new Uint8Array(src.length + 16);
    for (;;) {
      const data = src.slice();
      const rc = vt.symbols.ghostty_paste_encode(
        ptr(data),
        BigInt(data.length),
        bracketed,
        ptr(buf),
        BigInt(buf.length),
        ptr(writtenBuf),
      );
      const written = Number(writtenBuf[0]);
      if (rc === 0) return buf.subarray(0, written);
      if (written > buf.length) {
        buf = new Uint8Array(written);
        continue;
      }
      throw new Error(`ghostty_paste_encode failed: ${rc}`);
    }
  }

  function write(data: Uint8Array): void {
    if (data.length === 0) return;
    vt.symbols.ghostty_terminal_vt_write(term, ptr(data), BigInt(data.length));
  }

  /**
   * セルの実寸（webview側の実測値）を控える。マウス座標のピクセル→グリッド変換と、
   * Kitty graphicsの画像が何セル分を占めるかの計算に使う。
   * グリッド（cols/rows）が変わらないリサイズでも呼ばれるためresizeとは別入口にしている
   */
  function setCellSize(cellWidthPx: number, cellHeightPx: number): void {
    const changed =
      Math.round(cellWidthPx) !== Math.round(currentCellWidthPx) ||
      Math.round(cellHeightPx) !== Math.round(currentCellHeightPx);
    currentCellWidthPx = cellWidthPx;
    currentCellHeightPx = cellHeightPx;
    // libghostty-vt側のセル寸法はresize経由でしか変えられない。グリッドが同じならピクセル寸法の
    // 更新だけで済むが、同期出力モード（DEC 2026）も解除されるため変わったときだけ呼ぶ
    if (changed) resizeTerminal();
  }

  function resizeTerminal(): void {
    vt.symbols.ghostty_terminal_resize(
      term,
      currentCols,
      currentRows,
      Math.round(currentCellWidthPx),
      Math.round(currentCellHeightPx),
    );
  }

  function resize(cols: number, rows: number, cellWidthPx: number, cellHeightPx: number): void {
    currentCols = cols;
    currentRows = rows;
    currentCellWidthPx = cellWidthPx;
    currentCellHeightPx = cellHeightPx;
    resizeTerminal();
  }

  // ---- マウスレポート（TUIアプリ向けのマウス操作転送）----
  // エンコーダとイベントは使うタブでだけ確保し、以降は使い回す
  let mouseEncoder: Pointer | null = null;
  let mouseEvent: Pointer | null = null;
  let lastMouseModeSig = -1;
  let lastMouseSizeSig = "";
  // GhosttyMouseEncoderSize { size_t size; uint32 screen_w/h, cell_w/h, padding x4 }
  const mouseSizeBuf = new Uint8Array(40);
  const mouseSizeView = new DataView(mouseSizeBuf.buffer);
  const mouseFlagBuf = new Uint8Array(1);
  // SGR形式でも `ESC [ < 65;220;60 M` 程度。out_of_spaceになったら伸ばす
  let mouseOutBuf = new Uint8Array(64);

  /** アプリがマウスレポート（DECSET 9/1000/1002/1003のいずれか）を有効にしているか */
  function mouseTracking(): boolean {
    const rc = vt.symbols.ghostty_terminal_get(term, DATA_MOUSE_TRACKING, ptr(u8Out));
    return rc === 0 && u8Out[0] !== 0;
  }

  /** ボタンを押していない間の移動も報告する必要があるモード（DECSET 1003）か */
  function mouseAnyMotion(): boolean {
    return modeEnabled(MODE_MOUSE_ANY_EVENT);
  }

  /** アプリがOSC 22で指定したマウスポインタの形。指定が無ければ"text" */
  function mouseShape(): MouseShape {
    const rc = vt.symbols.ghostty_terminal_get(term, DATA_MOUSE_SHAPE, ptr(i32Out));
    if (rc !== 0) return "text";
    return MOUSE_SHAPES[i32Out[0] ?? 0] ?? "text";
  }

  function ensureMouseEncoder(): boolean {
    if (mouseEncoder && mouseEvent) return true;
    const encoderHandle = new BigUint64Array(1);
    if (vt.symbols.ghostty_mouse_encoder_new(null, ptr(encoderHandle)) !== 0) return false;
    mouseEncoder = read.ptr(ptr(encoderHandle)) as Pointer;
    const eventHandle = new BigUint64Array(1);
    if (vt.symbols.ghostty_mouse_event_new(null, ptr(eventHandle)) !== 0) {
      vt.symbols.ghostty_mouse_encoder_free(mouseEncoder);
      mouseEncoder = null;
      return false;
    }
    mouseEvent = read.ptr(ptr(eventHandle)) as Pointer;
    // 同一セル内での移動イベントを間引かせる（SGR-Pixels時はライブラリ側が間引かない）
    mouseFlagBuf[0] = 1;
    vt.symbols.ghostty_mouse_encoder_setopt(
      mouseEncoder,
      MOUSE_OPT_TRACK_LAST_CELL,
      ptr(mouseFlagBuf),
    );
    return true;
  }

  /**
   * トラッキングモード・フォーマット・サイズをエンコーダへ反映する。
   * setopt系はどちらも呼ぶたびに移動イベントの重複排除状態（last_cell）を捨てるため、
   * 実際に変わった時だけ呼ぶ
   */
  function syncMouseEncoderOptions(encoder: Pointer): void {
    let modeSig = 0;
    for (const [i, mode] of MOUSE_MODES.entries()) {
      if (modeEnabled(mode)) modeSig |= 1 << i;
    }
    if (modeSig !== lastMouseModeSig) {
      lastMouseModeSig = modeSig;
      vt.symbols.ghostty_mouse_encoder_setopt_from_terminal(encoder, term);
    }

    const sizeSig = `${currentCols}x${currentRows}x${currentCellWidthPx}x${currentCellHeightPx}`;
    if (sizeSig === lastMouseSizeSig) return;
    lastMouseSizeSig = sizeSig;
    const cellWidth = Math.max(1, Math.round(currentCellWidthPx));
    const cellHeight = Math.max(1, Math.round(currentCellHeightPx));
    mouseSizeView.setBigUint64(0, BigInt(mouseSizeBuf.length), true);
    // paddingは持たない（.termの左上=グリッドの左上）ため、画面サイズはグリッド全体の実寸
    mouseSizeView.setUint32(8, currentCols * cellWidth, true);
    mouseSizeView.setUint32(12, currentRows * cellHeight, true);
    mouseSizeView.setUint32(16, cellWidth, true);
    mouseSizeView.setUint32(20, cellHeight, true);
    for (let offset = 24; offset < 40; offset += 4) mouseSizeView.setUint32(offset, 0, true);
    vt.symbols.ghostty_mouse_encoder_setopt(encoder, MOUSE_OPT_SIZE, ptr(mouseSizeBuf));
  }

  /**
   * マウス操作をアプリ向けのエスケープシーケンスへ変換する。
   * 現在のモードで報告対象外のイベント（1002でのボタン無し移動、同一セル内の移動など）は
   * 空を返すので、呼び出し側はそのままPTYへ書けばよい
   */
  function encodeMouse(ev: MouseEventInput): Uint8Array {
    // セルサイズが未確定（webview側の実測resize到達前）ならグリッド座標へ変換できない
    if (currentCellWidthPx <= 0 || currentCellHeightPx <= 0) return EMPTY_BYTES;
    if (!ensureMouseEncoder() || !mouseEncoder || !mouseEvent) return EMPTY_BYTES;
    syncMouseEncoderOptions(mouseEncoder);

    vt.symbols.ghostty_mouse_event_set_action(mouseEvent, MOUSE_ACTIONS[ev.action]);
    if (ev.button === null) {
      vt.symbols.ghostty_mouse_event_clear_button(mouseEvent);
    } else {
      vt.symbols.ghostty_mouse_event_set_button(mouseEvent, MOUSE_BUTTONS[ev.button]);
    }
    let mods = 0;
    if (ev.mods.shift) mods |= MODS_SHIFT;
    if (ev.mods.ctrl) mods |= MODS_CTRL;
    if (ev.mods.alt) mods |= MODS_ALT;
    if (ev.mods.super) mods |= MODS_SUPER;
    vt.symbols.ghostty_mouse_event_set_mods(mouseEvent, mods);
    shim.symbols.niwa_mouse_event_set_position(mouseEvent, ev.x, ev.y);

    mouseFlagBuf[0] = ev.anyButtonPressed ? 1 : 0;
    vt.symbols.ghostty_mouse_encoder_setopt(
      mouseEncoder,
      MOUSE_OPT_ANY_BUTTON_PRESSED,
      ptr(mouseFlagBuf),
    );

    for (;;) {
      const rc = vt.symbols.ghostty_mouse_encoder_encode(
        mouseEncoder,
        mouseEvent,
        ptr(mouseOutBuf),
        BigInt(mouseOutBuf.length),
        ptr(writtenBuf),
      );
      const written = Number(writtenBuf[0]);
      if (rc === 0) return mouseOutBuf.subarray(0, written);
      if (written > mouseOutBuf.length) {
        mouseOutBuf = new Uint8Array(written);
        continue;
      }
      throw new Error(`ghostty_mouse_encoder_encode failed: ${rc}`);
    }
  }

  function cursor(): CursorState {
    vt.symbols.ghostty_terminal_get(term, DATA_CURSOR_X, ptr(u16Out));
    const x = u16Out[0] ?? 0;
    vt.symbols.ghostty_terminal_get(term, DATA_CURSOR_Y, ptr(u16Out));
    const y = u16Out[0] ?? 0;
    vt.symbols.ghostty_terminal_get(term, DATA_CURSOR_VISIBLE, ptr(u8Out));
    const visible = u8Out[0] !== 0;

    vt.symbols.ghostty_render_state_update(renderState, term);
    vt.symbols.ghostty_render_state_get(renderState, RENDER_DATA_CURSOR_VISUAL_STYLE, ptr(i32Out));
    const shape = CURSOR_SHAPES[i32Out[0] ?? 1] ?? "block";

    return { x, y, visible, shape };
  }

  /**
   * 画面内容を文字列として取り出す関数を作る（HTML/PLAINで共用）。
   * useViewport=trueならスクロールした位置（ghostty_terminal_scroll_viewport）に追従し、
   * falseなら常に最新のアクティブエリア（スクロールバック無視）を返す
   */
  function createFormatterDumper(emit: number, useViewport: boolean): () => string {
    let buf = new Uint8Array(256 * 1024);
    return function dump(): string {
      for (;;) {
        const rc = shim.symbols.niwa_dump_screen(
          term,
          emit,
          useViewport ? 1 : 0,
          ptr(buf),
          BigInt(buf.length),
          ptr(writtenBuf),
        );
        const written = Number(writtenBuf[0]);
        if (rc === 0) {
          return new TextDecoder().decode(buf.subarray(0, written));
        }
        if (written > buf.length) {
          buf = new Uint8Array(written + 1024);
          continue;
        }
        throw new Error(`niwa_dump_screen failed: ${rc}`);
      }
    };
  }

  /** 現在の画面をHTML文字列として取り出す。スクロール中はその位置の内容を返す */
  const dumpHtml = createFormatterDumper(FORMAT_HTML, true);

  /** 現在の画面をプレーンテキストとして取り出す（CLIの`tab capture`相当）。常に最新のアクティブエリア */
  const dumpText = createFormatterDumper(FORMAT_PLAIN, false);

  /**
   * 画面座標（スクロールバックを含む絶対行）の矩形範囲を文字列として取り出す。
   * コピーモードのように「ビューポートの外まで含む任意の範囲」を扱う用途向けで、
   * unwrap（折り返し行の連結）・trim（行末空白の除去）はヤンク時のみ有効にする
   */
  function dumpScreenRange(opts: {
    startX: number;
    startY: number;
    endX: number;
    endY: number;
    emit?: number;
    rectangle?: boolean;
    unwrap?: boolean;
    trim?: boolean;
  }): string {
    // NiwaDumpSelectionOptions（src/native/shim.c）と同じ並び順
    dumpSelectionOpts[0] = opts.emit ?? FORMAT_PLAIN;
    dumpSelectionOpts[1] = POINT_TAG_SCREEN;
    dumpSelectionOpts[2] = Math.max(Math.trunc(opts.startX), 0);
    dumpSelectionOpts[3] = Math.max(Math.trunc(opts.startY), 0);
    dumpSelectionOpts[4] = Math.max(Math.trunc(opts.endX), 0);
    dumpSelectionOpts[5] = Math.max(Math.trunc(opts.endY), 0);
    dumpSelectionOpts[6] = opts.rectangle ? 1 : 0;
    dumpSelectionOpts[7] = opts.unwrap ? 1 : 0;
    dumpSelectionOpts[8] = opts.trim ? 1 : 0;
    let buf = new Uint8Array(64 * 1024);
    for (;;) {
      const rc = shim.symbols.niwa_dump_selection(
        term,
        ptr(dumpSelectionOpts),
        ptr(buf),
        BigInt(buf.length),
        ptr(writtenBuf),
      );
      const written = Number(writtenBuf[0]);
      if (rc === 0) return new TextDecoder().decode(buf.subarray(0, written));
      if (written > buf.length) {
        buf = new Uint8Array(written + 1024);
        continue;
      }
      // 範囲外の行（スクロールバックの外へ流れた行など）はGHOSTTY_INVALID_VALUEになる。
      // コピーモード側は「行が取れなかった」ことを空文字で判断できればよいので例外にはしない
      return "";
    }
  }

  /**
   * OSC 133でマークされたプロンプトを、画面座標のfromYからdirection方向へ探す。
   * fromY自身は含めない（同じプロンプトへ止まり続けないため）。見つからなければnull。
   *
   * 複数行プロンプト・折り返したプロンプトの2行目以降はcontinuationとして別扱いされるので、
   * 1つのプロンプトにつき1回だけ止まる。シェルがOSC 133を出さない環境では常にnullになる
   */
  function findPrompt(fromY: number, direction: "up" | "down"): PromptLocation | null {
    const lastRow = Math.max(scrollbar().total, 1) - 1;
    const start = direction === "up" ? Math.trunc(fromY) - 1 : Math.trunc(fromY) + 1;
    if (start < 0 || start > lastRow) return null;
    const rc = shim.symbols.niwa_find_prompt(
      term,
      start,
      direction === "up" ? -1 : 1,
      direction === "up" ? 0 : lastRow,
      ptr(promptLocation),
    );
    if (rc !== 0) return null;
    return { row: promptLocation[0] ?? 0, inputRow: promptLocation[1] ?? 0 };
  }

  /** 検索文字列を差し替える。同じ文字列なら何もしない（libghostty-vt側の走査結果を捨てないため） */
  function setSearchNeedle(needle: string): boolean {
    if (search === null) {
      if (needle === "") return true;
      const searchHandle = new BigUint64Array(1);
      if (vt.symbols.ghostty_search_new(null, ptr(searchHandle), term) !== 0) return false;
      search = read.ptr(ptr(searchHandle)) as Pointer;
    }
    if (needle === searchNeedle) return true;
    // ptr()は長さ0の配列を受け付けないため、空文字列のときもダミーの1バイトを指す
    // （shim側はlenが0ならNULLとして検索を止める）
    const bytes = needle === "" ? new Uint8Array(1) : new TextEncoder().encode(needle);
    const len = needle === "" ? 0 : bytes.length;
    if (shim.symbols.niwa_search_set_needle(search, ptr(bytes), BigInt(len)) !== 0) return false;
    searchNeedle = needle;
    return true;
  }

  /**
   * スクロールバックを含む画面からneedleの一致を探す。ASCIIの英字だけは大文字小文字を区別しない。
   * scopeが"all"ならスクロールバック全体を走査し終えるまでブロックし、"viewport"ならビューポートに
   * 掛かる一致だけを軽く集める（後者は同じページに載ったビューポート外の一致も含むことがある）。
   * 同じneedleで呼び直すと、前回までの走査結果へ端末の変化分だけを反映して返す
   */
  function searchMatches(needle: string, scope: "all" | "viewport"): SearchMatch[] {
    if (needle === "" || !setSearchNeedle(needle) || search === null) return [];
    for (;;) {
      const rc = shim.symbols.niwa_search_matches(
        term,
        search,
        scope === "viewport" ? 1 : 0,
        ptr(searchMatchBuf),
        BigInt(searchMatchBuf.length / 4),
        ptr(writtenBuf),
      );
      const count = Number(writtenBuf[0]);
      if (rc === RESULT_OUT_OF_SPACE && count * 4 > searchMatchBuf.length) {
        searchMatchBuf = new Int32Array(count * 4);
        continue;
      }
      if (rc !== 0) return [];
      const matches: SearchMatch[] = [];
      for (let i = 0; i < count; i++) {
        const o = i * 4;
        matches.push({
          start: { x: searchMatchBuf[o] ?? 0, y: searchMatchBuf[o + 1] ?? 0 },
          end: { x: searchMatchBuf[o + 2] ?? 0, y: searchMatchBuf[o + 3] ?? 0 },
        });
      }
      return matches;
    }
  }

  /** 検索をやめる。検索文字列を外すと、libghostty-vtが端末内に持つ追跡用の状態も解放される */
  function clearSearch(): void {
    setSearchNeedle("");
  }

  /**
   * ビューポートの位置と全体の行数（GhosttyTerminalScrollbar）。
   * offsetはビューポート先頭の画面座標行で、scrollToRowへそのまま渡せる同じ行空間
   */
  function scrollbar(): { total: number; offset: number; len: number } {
    const rc = vt.symbols.ghostty_terminal_get(term, DATA_SCROLLBAR, ptr(scrollbarBuf));
    if (rc !== 0) return { total: rows, offset: 0, len: rows };
    return {
      total: Number(scrollbarView.getBigUint64(0, true)),
      offset: Number(scrollbarView.getBigUint64(8, true)),
      len: Number(scrollbarView.getBigUint64(16, true)),
    };
  }

  /** ビューポート先頭をスクロールバック最上行から数えた絶対行へ合わせる（scrollbar().offsetと同じ行空間） */
  function scrollToRow(row: number): void {
    shim.symbols.niwa_scroll_viewport(
      term,
      SCROLL_VIEWPORT_ROW,
      BigInt(Math.max(Math.trunc(row), 0)),
    );
  }

  /** ビューポートがアクティブエリア（最新行）に追従しているか。falseはスクロールバックへ入っている状態 */
  function viewportPinned(): boolean {
    const rc = vt.symbols.ghostty_terminal_get(term, DATA_VIEWPORT_ACTIVE, ptr(u8Out));
    return rc !== 0 || u8Out[0] !== 0;
  }

  /** ビューポートを相対行数だけスクロールする（上がマイナス）。範囲外は自動でクランプされる */
  function scrollDelta(lines: number): void {
    if (lines === 0) return;
    shim.symbols.niwa_scroll_viewport(term, SCROLL_VIEWPORT_DELTA, BigInt(Math.trunc(lines)));
  }

  /**
   * ビューポートの先頭を、OSC 133でマークされたプロンプトの1行目へ相対プロンプト数だけ動かす
   * （前がマイナス）。複数行プロンプトの継続行には止まらず、プロンプトが無ければ何もしない。
   * アクティブエリア内のプロンプトを指したときはアクティブエリアへ戻る（それより下へはスクロールできないため）
   */
  function scrollPrompt(delta: number): void {
    if (delta === 0) return;
    shim.symbols.niwa_scroll_viewport(
      term,
      SCROLL_VIEWPORT_DELTA_PROMPT,
      BigInt(Math.trunc(delta)),
    );
  }

  /** ビューポートをスクロールバックの先頭へ移動する */
  function scrollToTop(): void {
    shim.symbols.niwa_scroll_viewport(term, SCROLL_VIEWPORT_TOP, 0n);
  }

  /** ビューポートを最新のアクティブエリアへ戻す */
  function scrollToBottom(): void {
    shim.symbols.niwa_scroll_viewport(term, SCROLL_VIEWPORT_BOTTOM, 0n);
  }

  /**
   * スクロールバックとして保持する行数の上限を設定する。生成後も変更でき、
   * 下げた場合はその時点で上限を超える履歴が破棄される。
   * libghostty側の刈り込みはページ単位のため、実際に残る行数は指定値より数十〜百行ほど多くなる
   */
  function setScrollbackMaxLines(lines: number): void {
    const limit = new BigUint64Array([BigInt(lines)]);
    vt.symbols.ghostty_terminal_set(term, OPT_SCROLLBACK_MAX_LINES, ptr(limit));
  }

  function free(): void {
    // 端末より先に解放すると、検索が端末内に持つ追跡用の状態もここで片付く
    if (search) vt.symbols.ghostty_search_free(search);
    search = null;
    if (mouseEvent) vt.symbols.ghostty_mouse_event_free(mouseEvent);
    if (mouseEncoder) vt.symbols.ghostty_mouse_encoder_free(mouseEncoder);
    mouseEvent = null;
    mouseEncoder = null;
    vt.symbols.ghostty_render_state_free(renderState);
    vt.symbols.ghostty_kitty_graphics_placement_iterator_free(kittyIterator);
    vt.symbols.ghostty_terminal_free(term);
    writePtyCallback?.close();
    clipboardCallback?.close();
    pwdChangedCallback?.close();
    bellCallback?.close();
    semanticPromptCallback?.close();
    sizeCallback.close();
  }

  return {
    onWritePty,
    onClipboardWrite,
    onPwdChanged,
    onBell,
    onSemanticPrompt,
    bracketedPaste,
    encodePaste,
    mouseTracking,
    mouseAnyMotion,
    mouseShape,
    encodeMouse,
    write,
    resize,
    setCellSize,
    cursor,
    kittyGraphics,
    dumpHtml,
    dumpText,
    dumpScreenRange,
    findPrompt,
    searchMatches,
    clearSearch,
    scrollbar,
    viewportPinned,
    scrollDelta,
    scrollToRow,
    scrollPrompt,
    scrollToTop,
    scrollToBottom,
    setScrollbackMaxLines,
    free,
  };
}

export type GhosttyTerminal = ReturnType<typeof createGhosttyTerminal>;
