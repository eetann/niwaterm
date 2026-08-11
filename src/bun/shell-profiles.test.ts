import { describe, expect, test } from "bun:test";
import {
  detectShellProfiles,
  parseWslListOutput,
  resolveShellProfileCommand,
} from "./shell-profiles";

describe("parseWslListOutput", () => {
  test("UTF-8（BOM無し）の出力をディストロ一覧へ変換する", () => {
    const bytes = new TextEncoder().encode("Ubuntu\r\nNixOS\r\n");
    expect(parseWslListOutput(bytes)).toEqual([
      { id: "wsl-Ubuntu", name: "WSL: Ubuntu", command: "wsl.exe -d Ubuntu" },
      { id: "wsl-NixOS", name: "WSL: NixOS", command: "wsl.exe -d NixOS" },
    ]);
  });

  test("BOM付きUTF-16LEの出力を正しくデコードする", () => {
    const utf16Body = Buffer.from("Ubuntu\r\nNixOS\r\n", "utf16le");
    const bom = Buffer.from([0xff, 0xfe]);
    const bytes = new Uint8Array(Buffer.concat([bom, utf16Body]));
    expect(parseWslListOutput(bytes)).toEqual([
      { id: "wsl-Ubuntu", name: "WSL: Ubuntu", command: "wsl.exe -d Ubuntu" },
      { id: "wsl-NixOS", name: "WSL: NixOS", command: "wsl.exe -d NixOS" },
    ]);
  });

  test("BOM無しUTF-16LEの出力もバイトパターンから判定してデコードする", () => {
    const bytes = new Uint8Array(Buffer.from("Ubuntu\r\n", "utf16le"));
    expect(parseWslListOutput(bytes)).toEqual([
      { id: "wsl-Ubuntu", name: "WSL: Ubuntu", command: "wsl.exe -d Ubuntu" },
    ]);
  });

  test("空行・空白のみの行は無視する", () => {
    const bytes = new TextEncoder().encode("Ubuntu\r\n\r\n  \r\nNixOS\r\n");
    expect(parseWslListOutput(bytes)).toEqual([
      { id: "wsl-Ubuntu", name: "WSL: Ubuntu", command: "wsl.exe -d Ubuntu" },
      { id: "wsl-NixOS", name: "WSL: NixOS", command: "wsl.exe -d NixOS" },
    ]);
  });

  test("空バイト列からは空配列を返す", () => {
    expect(parseWslListOutput(new Uint8Array())).toEqual([]);
  });
});

describe("resolveShellProfileCommand", () => {
  const profiles = [
    { id: "powershell", name: "PowerShell", command: "powershell.exe -NoLogo" },
    { id: "wsl-Ubuntu", name: "WSL: Ubuntu", command: "wsl.exe -d Ubuntu" },
  ];

  test("shellProfileId未指定ならcommand:undefinedを返す（デフォルトシェルへフォールバック）", () => {
    expect(resolveShellProfileCommand(profiles, undefined)).toEqual({
      ok: true,
      command: undefined,
    });
  });

  test("存在するidを指定するとそのcommandを返す", () => {
    expect(resolveShellProfileCommand(profiles, "wsl-Ubuntu")).toEqual({
      ok: true,
      command: "wsl.exe -d Ubuntu",
    });
  });

  test("存在しないidを指定するとエラーを返す", () => {
    const result = resolveShellProfileCommand(profiles, "unknown");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("unknown");
  });
});

describe("detectShellProfiles", () => {
  test("非Windows環境では空配列を返す", async () => {
    if (process.platform === "win32") return;
    expect(await detectShellProfiles()).toEqual([]);
  });
});
