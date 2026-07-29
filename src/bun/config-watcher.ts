// 設定ファイル（niwaterm.config.ts）の変更検知（ホットリロード用）。
// ファイル単体ではなくディレクトリを監視する。エディタの多くはatomic save（一時ファイルに書いてから
// renameで置き換える）を行い、対象パス自体のinodeが差し替わるため、単一ファイルのfs.watchでは
// リネーム後に追従できなくなることがある（electrobun本体のrunDevWatchもディレクトリ単位で監視している）。

import { watch } from "node:fs";
import { basename, dirname } from "node:path";

export interface ConfigWatcher {
  close(): void;
}

/**
 * filenameが取得できないケース（macOSのFSEvents実装等）ではfail-openで発火する。
 * fs.watchの実イベントに依存せず単体テストできるよう独立した純粋関数として切り出している。
 */
export function shouldTriggerReload(filename: string | null, target: string): boolean {
  return filename === null || filename === target;
}

/**
 * `~/.config/niwaterm/`が存在しない場合（設定ファイル未セットアップのユーザー）はfs.watchが
 * 同期的にENOENTを投げるため、try/catchしてno-opハンドルを返す（起動を落とさないためのフェイルセーフ）。
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
    watcher = watch(dir, (_event, filename) => {
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
