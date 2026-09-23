// macOS向けデスクトップ通知ヘルパー（src/native/macnotify.m）のbun:ffiラッパー。
// ElectrobunのUtils.showNotificationではクリックされた通知を識別できないため、
// 通知元タブへの遷移が必要なmacOSだけ自前実装に差し替える。理由の詳細はmacnotify.mのヘッダコメント参照。
import type { NiwaNotifyOptions } from "@niwaterm/config";
import { dlopen, FFIType } from "bun:ffi";
import { join } from "node:path";
import { findNativeArtifact } from "./native-artifacts";

const DYLIB_REL_PATH = join("vendor", "libghostty", "lib", "libniwamacnotify.dylib");

/** tabIdはUUID程度の長さなので余裕を持った固定長で受ける */
const POLL_BUF_SIZE = 256;

export interface MacNotifier {
  send(opts: NiwaNotifyOptions): void;
  /** クリックされた通知のtabIdを古い順に1件取り出す。無ければnull */
  pollClickedTabId(): string | null;
}

function cString(value: string | undefined): Buffer | null {
  return value === undefined ? null : Buffer.from(`${value}\0`, "utf8");
}

/**
 * macOSの通知ヘルパーを読み込む。macOS以外・未ビルド・読み込み失敗時はnullを返す
 * （呼び出し元はElectrobunのUtils.showNotificationへフォールバックする）
 */
export function createMacNotifier(): MacNotifier | null {
  if (process.platform !== "darwin") return null;

  const dylibPath = findNativeArtifact(DYLIB_REL_PATH);
  if (!dylibPath) {
    console.log(`[bun] ${DYLIB_REL_PATH} が見つからない。\`mise run build:native\` が必要`);
    return null;
  }

  try {
    const lib = dlopen(dylibPath, {
      niwa_mac_notify_init: { args: [], returns: FFIType.i32 },
      niwa_mac_notify_show: {
        args: [FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.i32, FFIType.ptr],
        returns: FFIType.void,
      },
      niwa_mac_notify_poll_click: { args: [FFIType.ptr, FFIType.i32], returns: FFIType.i32 },
    });
    const rc = lib.symbols.niwa_mac_notify_init();
    if (rc !== 0) {
      console.log(`[bun] mac notification init failed: rc=${rc}`);
      return null;
    }

    const pollBuf = Buffer.alloc(POLL_BUF_SIZE);
    return {
      send(opts) {
        lib.symbols.niwa_mac_notify_show(
          cString(opts.title),
          cString(opts.body),
          cString(opts.subtitle),
          opts.silent ? 1 : 0,
          cString(opts.tabId),
        );
      },
      pollClickedTabId() {
        // -1（bufに収まらない）の1件はネイティブ側で捨てられるので、次を読みに行く
        for (;;) {
          const n = lib.symbols.niwa_mac_notify_poll_click(pollBuf, POLL_BUF_SIZE);
          if (n === 0) return null;
          if (n > 0) return pollBuf.toString("utf8", 0, n);
        }
      },
    };
  } catch (err: unknown) {
    console.log(`[bun] failed to load ${DYLIB_REL_PATH}: ${String(err)}`);
    return null;
  }
}
