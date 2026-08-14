import { describe, expect, test } from "bun:test";
import { decodePwdReport } from "./pwd-report";

const HOST = "my-host";

describe("decodePwdReport", () => {
  test("kitty-shell-cwd://はパーセントデコードせず生パスのまま返す", () => {
    expect(decodePwdReport(`kitty-shell-cwd://${HOST}/tmp/example project`)).toBe(
      "/tmp/example project",
    );
  });

  test("file://はパーセントデコードして返す", () => {
    expect(decodePwdReport(`file://${HOST}/tmp/another%20dir`)).toBe("/tmp/another dir");
  });

  test("ホストが空文字列（省略）でも受理する", () => {
    expect(decodePwdReport("file:///tmp/no-host")).toBe("/tmp/no-host");
  });

  test("ホスト名検証はしない（WSL越し・SSH越し等、シェルとniwaterm本体のホスト名が異なるケースを許容する）", () => {
    expect(decodePwdReport("file://other-host/tmp/x")).toBe("/tmp/x");
    expect(decodePwdReport("kitty-shell-cwd://wsl-vm-host/home/user/project")).toBe(
      "/home/user/project",
    );
  });

  test("スキーム無しの生パス（OSC9/OSC1337相当）はそのまま返す", () => {
    expect(decodePwdReport("/plain/path/from/osc9")).toBe("/plain/path/from/osc9");
  });

  test("空文字列はnullを返す（pwd不明の通知）", () => {
    expect(decodePwdReport("")).toBeNull();
  });

  test("スキームはあるがパスが空はnullを返す", () => {
    expect(decodePwdReport(`file://${HOST}`)).toBeNull();
  });

  test("不正なパーセントエンコードはnullを返す", () => {
    expect(decodePwdReport(`file://${HOST}/tmp/%zz`)).toBeNull();
  });
});
