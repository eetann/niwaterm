// ジャンプ用ヒントラベルの割り当てと、打鍵中の前方一致判定。
// vimiumのfヒント相当で、ホームローの文字だけを使う。

/**
 * ラベルに使う文字。ホームローに限る（ジャンプ先を目で探しながら打つため、
 * 指を動かさずに済む範囲へ寄せる）
 */
export const HINT_CHARS = "asdfghjkl";

/**
 * count個の対象へ配るラベルを返す。1文字ラベルから始め、足りなければ最短のラベルを1つ取り除いて
 * 1文字長いラベルの束へ展開する、を繰り返す。展開元をキューから取り除くため**どのラベルも
 * 他のラベルの接頭辞にならず**、打った文字列が確定済みかどうかを前方一致だけで判定できる
 * （matchHintInput参照）。最短のものから展開するので、打鍵数は全体で最小に近いところへ収まる。
 */
export function assignHintLabels(count: number, chars: string = HINT_CHARS): string[] {
  // 1文字しか無いと展開してもラベルの総数が増えず、下のループが終わらない
  if (chars.length < 2) return [];
  const labels = [...chars];
  while (labels.length < count) {
    const prefix = labels.shift() as string;
    for (const c of chars) labels.push(prefix + c);
  }
  return labels.slice(0, count);
}

export type HintMatch =
  | { kind: "exact"; label: string }
  /** まだ候補が残っている（続きの打鍵を待つ） */
  | { kind: "pending" }
  /** どのラベルにも繋がらない打鍵。ヒントモードを抜ける */
  | { kind: "none" };

/** 打った文字列がどのラベルに対応するかを判定する。typedが空文字列なら常にpending */
export function matchHintInput(labels: Iterable<string>, typed: string): HintMatch {
  let pending = false;
  for (const label of labels) {
    if (label === typed) return { kind: "exact", label };
    if (label.startsWith(typed)) pending = true;
  }
  return pending ? { kind: "pending" } : { kind: "none" };
}
