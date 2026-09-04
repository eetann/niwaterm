// メインウィンドウのサイズ・位置を保存し、次回起動時に復元する。
// ディスプレイ構成が変わって保存値が画面外になるケースでは、既定（プライマリの作業領域の80%を
// 中央寄せ）へ戻す。保存先はworkspaces.jsonとは別ファイル（ウィンドウ枠はワークスペースの
// 中身とライフサイクルが独立しており、片方が壊れてももう片方を巻き込まないため）。

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { appSupportDir } from "./app-paths";

export interface WindowFrame {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** ディスプレイの作業領域（タスクバー・メニューバーを除いた矩形）。スクリーン座標系 */
export type ScreenArea = WindowFrame;

/** ディスプレイ情報が一切取れない環境で使うフレーム */
const FALLBACK_FRAME: WindowFrame = { x: 200, y: 200, width: 900, height: 600 };

/** 既定ウィンドウがプライマリの作業領域に対して占める割合 */
const DEFAULT_SIZE_RATIO = 0.8;

/** 復元を許可する最小の可視割合（ウィンドウ面積のうち、いずれかの作業領域と重なる割合） */
const MIN_VISIBLE_RATIO = 0.6;

/** タイトルバーとみなす高さ。ここが画面内に無いとウィンドウを掴んで動かせない */
const TITLE_BAR_HEIGHT = 32;

/** タイトルバーのうち画面内にあってほしい最小の幅 */
const MIN_GRABBABLE_WIDTH = 120;

function intersectionArea(a: WindowFrame, b: ScreenArea): number {
  const width = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const height = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  if (width <= 0 || height <= 0) return 0;
  return width * height;
}

// ディスプレイの作業領域同士は重ならない前提で単純加算する（OSは通常こう配置する）
function coveredArea(frame: WindowFrame, workAreas: ScreenArea[]): number {
  return workAreas.reduce((sum, area) => sum + intersectionArea(frame, area), 0);
}

function isValidFrame(frame: WindowFrame): boolean {
  const values = [frame.x, frame.y, frame.width, frame.height];
  if (!values.every((v) => Number.isFinite(v))) return false;
  return frame.width >= 1 && frame.height >= 1;
}

/**
 * 保存されたフレームをそのまま使ってよいか。
 * 「面積の大半が画面内」かつ「タイトルバーを掴める」の両方を満たすことを求める。
 * ディスプレイを外した・解像度を下げた・別マシンの設定を持ち込んだ場合はここで弾かれる。
 */
export function isFrameRestorable(frame: WindowFrame, workAreas: ScreenArea[]): boolean {
  if (!isValidFrame(frame)) return false;
  if (workAreas.length === 0) return false;

  const visibleRatio = coveredArea(frame, workAreas) / (frame.width * frame.height);
  if (visibleRatio < MIN_VISIBLE_RATIO) return false;

  const titleBar: WindowFrame = {
    x: frame.x,
    y: frame.y,
    width: frame.width,
    height: Math.min(TITLE_BAR_HEIGHT, frame.height),
  };
  return coveredArea(titleBar, workAreas) >= MIN_GRABBABLE_WIDTH * titleBar.height;
}

/** プライマリ（workAreasの先頭）の作業領域の80%を中央寄せしたフレーム */
export function defaultWindowFrame(workAreas: ScreenArea[]): WindowFrame {
  const primary = workAreas[0];
  if (primary === undefined || primary.width < 1 || primary.height < 1) return FALLBACK_FRAME;
  const width = Math.round(primary.width * DEFAULT_SIZE_RATIO);
  const height = Math.round(primary.height * DEFAULT_SIZE_RATIO);
  return {
    x: Math.round(primary.x + (primary.width - width) / 2),
    y: Math.round(primary.y + (primary.height - height) / 2),
    width,
    height,
  };
}

/**
 * 起動時に使うフレームを決める。workAreasはプライマリを先頭にした作業領域の一覧。
 * 空配列（ディスプレイ情報が取れない）のときは検証しようがないので保存値を尊重する
 */
export function resolveWindowFrame(
  saved: WindowFrame | null,
  workAreas: ScreenArea[],
): WindowFrame {
  if (workAreas.length === 0) {
    return saved !== null && isValidFrame(saved) ? saved : FALLBACK_FRAME;
  }
  if (saved !== null && isFrameRestorable(saved, workAreas)) return saved;
  return defaultWindowFrame(workAreas);
}

export function windowStateFilePath(): string {
  return join(appSupportDir(), "window.json");
}

interface PersistedWindowState extends WindowFrame {
  version: 1;
}

/** ファイルが無い・壊れている・値が不正のいずれでも例外を投げずnullを返す */
export function loadWindowState(path: string): WindowFrame | null {
  try {
    const data: unknown = JSON.parse(readFileSync(path, "utf8"));
    if (typeof data !== "object" || data === null) return null;
    const v = data as Record<string, unknown>;
    if (v["version"] !== 1) return null;
    const frame: WindowFrame = {
      x: Math.round(v["x"] as number),
      y: Math.round(v["y"] as number),
      width: Math.round(v["width"] as number),
      height: Math.round(v["height"] as number),
    };
    return isValidFrame(frame) ? frame : null;
  } catch {
    return null;
  }
}

// 同期書き込みにしているのは、アプリ終了イベント（will-close/before-quit）から呼ぶため。
// 非同期だとプロセスが先に終わって書き込みが落ちる
export function saveWindowState(path: string, frame: WindowFrame): void {
  const state: PersistedWindowState = {
    version: 1,
    x: Math.round(frame.x),
    y: Math.round(frame.y),
    width: Math.round(frame.width),
    height: Math.round(frame.height),
  };
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(state, null, 2)}\n`);
}
