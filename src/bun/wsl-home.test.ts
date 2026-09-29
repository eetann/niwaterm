import { describe, expect, test } from "bun:test";
import { createWslHomeResolver } from "./wsl-home";

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("createWslHomeResolver", () => {
  test("ディストロごとに1回だけ問い合わせ、分かったら知らせてキャッシュから返す", async () => {
    const asked: string[] = [];
    let resolved = 0;
    const homes = createWslHomeResolver({
      platform: "win32",
      lookup: async (distro) => {
        asked.push(distro);
        return `/home/${distro.toLowerCase()}`;
      },
      onResolved: () => resolved++,
    });
    expect(homes.homeOf("wsl.exe -d NixOS")).toBeUndefined();
    expect(homes.homeOf("wsl.exe -d NixOS")).toBeUndefined();
    await flush();
    expect(resolved).toBe(1);
    expect(homes.homeOf("wsl.exe -d NixOS")).toBe("/home/nixos");
    expect(homes.homeOf("wsl.exe -d Ubuntu")).toBeUndefined();
    await flush();
    expect(homes.homeOf("wsl.exe -d Ubuntu")).toBe("/home/ubuntu");
    expect(asked).toEqual(["NixOS", "Ubuntu"]);
  });

  test("WSL以外のシェル・Windows以外では問い合わせない", () => {
    const asked: string[] = [];
    const lookup = async (distro: string) => {
      asked.push(distro);
      return "/home/me";
    };
    const win = createWslHomeResolver({ platform: "win32", lookup, onResolved: () => {} });
    expect(win.homeOf("powershell.exe -NoLogo")).toBeUndefined();
    expect(win.homeOf(undefined)).toBeUndefined();
    const mac = createWslHomeResolver({ platform: "darwin", lookup, onResolved: () => {} });
    expect(mac.homeOf("wsl.exe -d NixOS")).toBeUndefined();
    expect(asked).toEqual([]);
  });

  test("問い合わせに失敗したら知らせず、再問い合わせもしない", async () => {
    let calls = 0;
    let resolved = 0;
    const homes = createWslHomeResolver({
      platform: "win32",
      lookup: async () => {
        calls++;
        throw new Error("wsl.exe not found");
      },
      onResolved: () => resolved++,
    });
    homes.homeOf("wsl.exe -d NixOS");
    await flush();
    expect(homes.homeOf("wsl.exe -d NixOS")).toBeUndefined();
    expect(calls).toBe(1);
    expect(resolved).toBe(0);
  });
});
