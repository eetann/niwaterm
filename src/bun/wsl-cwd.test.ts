import { describe, expect, test } from "bun:test";
import {
  applyWslCdArg,
  extractWslDistro,
  resolveActualCwd,
  windowsPathToWslMountPath,
  wslMountPathToWindowsPath,
} from "./wsl-cwd";

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

  test("win32かつWSLプロファイルでもドライブマウント配下はドライブレターへ戻す", () => {
    expect(
      resolveActualCwd("/mnt/c/Users/eetann/AppData/Local/Temp/repo", "wsl.exe -d NixOS", "win32"),
    ).toBe("C:\\Users\\eetann\\AppData\\Local\\Temp\\repo");
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

describe("applyWslCdArg", () => {
  test("win32以外のプラットフォームでは常にcmdを変更せずcwdをそのまま返す", () => {
    const cmd = ["wsl.exe", "-d", "NixOS"];
    expect(applyWslCdArg(cmd, undefined, "darwin")).toBeUndefined();
    expect(cmd).toEqual(["wsl.exe", "-d", "NixOS"]);
  });

  test("win32かつWSLプロファイルでcwd未指定なら--cd ~を追記しcwdはundefinedを返す", () => {
    const cmd = ["wsl.exe", "-d", "NixOS"];
    expect(applyWslCdArg(cmd, undefined, "win32")).toBeUndefined();
    expect(cmd).toEqual(["wsl.exe", "-d", "NixOS", "--cd", "~"]);
  });

  test("win32かつWSLプロファイルでLinuxパスを指定すると--cd <path>を追記しcwdはundefinedを返す", () => {
    const cmd = ["wsl.exe", "-d", "NixOS"];
    expect(applyWslCdArg(cmd, "/home/eetann/projects", "win32")).toBeUndefined();
    expect(cmd).toEqual(["wsl.exe", "-d", "NixOS", "--cd", "/home/eetann/projects"]);
  });

  test("win32かつWSLプロファイル以外（PowerShell等）はcmdを変更せずcwdをそのまま返す", () => {
    const cmd = ["powershell.exe", "-NoLogo"];
    expect(applyWslCdArg(cmd, undefined, "win32")).toBeUndefined();
    expect(applyWslCdArg(cmd, "C:\\Users\\foo", "win32")).toBe("C:\\Users\\foo");
    expect(cmd).toEqual(["powershell.exe", "-NoLogo"]);
  });

  test("win32かつWSLプロファイルでも既にUNC形式（前タブからの継承）のcwdはcmdを変更せずそのまま返す", () => {
    const cmd = ["wsl.exe", "-d", "NixOS"];
    const unc = "\\\\wsl.localhost\\NixOS\\home\\user\\project";
    expect(applyWslCdArg(cmd, unc, "win32")).toBe(unc);
    expect(cmd).toEqual(["wsl.exe", "-d", "NixOS"]);
  });
});

describe("windowsPathToWslMountPath", () => {
  test("Windows絶対パスを/mnt/<drive>形式へ変換する", () => {
    expect(windowsPathToWslMountPath("C:\\Users\\eetann\\AppData\\Local\\Temp\\foo.out")).toBe(
      "/mnt/c/Users/eetann/AppData/Local/Temp/foo.out",
    );
  });

  test("ドライブ文字は小文字化する", () => {
    expect(windowsPathToWslMountPath("D:\\data\\foo.out")).toBe("/mnt/d/data/foo.out");
  });

  test("Windows絶対パス形式でない値はnullを返す", () => {
    expect(windowsPathToWslMountPath("/mnt/c/already/linux/path")).toBeNull();
    expect(windowsPathToWslMountPath("relative\\path")).toBeNull();
  });
});

describe("wslMountPathToWindowsPath", () => {
  test("ドライブマウント経由のパスをWindows絶対パスへ戻す", () => {
    expect(wslMountPathToWindowsPath("/mnt/c/Users/eetann/proj")).toBe("C:\\Users\\eetann\\proj");
  });

  test("ドライブ文字は大文字化する", () => {
    expect(wslMountPathToWindowsPath("/mnt/d/data")).toBe("D:\\data");
  });

  test("マウントポイント自身はドライブのルートを指す", () => {
    expect(wslMountPathToWindowsPath("/mnt/c")).toBe("C:\\");
  });

  test("ドライブマウント配下でないパスはnullを返す", () => {
    expect(wslMountPathToWindowsPath("/home/eetann/proj")).toBeNull();
    expect(wslMountPathToWindowsPath("/mnt/wsl/instances")).toBeNull();
    expect(wslMountPathToWindowsPath("C:\\already\\windows")).toBeNull();
  });
});
