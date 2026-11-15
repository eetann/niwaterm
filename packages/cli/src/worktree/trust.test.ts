import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaultTrustDirPath, ensureProjectTrust, projectTrustKey } from "./trust";

// 承認ストアの既定はhomedir()配下。homedir()はHOME環境変数を見ないため、環境変数では差し替えられない。
// テストからは必ずtrustDirを明示して実ホームを汚さないようにする
let trustDir: string;
let repoRoot: string;

beforeEach(async () => {
  trustDir = await mkdtemp(join(tmpdir(), "niwaterm-trust-store-"));
  repoRoot = await mkdtemp(join(tmpdir(), "niwaterm-trust-repo-"));
});

afterEach(async () => {
  await rm(trustDir, { recursive: true, force: true });
  await rm(repoRoot, { recursive: true, force: true });
});

async function writeProjectConfig(body: string, name = "config.ts"): Promise<void> {
  await mkdir(join(repoRoot, ".niwaterm"), { recursive: true });
  await Bun.write(join(repoRoot, ".niwaterm", name), body);
}

describe("projectTrustKey", () => {
  test(".niwaterm/が無ければnull", async () => {
    expect(await projectTrustKey(repoRoot)).toBeNull();
  });

  test("同じ内容なら同じ鍵になる", async () => {
    await writeProjectConfig("export default {};\n");
    const first = await projectTrustKey(repoRoot);
    expect(first).not.toBeNull();
    expect(await projectTrustKey(repoRoot)).toBe(first as string);
  });

  test("内容が変わると鍵も変わる", async () => {
    await writeProjectConfig("export default {};\n");
    const before = await projectTrustKey(repoRoot);
    await writeProjectConfig("export default { worktree: { onCreate: () => {} } };\n");
    expect(await projectTrustKey(repoRoot)).not.toBe(before as string);
  });

  test("config.ts以外のファイルが増えても鍵が変わる（importされる可能性があるため）", async () => {
    await writeProjectConfig("export default {};\n");
    const before = await projectTrustKey(repoRoot);
    await writeProjectConfig("export const x = 1;\n", "helper.ts");
    expect(await projectTrustKey(repoRoot)).not.toBe(before as string);
  });

  test("リポジトリのパスが違えば同じ内容でも鍵が変わる", async () => {
    await writeProjectConfig("export default {};\n");
    const key = await projectTrustKey(repoRoot);
    const other = await mkdtemp(join(tmpdir(), "niwaterm-trust-repo-"));
    try {
      await mkdir(join(other, ".niwaterm"), { recursive: true });
      await Bun.write(join(other, ".niwaterm", "config.ts"), "export default {};\n");
      expect(await projectTrustKey(other)).not.toBe(key as string);
    } finally {
      await rm(other, { recursive: true, force: true });
    }
  });

  test("node_modulesは鍵に含めない（巨大になりうるため）", async () => {
    await writeProjectConfig("export default {};\n");
    const before = await projectTrustKey(repoRoot);
    await mkdir(join(repoRoot, ".niwaterm", "node_modules", "pkg"), { recursive: true });
    await Bun.write(join(repoRoot, ".niwaterm", "node_modules", "pkg", "index.js"), "// big\n");
    expect(await projectTrustKey(repoRoot)).toBe(before as string);
  });
});

describe("ensureProjectTrust", () => {
  test("プロジェクトローカル設定が無ければabsent", async () => {
    expect(await ensureProjectTrust(repoRoot, { assumeTrusted: false, trustDir })).toBe("absent");
  });

  test("assumeTrustedなら確認せず承認し、記録が残る", async () => {
    await writeProjectConfig("export default {};\n");
    expect(await ensureProjectTrust(repoRoot, { assumeTrusted: true, trustDir })).toBe("trusted");
    const key = (await projectTrustKey(repoRoot)) as string;
    expect(await Bun.file(join(trustDir, key)).exists()).toBe(true);
  });

  test("承認済みなら次回は確認なしでtrusted", async () => {
    await writeProjectConfig("export default {};\n");
    await ensureProjectTrust(repoRoot, { assumeTrusted: true, trustDir });
    // assumeTrusted=falseかつ非対話でもtrustedのまま（記録を見ているため）
    expect(await ensureProjectTrust(repoRoot, { assumeTrusted: false, trustDir })).toBe("trusted");
  });

  test("承認後に内容が変わったら承認は引き継がれない", async () => {
    await writeProjectConfig("export default {};\n");
    await ensureProjectTrust(repoRoot, { assumeTrusted: true, trustDir });
    await writeProjectConfig("export default { worktree: { onCreate: () => {} } };\n");
    // 非対話環境なので確認できず、declinedになる
    expect(await ensureProjectTrust(repoRoot, { assumeTrusted: false, trustDir })).toBe("declined");
  });

  test("未承認かつ非対話ならdeclined（ハングさせない）", async () => {
    await writeProjectConfig("export default {};\n");
    expect(await ensureProjectTrust(repoRoot, { assumeTrusted: false, trustDir })).toBe("declined");
  });
});

describe("defaultTrustDirPath", () => {
  test("Linux・macOSはXDG_STATE_HOME配下", () => {
    expect(defaultTrustDirPath({ XDG_STATE_HOME: "/state" }, "linux", "/home/u")).toBe(
      join("/state", "niwaterm", "trusted-projects"),
    );
  });

  test("XDG_STATE_HOMEが無ければ~/.local/state配下", () => {
    expect(defaultTrustDirPath({}, "darwin", "/Users/u")).toBe(
      join("/Users/u", ".local", "state", "niwaterm", "trusted-projects"),
    );
  });

  test("WindowsはLOCALAPPDATA配下", () => {
    expect(
      defaultTrustDirPath({ LOCALAPPDATA: "C:/Users/u/AppData/Local" }, "win32", "C:/Users/u"),
    ).toBe(join("C:/Users/u/AppData/Local", "niwaterm", "trusted-projects"));
  });
});
