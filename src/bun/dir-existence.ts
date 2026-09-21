// ディレクトリが存在するかを、描画のたびに問い合わせられる形でキャッシュする。
// Boardに紐づくワークツリーが消えていないかのサイドバー表示（workspace-manager.tsのlistWorkspaces）で使う。
//
// 同期のexistsSyncを使わないのは、renderが最大62fpsで回るため。WSLのUNCパス（\\wsl.localhost\...）は
// 1回のstatがネットワーク越しの解決になり、毎フレーム叩くとPTY読み取りごとイベントループが止まる。
// 問い合わせは常にキャッシュ値を即返し、実際のstatは一定間隔のタイマーで裏から回す。
import { statSync } from "node:fs";
import { stat } from "node:fs/promises";

/** 存在チェックの間隔。消えたワークツリーへの気づきやすさと、UNCパスへのstat頻度の折衷 */
const DEFAULT_INTERVAL_MS = 5000;

/**
 * 問い合わせが途絶えたパスをキャッシュから捨てるまでの猶予（チェック間隔の倍数）。
 * Boardを閉じた・紐づけを張り替えた後のパスをいつまでも見張り続けないためのもの
 */
const PRUNE_INTERVALS = 6;

export interface DirExistenceCache {
  /**
   * そのパスのディレクトリが消えているか。
   * 未チェックのパスは「存在する」を返しつつ裏でチェックを始める（起動直後に警告アイコンが
   * 一瞬光るのを避けるための安全側の初期値）
   */
  isMissing(path: string): boolean;
  dispose(): void;
}

export interface DirExistenceCacheOptions {
  /** キャッシュ値が変わったときに呼ぶ（再描画のトリガ） */
  onChange: () => void;
  intervalMs?: number;
  /** テスト用の差し替え。実装はディレクトリとして存在するかを返す */
  dirExists?: (path: string) => Promise<boolean>;
}

async function statIsDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

/**
 * 一度きりの同期チェック。新しいタブを開く瞬間のcwd判定（new-tab-cwd.ts）のように、
 * 頻度が低く結果の鮮度が要る場面だけで使う。描画経路ではcreateDirExistenceCacheを使うこと
 */
export function dirExistsSync(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

interface Entry {
  exists: boolean;
  /** 最後にisMissingで問い合わされたタイマーの周回数。古くなったエントリを捨てる判定に使う */
  queriedTick: number;
}

export function createDirExistenceCache(opts: DirExistenceCacheOptions): DirExistenceCache {
  const dirExists = opts.dirExists ?? statIsDirectory;
  const intervalMs = opts.intervalMs ?? DEFAULT_INTERVAL_MS;
  const entries = new Map<string, Entry>();
  let tick = 0;
  let refreshing = false;

  async function refresh(): Promise<void> {
    // 前回の周回が終わる前に次のタイマーが来た場合は見送る（UNCパスのstatが遅い環境で
    // チェックが積み上がるのを防ぐ）
    if (refreshing) return;
    refreshing = true;
    tick += 1;
    try {
      let changed = false;
      // Mapは反復中のdeleteが許されるので、コピーを取らずそのまま回してよい
      for (const [path, entry] of entries) {
        if (tick - entry.queriedTick > PRUNE_INTERVALS) {
          entries.delete(path);
          continue;
        }
        const exists = await dirExists(path);
        if (exists === entry.exists) continue;
        entry.exists = exists;
        changed = true;
      }
      if (changed) opts.onChange();
    } finally {
      refreshing = false;
    }
  }

  const timer = setInterval(() => {
    void refresh();
  }, intervalMs);
  // 存在チェックのタイマーだけでプロセスを生かし続けない
  timer.unref?.();

  return {
    isMissing(path: string): boolean {
      const entry = entries.get(path);
      if (entry) {
        entry.queriedTick = tick;
        return !entry.exists;
      }
      entries.set(path, { exists: true, queriedTick: tick });
      // 新しいパスは次のタイマーを待たずに確かめる。待つと紐づけ直した直後の数秒間、
      // 実際には消えているディレクトリが存在するものとして表示される
      void (async () => {
        const exists = await dirExists(path);
        const current = entries.get(path);
        if (!current || current.exists === exists) return;
        current.exists = exists;
        opts.onChange();
      })();
      return false;
    },
    dispose(): void {
      clearInterval(timer);
      entries.clear();
    },
  };
}
