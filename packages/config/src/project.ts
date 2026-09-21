// プロジェクトローカル設定（<projectRoot>/.niwaterm/config.ts）の型。
//
// グローバル設定（~/.config/niwaterm/niwaterm.config.ts、NiwatermConfig）とは別物で、
// マージもされない。`niwaterm layout apply`のような特定のCLI・API実行時にのみ、
// 解決元の候補として参照される。
//
// defineConfigに相当するランタイムヘルパーを用意していないのは、任意のリポジトリに
// @niwaterm/configがインストールされているとは限らないため。`import type`は
// トランスパイル時に消えるので、node_modulesが無いリポジトリでも次の書き方がそのまま動く。
//
//   // .niwaterm/config.ts
//   import type { NiwatermProjectConfig } from "@niwaterm/config";
//
//   export default {
//     layouts: {
//       dev: { layout: { kind: "tile", tabs: [{ name: "editor", command: "nvim" }] } },
//     },
//   } satisfies NiwatermProjectConfig;

import type { LayoutsConfig } from "./layout";
import type { WorktreeConfig } from "./worktree";

export interface NiwatermProjectConfig {
  /**
   * このリポジトリ専用のレイアウトプリセット。同名のプリセットがグローバル設定にもある場合は
   * こちらが優先される（`niwaterm layout list`に解決元が表示される）。
   * タブのcwdはprojectRoot基準の相対パスで書ける（cwd省略時のデフォルトもprojectRoot）。
   */
  layouts?: LayoutsConfig;
  /**
   * このリポジトリのワークツリー設定（置き場所・作成後の開き方）。グローバル設定
   * （niwaterm.config.tsのworktree）とgit configの`niwaterm.worktree.*`より項目ごとに優先される。
   * 例: { dir: ".worktrees/${branch}" }
   */
  worktree?: WorktreeConfig;
}
