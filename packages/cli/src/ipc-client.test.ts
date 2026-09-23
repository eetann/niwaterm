import { afterEach, describe, expect, test } from "bun:test";
import { type IpcEndpoint, toAppAccessiblePath } from "./ipc-client";

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
