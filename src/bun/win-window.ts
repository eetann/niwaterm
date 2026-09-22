// Windowsのウィンドウ透過ヘルパー（src/native/winwindow.c）のbun:ffiラッパー。
// Electrobunの`transparent: true`だけではネイティブ枠が描画されなくなるため、
// 生成後にDWM側の透過へ切り替え直す。理由の詳細はwinwindow.cのヘッダコメント参照。
import { dlopen, FFIType } from "bun:ffi";
import { join } from "node:path";
import { findNativeArtifact } from "./native-artifacts";

const DLL_REL_PATH = join("vendor", "libghostty", "bin", "niwawin.dll");

const RESULT_MESSAGES: Record<number, string> = {
  [-1]: "対象のウィンドウが見つからない",
  [-2]: "DwmEnableBlurBehindWindowが失敗した",
  [-3]: "DwmExtendFrameIntoClientAreaが失敗した",
  [-4]: "ウィンドウプロシージャの差し替えが失敗した",
};

/**
 * ネイティブ枠（タイトルバー・リサイズ枠）を保ったまま、ウィンドウ背景の透過を有効にする。
 * まだ処理していないウィンドウすべてが対象なので、ウィンドウを開くたびに呼ぶ。
 * Windows以外では何もしない。成功可否はログにのみ出し、失敗しても起動は続行する
 * （透過が効かないだけで、ターミナルとしては動作するため）
 */
export function enableWindowTransparency(): void {
  if (process.platform !== "win32") return;

  const dllPath = findNativeArtifact(DLL_REL_PATH);
  if (!dllPath) {
    console.log(`[bun] ${DLL_REL_PATH} が見つからない。\`mise run build:native\` が必要`);
    return;
  }

  try {
    const lib = dlopen(dllPath, {
      niwa_win_enable_window_transparency: { args: [], returns: FFIType.i32 },
    });
    const rc = lib.symbols.niwa_win_enable_window_transparency();
    if (rc !== 0) {
      console.log(`[bun] window transparency failed: ${RESULT_MESSAGES[rc] ?? `rc=${rc}`}`);
      return;
    }
    console.log("[bun] window transparency enabled");
  } catch (err: unknown) {
    console.log(`[bun] failed to load ${DLL_REL_PATH}: ${String(err)}`);
  }
}
