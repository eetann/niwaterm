// 描画済み画面のテキストから、指定した桁に乗っているリンクを引き当てる。
//
// .termのHTMLへ<a>を埋め込むのではなく、描画結果のテキストへ正規表現を当てて桁の範囲を出す方式を
// 採る（OSC 8ハイパーリンクはフォーマッタが<a>として出力するので別経路）。出力のたびに
// innerHTMLごと差し替わる描画方式では、埋め込んだ要素はその場で作り直されてしまうため、
// 位置の情報だけをこちらで持ちオーバーレイとして重ねる（copy-overlayと同じ発想）。

import type { ResolvedLinkRule } from "@niwaterm/config";
import { charWidth } from "../shared/wide-char";

export interface CompiledLinkRule {
  /** gフラグ付きの正規表現。execを繰り返して行内の全マッチを列挙する */
  re: RegExp;
  format: string;
}

export interface LinkSpan {
  /** formatを適用した後の、実際に開くURL */
  url: string;
  /** 画面上でマッチした文字列そのもの */
  text: string;
  /** 画面上での開始桁 */
  startCol: number;
  /** 画面上での終了桁（この桁は含まない） */
  endCol: number;
}

/**
 * RPCで届いたsource/flagsをRegExpへ戻す。ユーザー設定由来の不正なパターンはここで落とし、
 * 残りのルールだけで動かす（1件の書き損じで全リンクが死なないようにするため）
 */
export function compileLinkRules(rules: ResolvedLinkRule[]): CompiledLinkRule[] {
  const compiled: CompiledLinkRule[] = [];
  for (const rule of rules) {
    try {
      compiled.push({ re: new RegExp(rule.source, `${rule.flags}g`), format: rule.format });
    } catch (e) {
      console.log(`[mainview] invalid link rule: /${rule.source}/${rule.flags} (${e})`);
    }
  }
  return compiled;
}

/**
 * 文字列のUTF-16インデックスごとの開始桁。全角文字は2桁を占めるため、文字数と桁数は一致しない
 * （末尾の要素は行全体の桁数）
 */
function columnByIndex(line: string): number[] {
  const cols: number[] = Array.from({ length: line.length + 1 }, () => 0);
  let index = 0;
  let col = 0;
  for (const char of line) {
    // サロゲートペアの後半も先頭と同じ桁にしておく（マッチ境界がペアの途中へ来ることはないが、
    // 添字が欠けると以降の参照がundefinedになるため埋める）
    for (let k = 0; k < char.length; k++) cols[index + k] = col;
    index += char.length;
    col += charWidth(char);
  }
  cols[line.length] = col;
  return cols;
}

/** マッチからURLを組み立てる。$0がマッチ全体、$1以降がキャプチャ（未参加のグループは空文字列） */
export function applyLinkFormat(format: string, match: RegExpExecArray): string {
  return format.replace(/\$(\d)/g, (_, digit: string) => match[Number(digit)] ?? "");
}

/**
 * line（1行分の画面テキスト）のcol桁に乗っているリンクを返す。どのルールにも当たらなければnull。
 * ルールは配列の順で試し、最初に見つかったものを返す
 */
export function findLinkAt(line: string, col: number, rules: CompiledLinkRule[]): LinkSpan | null {
  if (col < 0 || line === "") return null;
  const cols = columnByIndex(line);
  for (const { re, format } of rules) {
    re.lastIndex = 0;
    for (let match = re.exec(line); match !== null; match = re.exec(line)) {
      // 空マッチはlastIndexが進まず無限ループになる。1文字送って次を探す
      if (match[0] === "") {
        re.lastIndex++;
        continue;
      }
      const startCol = cols[match.index] as number;
      const endCol = cols[match.index + match[0].length] as number;
      if (col >= startCol && col < endCol) {
        return { url: applyLinkFormat(format, match), text: match[0], startCol, endCol };
      }
      // マッチの開始桁がクリック位置を追い越したら、この行にこれ以上候補は無い
      if (startCol > col) break;
    }
  }
  return null;
}
