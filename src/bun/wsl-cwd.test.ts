import { describe, expect, test } from "bun:test";
import { extractWslDistro, resolveActualCwd } from "./wsl-cwd";

describe("extractWslDistro", () => {
  test("wsl.exe -d <distro>形式からディストロ名を抽出する", () => {
    expect(extractWslDistro("wsl.exe -d NixOS")).toBe("NixOS");
  });

  test("大文字小文字を区別しない", () => {
    expect(extractWslDistro("WSL.EXE -d Ubuntu")).toBe("Ubuntu");
  });

  test("wsl.exe以外のコマンドはnullを返す", () => {
    expect(extractWslDistro("powershell.exe -NoLogo")).toBeNull();
  });

  test("未指定（undefined）はnullを返す", () => {
    expect(extractWslDistro(undefined)).toBeNull();
  });
});

describe("resolveActualCwd", () => {
  test("win32以外のプラットフォームでは常に生の値のまま返す", () => {
    expect(resolveActualCwd("/home/user/project", "wsl.exe -d NixOS", "darwin")).toBe(
      "/home/user/project",
    );
    expect(resolveActualCwd("/home/user/project", "wsl.exe -d NixOS", "linux")).toBe(
      "/home/user/project",
    );
  });

  test("win32かつWSLプロファイルのLinuxパスはUNC形式へ変換する", () => {
    expect(resolveActualCwd("/home/user/project", "wsl.exe -d NixOS", "win32")).toBe(
      "\\\\wsl.localhost\\NixOS\\home\\user\\project",
    );
  });

  test("win32かつWSLプロファイル以外（PowerShell等）のcwdはそのまま返す", () => {
    expect(resolveActualCwd("C:\\Users\\foo", "powershell.exe -NoLogo", "win32")).toBe(
      "C:\\Users\\foo",
    );
  });

  test("win32だがシェルコマンド未記録（例: 初期タブでgetDefaultShell未設定）はそのまま返す", () => {
    expect(resolveActualCwd("/home/user/project", undefined, "win32")).toBe("/home/user/project");
  });

  test("win32でLinuxパス形式でない値（先頭がスラッシュでない）はそのまま返す", () => {
    expect(resolveActualCwd("C:\\already\\windows", "wsl.exe -d NixOS", "win32")).toBe(
      "C:\\already\\windows",
    );
  });
});
