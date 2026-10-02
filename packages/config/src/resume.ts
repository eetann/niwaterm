// 実行中だったコマンドの再開設定。アプリ終了時にタブで動いていたコマンド（シェル統合が
// OSC 133で報告したもの）を、次回起動時にそのタブへ打ち直す。
// 打ち直してよいのはallowに載せたコマンドだけで、既定は空（何も打ち直さない）。

export interface ResumeConfig {
  /**
   * レイアウトプリセットで組み直さないBoardで、実行中だったコマンドを打ち直すか。既定はtrue。
   * Boardごとの切り替え（`niwa board resume set`・サイドバー）の方が優先される。
   * レイアウトプリセットで組み直すBoardには効かない（プリセット・タブのresumeで指定する）。
   */
  enabled?: boolean;
  /**
   * 打ち直してよいコマンド。単語単位の前方一致で判定する（"claude"は`claude --continue`に、
   * "git log"は`git log --oneline`に一致する）。先頭の環境変数代入（`FOO=1 nvim`）は外して判定する。
   * 既定は空で、何も打ち直さない。
   * 例: ["nvim", "claude", "lazygit"]
   */
  allow?: string[];
}

export interface ResolvedResumeConfig {
  enabled: boolean;
  allow: string[];
}

export const defaultResumeConfig: ResolvedResumeConfig = {
  enabled: true,
  allow: [],
};

/**
 * 許可リストを判定に使える形へ均す。文字列でない要素・空白だけの要素は黙って落とし、
 * 連続する空白は1つにまとめる（判定は単語単位なので、空白の数の違いで一致しなくなるのを避ける）
 */
export function normalizeResumeAllow(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const result: string[] = [];
  for (const entry of value) {
    if (typeof entry !== "string") continue;
    const normalized = entry.trim().split(/\s+/u).join(" ");
    if (normalized !== "" && !result.includes(normalized)) result.push(normalized);
  }
  return result;
}
