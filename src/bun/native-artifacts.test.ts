import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findNativeArtifact } from "./native-artifacts";

/** process.cwdを一時的に差し替えて関数を実行する（findNativeArtifactはcwd起点で上方向へ探すため） */
function withCwd<T>(dir: string, fn: () => T): T {
  const original = process.cwd();
  process.chdir(dir);
  try {
    return fn();
  } finally {
    process.chdir(original);
  }
}

describe("findNativeArtifact", () => {
  test("cwdから上方向へ辿って成果物を見つける", () => {
    // macOSのtmpdirは/var -> /private/varのシンボリックリンクで、process.chdir後のcwdは
    // 解決済みパスになるためrealpathSyncで揃える
    const root = realpathSync(mkdtempSync(join(tmpdir(), "niwaterm-native-")));
    mkdirSync(join(root, "vendor/libghostty/lib"), { recursive: true });
    writeFileSync(join(root, "vendor/libghostty/lib/niwaterm-ptyexec"), "");
    const deep = join(root, "build/niwaterm-wip/dev-macos-arm64/app/Contents/MacOS");
    mkdirSync(deep, { recursive: true });

    const found = withCwd(deep, () => findNativeArtifact("vendor/libghostty/lib/niwaterm-ptyexec"));
    expect(found).toBe(join(root, "vendor/libghostty/lib/niwaterm-ptyexec"));
  });

  test("見つからない場合はundefinedを返す（例外にしない）", () => {
    // macOSのtmpdirは/var -> /private/varのシンボリックリンクで、process.chdir後のcwdは
    // 解決済みパスになるためrealpathSyncで揃える
    const root = realpathSync(mkdtempSync(join(tmpdir(), "niwaterm-native-")));
    expect(withCwd(root, () => findNativeArtifact("vendor/libghostty/lib/no-such-file"))).toBe(
      undefined,
    );
  });
});
