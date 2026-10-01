import { afterEach, describe, expect, test } from "bun:test";
import {
  AppVariantMismatchError,
  type IpcEndpoint,
  pingNiwaterm,
  toAppAccessiblePath,
  verifyAppVariant,
} from "./ipc-client";

const TCP: IpcEndpoint = { kind: "tcp", hosts: ["127.0.0.1"], port: 1234 };
const UNIX: IpcEndpoint = { kind: "unix", path: "/tmp/niwaterm.sock" };

const originalDistro = process.env["WSL_DISTRO_NAME"];

afterEach(() => {
  if (originalDistro === undefined) delete process.env["WSL_DISTRO_NAME"];
  else process.env["WSL_DISTRO_NAME"] = originalDistro;
});

describe("toAppAccessiblePath", () => {
  test("WSLブリッジ越しのLinuxパスはUNC形式へ変換する", () => {
    process.env["WSL_DISTRO_NAME"] = "NixOS";
    expect(toAppAccessiblePath(TCP, "/home/eetann/proj")).toBe(
      "\\\\wsl.localhost\\NixOS\\home\\eetann\\proj",
    );
  });

  test("ドライブマウント配下はディストロ名を挟まずドライブレターへ戻す", () => {
    process.env["WSL_DISTRO_NAME"] = "NixOS";
    expect(toAppAccessiblePath(TCP, "/mnt/c/Users/eetann/proj")).toBe("C:\\Users\\eetann\\proj");
  });

  test("ドライブマウント配下はWSL_DISTRO_NAMEが無くても変換する", () => {
    delete process.env["WSL_DISTRO_NAME"];
    expect(toAppAccessiblePath(TCP, "/mnt/d/work")).toBe("D:\\work");
  });

  test("WSLブリッジ以外（unixソケット接続）は書き換えない", () => {
    process.env["WSL_DISTRO_NAME"] = "NixOS";
    expect(toAppAccessiblePath(UNIX, "/mnt/c/Users/eetann/proj")).toBe("/mnt/c/Users/eetann/proj");
  });

  test("WSL_DISTRO_NAME未設定のLinuxパス・絶対パスでない値はそのまま返す", () => {
    delete process.env["WSL_DISTRO_NAME"];
    expect(toAppAccessiblePath(TCP, "/home/eetann/proj")).toBe("/home/eetann/proj");
    process.env["WSL_DISTRO_NAME"] = "NixOS";
    expect(toAppAccessiblePath(TCP, "relative/path")).toBe("relative/path");
  });
});

describe("verifyAppVariant", () => {
  const withVariant = (variant: string | null) =>
    new Response("{}", { headers: variant ? { "x-niwaterm-app-variant": variant } : {} });
  const WIP_TCP: IpcEndpoint = { ...TCP, appVariant: "niwaterm-wip" };

  test("狙ったインスタンスからの応答は通す", () => {
    expect(() => verifyAppVariant(WIP_TCP, withVariant("niwaterm-wip"))).not.toThrow();
  });

  test("別インスタンスからの応答は弾く", () => {
    expect(() => verifyAppVariant(WIP_TCP, withVariant("niwaterm-daily"))).toThrow(
      AppVariantMismatchError,
    );
  });

  test("アプリ名ヘッダの無い応答も弾く", () => {
    expect(() => verifyAppVariant(WIP_TCP, withVariant(null))).toThrow(AppVariantMismatchError);
  });

  test("期待するアプリ名が無いtcp・unixソケットは確かめない", () => {
    expect(() => verifyAppVariant(TCP, withVariant("niwaterm-daily"))).not.toThrow();
    expect(() => verifyAppVariant(UNIX, withVariant(null))).not.toThrow();
  });
});

describe("pingNiwaterm", () => {
  test("ポートを別インスタンスが掴んでいたら接続失敗にする", async () => {
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: () =>
        Response.json(
          { ok: true, pid: 1 },
          { headers: { "x-niwaterm-app-variant": "niwaterm-daily" } },
        ),
    });
    try {
      const endpoint: IpcEndpoint = {
        kind: "tcp",
        hosts: ["127.0.0.1"],
        port: server.port as number,
        appVariant: "niwaterm-wip",
      };
      const result = await pingNiwaterm(endpoint);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toContain("niwaterm-daily");
      expect(await pingNiwaterm({ ...endpoint, appVariant: "niwaterm-daily" })).toEqual({
        ok: true,
        pid: 1,
      });
    } finally {
      server.stop(true);
    }
  });
});
