import { describe, expect, test } from "bun:test";
import { formatConfigSummary } from "./show";

describe("formatConfigSummary", () => {
  test("セクションごとに見出しを出し、キー名の幅は全セクションを通して揃える", () => {
    const lines = formatConfigSummary({
      ok: true,
      configFile: "/home/user/.config/niwaterm/niwaterm.config.ts",
      configFileLoaded: true,
      loadError: null,
      diagnostics: [],
      sections: [
        {
          name: "appearance",
          entries: [
            { key: "fontSize", value: "13px" },
            { key: "backgroundOpacity", value: "1" },
          ],
        },
        { name: "mouse", entries: [{ key: "copyOnSelect", value: "false" }] },
      ],
    });
    expect(lines).toEqual([
      "config: /home/user/.config/niwaterm/niwaterm.config.ts",
      "",
      "[appearance]",
      "fontSize           13px",
      "backgroundOpacity  1",
      "",
      "[mouse]",
      "copyOnSelect       false",
    ]);
  });

  test("noteは値の後ろへ括弧で添える", () => {
    const lines = formatConfigSummary({
      ok: true,
      configFile: "/c/niwaterm.config.ts",
      configFileLoaded: true,
      loadError: null,
      diagnostics: [],
      sections: [
        {
          name: "appearance",
          entries: [{ key: "fontSize", value: "16px", note: "設定値 13px + ズーム +3" }],
        },
      ],
    });
    expect(lines.at(-1)).toBe("fontSize  16px (設定値 13px + ズーム +3)");
  });

  test("設定ファイルを読み込めていない場合は1行目で知らせる", () => {
    const lines = formatConfigSummary({
      ok: true,
      configFile: "/c/niwaterm.config.ts",
      configFileLoaded: false,
      loadError: null,
      diagnostics: [],
      sections: [],
    });
    expect(lines).toEqual(["config: /c/niwaterm.config.ts (未読み込み。全項目が既定値です)"]);
  });

  test("読み込みエラーと無視した設定は設定値一覧より前に出す", () => {
    const lines = formatConfigSummary({
      ok: true,
      configFile: "/c/niwaterm.config.ts",
      // 読み込めていた頃の設定で動き続けている状態
      configFileLoaded: true,
      loadError: "ResolveMessage: Cannot find module './missing.ts'",
      diagnostics: [
        { level: "warn", scope: "appearance.fontSize", message: "値が不正なため既定値を使います" },
      ],
      sections: [{ name: "mouse", entries: [{ key: "copyOnSelect", value: "false" }] }],
    });
    expect(lines).toEqual([
      "config: /c/niwaterm.config.ts",
      "",
      "[読み込みエラー]",
      "ResolveMessage: Cannot find module './missing.ts'",
      "直前に読み込めた設定のまま動いています（下の一覧はその内容）",
      "",
      "[無視した設定]",
      "- appearance.fontSize: 値が不正なため既定値を使います",
      "",
      "[mouse]",
      "copyOnSelect  false",
    ]);
  });
});
