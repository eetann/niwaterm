// キーバインド・CLIで実行中に切り替えたUIの表示状態（設定ファイルの値ではないもの）を保存し、
// 次回起動時に引き継ぐ。全ウィンドウで共有する状態なので、webviewごとのlocalStorageではなく
// bun側で持つ。保存先はwindow.jsonと同じ理由でworkspaces.jsonとは別ファイル。

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { appSupportDir } from "./app-paths";

export interface UiState {
  /** 設定でstatusBarを出す指定でも、ユーザーが隠したか */
  statusBarHidden: boolean;
}

const DEFAULT_UI_STATE: UiState = { statusBarHidden: false };

interface PersistedUiState extends UiState {
  version: 1;
}

export function uiStateFilePath(): string {
  return join(appSupportDir(), "ui-state.json");
}

/** ファイルが無い・壊れている・値が不正のいずれでも例外を投げず既定値を返す */
export function loadUiState(path: string): UiState {
  try {
    const data: unknown = JSON.parse(readFileSync(path, "utf8"));
    if (typeof data !== "object" || data === null) return { ...DEFAULT_UI_STATE };
    const v = data as Record<string, unknown>;
    if (v["version"] !== 1) return { ...DEFAULT_UI_STATE };
    return { statusBarHidden: v["statusBarHidden"] === true };
  } catch {
    return { ...DEFAULT_UI_STATE };
  }
}

export function saveUiState(path: string, state: UiState): void {
  const persisted: PersistedUiState = { version: 1, ...state };
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(persisted, null, 2)}\n`);
}
