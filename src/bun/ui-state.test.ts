import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadUiState, saveUiState } from "./ui-state";

describe("loadUiState / saveUiState", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "niwaterm-ui-state-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  test("保存した状態を読み戻せる", () => {
    const path = join(dir, "nested", "ui-state.json");
    saveUiState(path, { statusBarHidden: true });
    expect(loadUiState(path)).toEqual({ statusBarHidden: true });
  });

  test("ファイルが無い・壊れている・versionが違う場合は既定値", async () => {
    const path = join(dir, "ui-state.json");
    expect(loadUiState(path)).toEqual({ statusBarHidden: false });
    await writeFile(path, "{");
    expect(loadUiState(path)).toEqual({ statusBarHidden: false });
    await writeFile(path, JSON.stringify({ version: 2, statusBarHidden: true }));
    expect(loadUiState(path)).toEqual({ statusBarHidden: false });
  });
});
