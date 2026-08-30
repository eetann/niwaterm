// ネイティブ成果物（vendor/libghostty配下のdylib・DLL・ヘルパー実行ファイル）の探索。
// アプリはbuild/配下のappバンドル内から実行されるため、repoルートのvendor/を
// 上方向へ辿って探す必要がある（成果物はappバンドルへコピーしていない）。
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";

/** 上方向へ辿る最大段数（build/<app名>/<channel-os-arch>/<name>.app/Contents/MacOS からrepoルートまで届く深さ） */
const MAX_DEPTH = 10;

/**
 * repoルート相対のパス（例: `vendor/libghostty/lib/libghostty-vt.dylib`）を、
 * process.cwd()から上方向へ辿って探す。見つからなければundefined
 */
export function findNativeArtifact(relPath: string): string | undefined {
  let dir = process.cwd();
  for (let i = 0; i < MAX_DEPTH; i++) {
    const candidate = join(dir, relPath);
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return undefined;
}
