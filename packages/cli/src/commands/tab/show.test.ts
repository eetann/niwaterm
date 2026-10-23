import { describe, expect, test } from "bun:test";
import type { TabInfo } from "../../ipc-client";
import { formatTabInfo, tabInfoField } from "./show";

const INFO: TabInfo = {
  workspace: { id: "workspace-1", name: "dev" },
  board: { id: "board-2", name: "feature-x" },
  tile: { id: "tile-3", name: null },
  tab: { id: "tab-5", name: "editor" },
};

const POPUP_INFO: TabInfo = { ...INFO, tile: null, tab: { id: "tab-9", name: null } };

describe("tabInfoField", () => {
  test("ドット区切りの項目の値を返す", () => {
    expect(tabInfoField(INFO, "board.id")).toBe("board-2");
    expect(tabInfoField(INFO, "board.name")).toBe("feature-x");
    expect(tabInfoField(INFO, "tab.name")).toBe("editor");
  });

  test("未設定の名前・所属の無いタイルは空文字列", () => {
    expect(tabInfoField(INFO, "tile.name")).toBe("");
    expect(tabInfoField(POPUP_INFO, "tile.id")).toBe("");
  });
});

describe("formatTabInfo", () => {
  test("全項目を1行ずつ並べ、値が無い項目はキーだけ出す", () => {
    expect(formatTabInfo(POPUP_INFO)).toEqual([
      "workspace.id: workspace-1",
      "workspace.name: dev",
      "board.id: board-2",
      "board.name: feature-x",
      "tile.id:",
      "tile.name:",
      "tab.id: tab-9",
      "tab.name:",
    ]);
  });
});
