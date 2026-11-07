import { describe, expect, test } from "bun:test";
import { defaultMouseConfig } from "./mouse";

describe("defaultMouseConfig", () => {
  test("copyOnSelectは既定でオフ（明示的に有効化するオプトイン機能）", () => {
    expect(defaultMouseConfig.copyOnSelect).toBe(false);
  });

  test("copyModeOnSelectは既定でオフ（選択のたびにコピーモードへ入るのはオプトイン）", () => {
    expect(defaultMouseConfig.copyModeOnSelect).toBe(false);
  });
});
