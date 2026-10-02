// PTY出力からOSC 133（シェル統合のセマンティックプロンプト）を拾い、タブで今実行中のコマンド行を追う。
// シェル統合はコマンド実行の開始（C）にkittyの拡張`cmdline_url=<パーセントエンコードしたコマンド行>`を
// 付けて送り、次のプロンプトの開始（A）・コマンドの終了（D）で実行中でなくなる。
//
// libghostty-vtもOSC 133をパースするが、オプションの中身をコールバックで受け取る手段が無いため
// 生のバイト列を自前で走査する。走査は書き込み前のバイト列を覗くだけで、libghostty-vtへ渡す内容は変えない。
// PTY出力と同じストリームに乗るので、CLIを経由する通知と違って開始と終了が入れ替わって届くことが無い。

const ESC = 0x1b;
const BEL = 0x07;
/** `ESC ] 133 ;` */
const PREFIX = [ESC, 0x5d, 0x31, 0x33, 0x33, 0x3b];
/** 1つのシーケンスとして受け付ける長さの上限。終端が来ないまま溜め続けないため */
const MAX_PAYLOAD_BYTES = 16 * 1024;

export type CommandTrackerEvent =
  /** コマンドの実行開始。cmdlineはシェル統合が報告したコマンド行 */
  | { kind: "start"; cmdline: string }
  /** プロンプトの開始・コマンドの終了。実行中のコマンドは無くなった */
  | { kind: "end" };

/** `%XX`をバイトへ戻してUTF-8として読む。不正な`%`はそのまま残す */
export function decodeCmdlineUrl(value: string): string {
  const bytes: number[] = [];
  const raw = new TextEncoder().encode(value);
  for (let i = 0; i < raw.length; i++) {
    const b = raw[i] as number;
    if (b === 0x25 && i + 2 < raw.length) {
      const hex = String.fromCharCode(raw[i + 1] as number, raw[i + 2] as number);
      if (/^[0-9A-Fa-f]{2}$/u.test(hex)) {
        bytes.push(Number.parseInt(hex, 16));
        i += 2;
        continue;
      }
    }
    bytes.push(b);
  }
  return new TextDecoder().decode(new Uint8Array(bytes));
}

/** `133;`より後ろのペイロード（`C;cmdline_url=...`等）をイベントにする。関係無ければnull */
export function parseSemanticPromptPayload(payload: string): CommandTrackerEvent | null {
  const [kind, ...options] = payload.split(";");
  if (kind === "A" || kind === "D") return { kind: "end" };
  if (kind !== "C") return null;
  for (const option of options) {
    if (option.startsWith("cmdline_url=")) {
      return { kind: "start", cmdline: decodeCmdlineUrl(option.slice("cmdline_url=".length)) };
    }
  }
  // コマンド行の付かないC（他のシェル統合が出すもの）は何も変えない。素のCで記録を消すと、
  // 自前のCの直後に別のツールがCを出す環境で、記録したコマンド行がすぐ失われる
  return null;
}

/**
 * チャンク単位で届くPTY出力を走査する。シーケンスがチャンクの境目で切れても続きから拾う
 */
export function createCommandTracker(onEvent: (event: CommandTrackerEvent) => void) {
  /** PREFIXのうち直前のチャンクの末尾で一致済みのバイト数 */
  let matched = 0;
  /** PREFIXの後ろを集めている最中ならそのバイト列 */
  let payload: number[] | null = null;
  /** 終端のESC \ のESCまで読んだところ */
  let pendingEsc = false;

  function finish(): void {
    const bytes = payload;
    payload = null;
    pendingEsc = false;
    if (bytes === null) return;
    const event = parseSemanticPromptPayload(new TextDecoder().decode(new Uint8Array(bytes)));
    if (event) onEvent(event);
  }

  function feed(data: Uint8Array): void {
    let i = 0;
    while (i < data.length) {
      if (payload !== null) {
        const b = data[i] as number;
        if (pendingEsc) {
          // ESC \ ならST。それ以外のESCは中断扱い（新しいシーケンスが始まった）で、ESCから読み直す
          if (b === 0x5c) {
            i++;
            finish();
          } else {
            payload = null;
            pendingEsc = false;
            matched = 1;
            continue;
          }
          continue;
        }
        if (b === BEL) {
          i++;
          finish();
          continue;
        }
        if (b === ESC) {
          pendingEsc = true;
          i++;
          continue;
        }
        payload.push(b);
        i++;
        if (payload.length > MAX_PAYLOAD_BYTES) payload = null;
        continue;
      }
      if (matched === 0) {
        // 大半のチャンクはESCを含まないか少ないので、ESCまで一気に飛ばす
        const next = data.indexOf(ESC, i);
        if (next === -1) return;
        i = next + 1;
        matched = 1;
        continue;
      }
      const b = data[i] as number;
      if (b === PREFIX[matched]) {
        matched++;
        i++;
        if (matched === PREFIX.length) {
          matched = 0;
          payload = [];
        }
        continue;
      }
      // 一致が途切れた。そのバイト自体がESCなら新しい候補の先頭になる
      matched = b === ESC ? 1 : 0;
      i++;
    }
  }

  return { feed };
}

export type CommandTracker = ReturnType<typeof createCommandTracker>;
