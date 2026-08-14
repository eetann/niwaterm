// OSC 7（file:// / kitty-shell-cwd://）・OSC 9・OSC 1337（生パス）で報告されたpwdの生ペイロードをデコードする。
// libghostty-vt（vt-only版）のreportPwd実装（stream_terminal.zig）は、フルGhosttyアプリ用の
// termio/stream_handler.zigと異なりURIを意図的にパースせず生バイト列のまま返す仕様のため、embedder側で担う。
//
// ホスト名検証（SSH越しの偽装対策としてghostty本家が行っているもの）は意図的に行わない。
// niwatermはWSLディストロをシェルプロファイルとして正式サポートしており、この場合シェルが報告する
// ホスト名（WSL VM側）とniwaterm本体が動くホスト名（Windows側）は常に不一致になる。cwd機能自体は
// tabVarsに載せて次のタブ作成時のデフォルト値に使うだけで、誤ったcwdが混入しても実害は
// 「新規タブが存在しないパスを指してホームディレクトリへフォールバックする」程度のため、
// ホスト名不一致で弾くより素通しした方が実用上勝る（SSHタブ越しのcwdも拾えるようになる副次効果もある）。

const KITTY_SHELL_CWD_PREFIX = "kitty-shell-cwd://";
const FILE_PREFIX = "file://";

/** スキームプレフィックスを除いた"host/path"形式からpath部分だけを取り出す */
function extractRawPath(rest: string): string {
  const slashIdx = rest.indexOf("/");
  return slashIdx === -1 ? "" : rest.slice(slashIdx);
}

/**
 * OSC 7/9/1337のpwd報告の生ペイロードをデコードする。パースに失敗した場合はnullを返す。
 * Windowsパス（file:///C:/...）のデコードは非対応（Windows側シェル統合は今のところOSC 7未送信のため対象外）。
 */
export function decodePwdReport(raw: string): string | null {
  if (raw.length === 0) return null;

  let rawPath: string;
  let urlEncoded: boolean;
  if (raw.startsWith(KITTY_SHELL_CWD_PREFIX)) {
    rawPath = extractRawPath(raw.slice(KITTY_SHELL_CWD_PREFIX.length));
    urlEncoded = false; // kitty-shell-cwdは生パスをそのまま埋め込む規約（パーセントエンコード無し）
  } else if (raw.startsWith(FILE_PREFIX)) {
    rawPath = extractRawPath(raw.slice(FILE_PREFIX.length));
    urlEncoded = true;
  } else {
    // OSC 9 (ConEmu) / OSC 1337 (iTerm2)。スキーム無しの生パスがそのまま渡る
    return raw;
  }
  if (rawPath.length === 0) return null;
  try {
    return urlEncoded ? decodeURIComponent(rawPath) : rawPath;
  } catch {
    return null; // 不正なパーセントエンコード
  }
}
