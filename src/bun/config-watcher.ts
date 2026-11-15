// 設定ファイル（niwaterm.config.ts）の変更検知（ホットリロード用）。
// ファイル単体ではなくディレクトリを監視する。エディタの多くはatomic save（一時ファイルに書いてから
// renameで置き換える）を行い、対象パス自体のinodeが差し替わるため、単一ファイルのfs.watchでは
// リネーム後に追従できなくなることがある（electrobun本体のrunDevWatchもディレクトリ単位で監視している）。

import { watch } from "node:fs";
import { basename, dirname } from "node:path";
import { CONFIG_TYPES_DIR_NAME } from "./config-module";

export interface ConfigWatcher {
  close(): void;
}

/** 複数ファイル分割で設定を書く際に監視対象とするソースファイルの拡張子 */
const CONFIG_SOURCE_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".mts", ".cts"];

/**
 * filenameが取得できないケース（macOSのFSEvents実装等）ではfail-openで発火する。
 * targetそのもの（エントリファイル）に加え、複数ファイル分割で参照されうる非エントリの
 * ソースファイルにも反応する（node_modules配下はパッケージ更新等で無関係に変化しうるため除外）。
 * fs.watchの実イベントに依存せず単体テストできるよう独立した純粋関数として切り出している。
 */
export function shouldTriggerReload(filename: string | null, target: string): boolean {
  if (filename === null) return true;
  if (filename === target) return true;
  const segments = filename.split(/[/\\]/);
  if (segments.includes("node_modules")) return false;
  // アプリ自身が書き出す型定義。拾うと書き出すたびに設定の再読み込みが走る
  if (segments.includes(CONFIG_TYPES_DIR_NAME)) return false;
  return CONFIG_SOURCE_EXTENSIONS.some((ext) => filename.endsWith(ext));
}

/**
 * `~/.config/niwaterm/`が存在しない場合（設定ファイル未セットアップのユーザー）はfs.watchが
 * 同期的にENOENTを投げるため、try/catchしてno-opハンドルを返す（起動を落とさないためのフェイルセーフ）。
 * recursive: trueでサブディレクトリに分割した設定ファイルの変更も拾う（macOS/Windowsのみサポート、
 * niwatermの対応OSと一致するため問題ない）。
 */
export function watchConfigFile(
  path: string,
  onChange: () => void,
  debounceMs = 150,
): ConfigWatcher {
  const dir = dirname(path);
  const target = basename(path);
  let timer: ReturnType<typeof setTimeout> | null = null;

  function scheduleOnChange(): void {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      onChange();
    }, debounceMs);
  }

  let watcher: ReturnType<typeof watch>;
  try {
    watcher = watch(dir, { recursive: true }, (_event, filename) => {
      if (!shouldTriggerReload(filename, target)) return;
      scheduleOnChange();
    });
  } catch (err) {
    console.log(`[bun] failed to watch config directory, hot reload disabled: ${String(err)}`);
    return { close() {} };
  }

  // 監視中の非同期エラー（ディレクトリ削除等）でアプリ全体が落ちないようにする
  watcher.on("error", (err) => {
    console.log(`[bun] config watcher error: ${String(err)}`);
  });

  return {
    close() {
      if (timer) clearTimeout(timer);
      watcher.close();
    },
  };
}
