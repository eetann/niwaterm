// ターミナル出力の中のURLをクリックで開けるようにするための設定。
// 「何をURLとみなすか」は正規表現のルール列で決め、「開くのに押しておく修飾キー」と
// 「開き先」をあわせて指定する。mouse.tsと同様、全フィールドoptionalの型を
// 「ユーザーの部分上書き」用に使い、解決済みの値は別の型で持つ（正規表現をwebviewへ
// 送るためにsource/flagsへ分解する必要があり、入力の形のままでは渡せないため）。

/** URLとみなすパターン1件 */
export interface LinkRule {
  /**
   * マッチさせる正規表現。RegExpでも文字列でも書ける（文字列の場合はJSの正規表現の
   * ソースそのもので、`\`はTypeScriptの文字列として`\\`と書く）。
   * gフラグは常に内部で付くため指定は不要
   */
  regex: RegExp | string;
  /**
   * マッチから実際に開くURLを組み立てるテンプレート。`$0`がマッチ全体、`$1`以降がキャプチャ。
   * 省略時は`$0`（マッチした文字列をそのままURLとして開く）
   */
  format?: string;
}

/** リンクを開くのに押しておく修飾キー */
export type LinkModifier = "cmd" | "ctrl" | "alt" | "shift";

/** リンクの開き先。externalはOS既定のブラウザ、browser-tabはniwaterm内のブラウザタブ */
export type LinkOpenTarget = "external" | "browser-tab";

export interface LinkConfig {
  /**
   * URLとみなすパターン。指定すると既定のルールを**置き換える**（追加ではない）。
   * 先に書いたルールが優先で、クリック位置を含むマッチが最初に見つかったルールが使われる
   */
  rules?: LinkRule[];
  /**
   * リンクを開くのに押しておく修飾キー。未指定時はmacOSが`cmd`、それ以外が`ctrl`
   * （macOSのctrl+クリックはOSが右クリックとして扱うため）
   */
  modifier?: LinkModifier;
  /** リンクの開き先。未指定時は`external`（OS既定のブラウザ） */
  open?: LinkOpenTarget;
}

/**
 * 解決済みのルール1件。webviewへRPCで送るため、RegExpではなくsource/flagsへ分解した形で持つ
 * （関数・RegExpはRPCの境界を越えられない）
 */
export interface ResolvedLinkRule {
  /** 正規表現のソース（RegExp.prototype.sourceと同じもの） */
  source: string;
  /** gを除いたフラグ。gはマッチ列挙のため利用側で必ず付ける */
  flags: string;
  format: string;
}

export interface ResolvedLinkConfig {
  rules: ResolvedLinkRule[];
  modifier: LinkModifier;
  open: LinkOpenTarget;
}

/**
 * 末尾から外す文字。URLの直後に置かれただけの句読点・閉じ括弧までマッチへ含めないために、
 * 「最後の1文字はこれ以外」という形でルールへ書く
 */
const TRAILING = ".,;:!?)\\]}";
/** URLの内側に現れない文字。空白とクォート・山括弧で切る */
const DELIMITERS = "\\s<>\"'`";

const URL_BODY = `[^${DELIMITERS}]*[^${DELIMITERS}${TRAILING}]`;

/**
 * 既定のURL判定ルール。実際に開けるスキームはhttp/https/mailtoに限られるため
 * （src/bun/open-link.tsのisAllowedLinkUrl）、既定では他のスキームを拾わない。
 * メールアドレスはスキーム無しで書かれるのでmailto:を補って開く。
 * ユーザー設定から`rules: [...defaultLinkRules, 独自ルール]`と書けるよう、解決済みの形ではなく
 * 設定ファイルに書くのと同じ形で持つ
 */
export const defaultLinkRules: LinkRule[] = [
  { regex: `\\bhttps?://${URL_BODY}`, format: "$0" },
  { regex: `\\bmailto:${URL_BODY}`, format: "$0" },
  { regex: "\\b[\\w.+-]+@[\\w-]+(?:\\.[\\w-]+)+\\b", format: "mailto:$0" },
];

/**
 * ルール1件を解決済みの形へ直す。正規表現として解釈できない場合はnull
 * （警告の文言は設定の読み込み側が持つ）
 */
export function toResolvedLinkRule(rule: LinkRule): ResolvedLinkRule | null {
  const { regex, format } = rule;
  const source = regex instanceof RegExp ? regex.source : regex;
  // gはマッチ列挙のため利用側で必ず付ける。yは走査位置を固定してしまうので落とす
  const flags = regex instanceof RegExp ? regex.flags.replaceAll(/[gy]/gu, "") : "";
  if (typeof source !== "string" || source === "") return null;
  try {
    new RegExp(source, flags);
  } catch {
    return null;
  }
  return { source, flags, format: typeof format === "string" ? format : "$0" };
}

/**
 * 修飾キーの既定値。macOSのctrl+クリックはOSレベルで右クリック扱いになりリンクを開く操作に
 * 使えないため、他のターミナル（iTerm2・Terminal.app）と同じくcmdにする
 */
export function platformDefaultLinkModifier(platform: string): LinkModifier {
  return platform === "darwin" ? "cmd" : "ctrl";
}

/** 既定値。修飾キーだけはOSで変わるため、プラットフォームを受け取って組み立てる */
export function defaultLinkConfig(platform: string): Required<LinkConfig> {
  return {
    rules: defaultLinkRules,
    modifier: platformDefaultLinkModifier(platform),
    open: "external",
  };
}

export function isLinkModifier(value: unknown): value is LinkModifier {
  return value === "cmd" || value === "ctrl" || value === "alt" || value === "shift";
}

export function isLinkOpenTarget(value: unknown): value is LinkOpenTarget {
  return value === "external" || value === "browser-tab";
}
