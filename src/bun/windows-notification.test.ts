import { describe, expect, test } from "bun:test";
import { buildToastScript } from "./windows-notification";

describe("buildToastScript", () => {
  test("appId/titleをPowerShellのシングルクォート文字列リテラルとして埋め込む", () => {
    const script = buildToastScript("dev.eetann.niwaterm-dev", { title: "ビルド完了" });
    expect(script).toContain("$AppId = 'dev.eetann.niwaterm-dev'");
    expect(script).toContain("[System.Security.SecurityElement]::Escape('ビルド完了')");
  });

  test("titleにシングルクォートが含まれる場合は2つ重ねてエスケープする", () => {
    const script = buildToastScript("app-id", { title: "it's done" });
    expect(script).toContain("Escape('it''s done')");
  });

  test("bodyのみ指定時はそのままbodyLineになる", () => {
    const script = buildToastScript("app-id", { title: "t", body: "本文" });
    expect(script).toContain("Escape('本文')");
  });

  test("subtitleのみ指定時はsubtitleがbodyLineになる", () => {
    const script = buildToastScript("app-id", { title: "t", subtitle: "サブ" });
    expect(script).toContain("Escape('サブ')");
  });

  test("subtitleとbody両方指定時は改行で連結する", () => {
    const script = buildToastScript("app-id", { title: "t", subtitle: "サブ", body: "本文" });
    expect(script).toContain("Escape('サブ\n本文')");
  });

  test("silent未指定時はaudioタグが空文字列になる", () => {
    const script = buildToastScript("app-id", { title: "t" });
    expect(script).toContain("$audio = ''");
  });

  test("silent:true時はaudioタグにsilent属性が入る", () => {
    const script = buildToastScript("app-id", { title: "t", silent: true });
    expect(script).toContain(`$audio = '<audio silent="true"/>'`);
  });
});
