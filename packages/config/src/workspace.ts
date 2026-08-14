// ワークスペース設定。新規ワークスペース作成時の最初のタブに使うデフォルトcwdをniwaterm.config.tsから変更できるようにする。
// shell.tsと同様、OS共通の既定値が無い（既定はpty.ts側のhomedir()に委ねる。WSL上でniwatermのプロセス自体を
// 動かしている場合、homedir()は自然にWSL側のホームディレクトリを返す）ため、未指定時のResolved型は`undefined`のまま扱う。
// 分割・新規タブ作成時のcwd（前のタブからの継承）には影響しない。

export interface WorkspaceConfig {
  /** 新規ワークスペース作成時、最初のタブに使うデフォルトcwd（絶対パス）。未指定時はOS標準のホームディレクトリを使う */
  defaultCwd?: string;
}
