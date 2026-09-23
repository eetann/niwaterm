// 名前を付けていないBoardへ自動で付く名前の作り方（設定のboard.naming）。方式ごとの
// 文字列の組み立てだけを持つ純粋関数で、いつ付け直すかの判断はworkspace.ts側にある。

/** 連番方式（board.naming: "sequential"）で付く名前の形 */
const SEQUENTIAL_PATTERN = /^Board (\d+)$/;

/**
 * cwdの末尾のディレクトリ名。POSIXの`/`とWindowsの`\`のどちらの区切りでも切り出す
 * （WSLプロファイルのタブはOSC 7の生パスがPOSIX形式、変換後がUNC形式と混在するため）。
 * ドライブ・ルート直下のように名前が取り出せない場合はnull
 */
export function directoryName(cwd: string | undefined): string | null {
  if (cwd === undefined) return null;
  const trimmed = cwd.replace(/[/\\]+$/, "");
  const separator = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
  const name = separator === -1 ? trimmed : trimmed.slice(separator + 1);
  if (name === "" || /^[A-Za-z]:$/.test(name)) return null;
  return name;
}

/** 連番方式で付いた名前か。方式を切り替えた時に振り直すかどうかの判定に使う */
export function isSequentialName(name: string): boolean {
  return SEQUENTIAL_PATTERN.test(name);
}

/**
 * 既にある自動名と重ならない最小の連番。閉じたBoardの番号は空き番号として詰め直す
 * （並び順と番号が食い違ったまま増え続けるより、若い番号から埋まる方が探しやすいため）
 */
export function nextSequentialName(existing: Iterable<string>): string {
  const used = new Set<number>();
  for (const name of existing) {
    const matched = SEQUENTIAL_PATTERN.exec(name);
    if (matched) used.add(Number(matched[1]));
  }
  let n = 1;
  while (used.has(n)) n += 1;
  return `Board ${n}`;
}
