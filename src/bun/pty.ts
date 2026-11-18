// Bun.Terminal（Bun 1.3.5+）ベースのPTY実装。
// node-ptyと異なり、Bun Worker内でもTerminalのdata/exitコールバックが正常に発火する。
// WindowsではBun 1.3.14+が必要（ConPTY実装がそのバージョンから入った）。

import { homedir } from "node:os";
import { defaultMacLang, fillMissingLocale } from "./macos-locale";
import { findNativeArtifact } from "./native-artifacts";
import { applyWslCdArg, windowsPathToWslMountPath } from "./wsl-cwd";

const isWindows = process.platform === "win32";

export interface PtyOptions {
  /** 起動するシェルの実行コマンド。スペース区切りで単純分割される（クォート・エスケープ非対応）。省略時はOS標準シェル */
  shell?: string;
  cols: number;
  rows: number;
  cwd?: string;
  term?: string;
  /** 追加で設定する環境変数（process.envへ上書きマージする） */
  env?: Record<string, string>;
  /**
   * 指定すると、シェルの対話セッションの代わりにこのコマンドを実行する（ワンショット実行）。
   * シェルの-l -c/-Command相当でexecされるため、コマンド終了=シェルプロセス終了となり、
   * PTYのonExitが自然に発火する（popupのワンショット実行で使用）。ログインシェル経由なので
   * .zshrc/.bash_profile等でのみPATHに追加されたコマンドも解決できる
   */
  command?: string;
  /**
   * 指定すると、commandの標準出力をこのファイルパスへリダイレクトする
   * （`popup open --capture-stdout`用。UIはPTY自体に残ったまま描画され、
   * コマンドの標準出力だけを分離してファイルへ落とす。fzf-tmuxの`fzf ... > $fifo`と同じ発想）。
   * 常にWindows側の絶対パス（アプリ本体側のtmpdir()）で渡される。wsl.exeプロファイルの場合は
   * windowsPathToWslMountPathでLinux側から書けるパスへ変換した上でbash -l -c経由で実行する
   */
  captureStdoutTo?: string;
}

export interface Pty {
  readonly pid: number;
  onData(fn: (data: Uint8Array) => void): void;
  /** codeはシグナル等で終了コードを持たずに終わった場合null */
  onExit(fn: (code: number | null) => void): void;
  write(data: string | Uint8Array): void;
  resize(cols: number, rows: number): void;
  kill(): void;
}

/**
 * PTYの子プロセスへ制御端末を持たせるラッパー（src/native/ptyexec.c、`mise run build:native`で生成）。
 * Bun.TerminalはPTYを子の制御端末に設定しないため、これを挟まないとniwatermを端末から起動した際に
 * PTY内の子がniwaterm自身の起動元ttyを制御端末として引き継ぎ、/dev/ttyを開くプログラム（fzf等）が
 * SIGTTIN/SIGTTOUで停止する（詳細: docs/known-issues/macos-pty-child-controlling-terminal.md）
 */
const PTYEXEC_REL_PATH = "vendor/libghostty/lib/niwaterm-ptyexec";

/** 未解決を表す番兵。findNativeArtifactはundefinedを返しうるため、キャッシュ済みかの判別に使う */
const UNRESOLVED = Symbol("unresolved");
let ptyExecPathCache: string | undefined | typeof UNRESOLVED = UNRESOLVED;

/** ptyexecラッパーの絶対パス。Windows（ConPTY）と未ビルド時はundefined */
export function ptyExecPath(): string | undefined {
  if (isWindows) return undefined;
  if (ptyExecPathCache === UNRESOLVED) ptyExecPathCache = findNativeArtifact(PTYEXEC_REL_PATH);
  return ptyExecPathCache;
}

/**
 * PTY起動コマンドの先頭へptyexecラッパーを差し込む。
 * ラッパーが無い場合（Windows・`build:native`未実行）はcmdをそのまま返し、
 * 制御端末が設定されない従来どおりの起動にフォールバックする
 */
export function withPtyExec(cmd: string[], ptyExec: string | undefined): string[] {
  if (!ptyExec || cmd.length === 0) return cmd;
  return [ptyExec, ...cmd];
}

/**
 * Windowsで使うConPTYの中継exe（src/native/conptyrelay.c、`mise run build:native`で生成）と、
 * 同じフォルダに置く新しいConPTY。OS標準のConPTYは子の出力を描き直すため、OSC 133の位置ずれや
 * APCの欠落が起きる（ADR 0009）
 */
const CONPTY_RELAY_REL_PATH = "vendor/libghostty/bin/niwaterm-conpty.exe";
const CONPTY_REL_PATHS = [
  "vendor/libghostty/bin/conpty.dll",
  "vendor/libghostty/bin/OpenConsole.exe",
];

let conptyRelayPathCache: string | undefined | typeof UNRESOLVED = UNRESOLVED;

/** ConPTYの中継exeの絶対パス。Windows以外と、中継exe・conpty.dll・OpenConsole.exeのどれかが無いときはundefined */
export function conptyRelayPath(): string | undefined {
  if (!isWindows) return undefined;
  if (conptyRelayPathCache === UNRESOLVED) {
    const relay = findNativeArtifact(CONPTY_RELAY_REL_PATH);
    conptyRelayPathCache =
      relay && CONPTY_REL_PATHS.every((rel) => findNativeArtifact(rel) !== undefined)
        ? relay
        : undefined;
  }
  return conptyRelayPathCache;
}

const RELAY_FRAME_INPUT = 0;
const RELAY_FRAME_RESIZE = 1;

/** 中継exeの標準入力へ送る1フレーム。[種類 1バイト][長さ u32 LE][中身] */
export function encodeRelayFrame(type: number, payload: Uint8Array): Uint8Array {
  const frame = new Uint8Array(5 + payload.length);
  const view = new DataView(frame.buffer);
  view.setUint8(0, type);
  view.setUint32(1, payload.length, true);
  frame.set(payload, 5);
  return frame;
}

/** リサイズのフレームの中身。cols・rowsをu16 LEで並べる */
export function encodeRelayResize(cols: number, rows: number): Uint8Array {
  const payload = new Uint8Array(4);
  const view = new DataView(payload.buffer);
  view.setUint16(0, cols, true);
  view.setUint16(2, rows, true);
  return encodeRelayFrame(RELAY_FRAME_RESIZE, payload);
}

/**
 * 起動するシェルのコマンドライン。
 * Windowsにはログインシェルの概念が無いため、プロファイル読み込みは各シェルの既定に任せる。
 * shellはスペース区切りで単純分割する（クォート・エスケープ非対応）。WSLディストロ起動
 * （"wsl.exe -d Ubuntu"等）やシェルプロファイルの引数指定に対応するため
 */
export function shellCommand(shell: string | undefined): string[] {
  if (shell) {
    const parts = shell.split(" ").filter((s) => s.length > 0);
    if (parts.length > 0) return parts;
  }
  return isWindows ? ["powershell.exe", "-NoLogo"] : ["/bin/zsh", "-il"];
}

/** PowerShellの二重引用符リテラル内でそのまま安全に使えるようエスケープする（バッククォートで`"`をエスケープ） */
function quoteForPowerShell(path: string): string {
  return `"${path.replaceAll("`", "``").replaceAll('"', '`"')}"`;
}

/** POSIXシェルのシングルクォートリテラル内でそのまま安全に使えるようエスケープする */
function quoteForPosixShell(path: string): string {
  return `'${path.replaceAll("'", `'\\''`)}'`;
}

/**
 * cmd（シェル起動コマンド配列）へ、シェルの対話セッションの代わりにcommandを実行させる引数を追記する。
 * 必ずapplyWslCdArg（--cdの追記）より後に呼ぶこと: wsl.exeの`-e`以降は全てLinux側でexecする
 * コマンドの引数として扱われるため、`--cd`は`-e`より前に無ければならない。
 */
export function appendCommandArgs(
  cmd: string[],
  command: string | undefined,
  captureStdoutTo: string | undefined,
): void {
  if (command === undefined) return;
  const head = cmd[0]?.toLowerCase();
  if (head === "powershell.exe" || head === "pwsh.exe") {
    const withCapture = captureStdoutTo
      ? `${command} > ${quoteForPowerShell(captureStdoutTo)}`
      : command;
    cmd.push("-Command", withCapture);
    return;
  }
  if (head === "wsl.exe") {
    // `-e`（--exec）で`bash -c 'exec "$SHELL" -l -i -c "<command>"'`という1コマンドに包んでexecする。
    // `--`は使わない: wsl.exeは`--`以降のコマンドラインをユーザーの既定シェルにもう一度解釈させるため、
    // commandの`$var`・`$(...)`・`"$@"`がbashへ届く前に展開されてしまう
    // （詳細: docs/known-issues/wsl-double-dash-reparses-command-in-default-shell.md）。
    // 外側のbashは$SHELL（ユーザーの実際のログインシェル）を展開してexecするだけのブートストラップ。
    // -l（ログイン）だけでは不十分: zsh/bashとも-cでコマンドを渡すと「非インタラクティブ」扱いになり、
    // インタラクティブシェル専用の初期化ファイル（.zshrc等。niwaterm CLI自身や、bun/cargo/pnpm/nvm等の
    // PATH追加は大抵ここにある）が読まれない。-i（インタラクティブ強制）を併用することで.zshrc等も
    // 読ませる（詳細: .mywork/work-logs/2026-08-22-tab-respawn-command-non-login-shell-path-issue.md）。
    // Windows側の絶対パス（tmpdir()由来）は/mnt/c/...形式に変換すればLinux側からも書き込める
    // （WSL2のデフォルトドライブマウント前提）。bash経由になる分、commandの内容はシェル構文
    // としてそのまま解釈される（パイプ・クォート等が使える）
    let withCapture = command;
    if (captureStdoutTo) {
      const wslPath = windowsPathToWslMountPath(captureStdoutTo);
      if (wslPath) withCapture = `${command} > ${quoteForPosixShell(wslPath)}`;
    }
    const inner = `exec "$SHELL" -l -i -c ${quoteForPosixShell(withCapture)}`;
    cmd.push("-e", "bash", "-c", inner);
    return;
  }
  // Unix系シェル(zsh/bash/fish等): -l（ログイン）だけでは不十分: -cでコマンドを渡すと
  // 「非インタラクティブ」扱いになり、インタラクティブシェル専用の初期化ファイル（.zshrc等。
  // niwaterm CLI自身や、bun/cargo/pnpm/nvm等のPATH追加は大抵ここにある）が読まれない。
  // -i（インタラクティブ強制）を併用することで.zshrc等も読ませる
  // （詳細: .mywork/work-logs/2026-08-22-tab-respawn-command-non-login-shell-path-issue.md）。
  // 実行完了でシェルは自動終了する
  const withCapture = captureStdoutTo
    ? `${command} > ${quoteForPosixShell(captureStdoutTo)}`
    : command;
  cmd.push("-l", "-i", "-c", withCapture);
}

/**
 * アプリのprocess.envには入っているが、タブのシェルへ引き継いではいけない変数。
 *
 * 1. 起動元ターミナルの素性（TMUX等）。別のマルチプレクサのペインからniwatermを起動すると
 *    これらが漏れ、$TMUXの有無で描画先を切り替えるツール（fzfの`--tmux`は描画をtmuxの
 *    popupへ丸投げする）がniwatermのタブをtmuxの中だと誤認する。画面が起動元のtmuxへ
 *    吸われてタブが操作不能に見える。
 * 2. niwaterm自身のビルド時設定（NIWATERM_APP_NAME）。タブのシェルが読む必要は無く、
 *    残っているとタブ内で`mise run start`したときにブランチではなく起動中インスタンスの
 *    アプリ名が採用され、wipのつもりでdailyを組んでしまう。
 * 3. 起動中インスタンスの設定ディレクトリ（NIWATERM_CONFIG_DIR）。タブ内から起動した別インスタンスや
 *    `niwa init`が、そのタブを開いているインスタンス用の設定ディレクトリを引き継いでしまう。
 * 4. 起動元タブのNIWATERM_TAB_ID。niwatermのタブ内からniwatermを起動すると残り、タブIDを注入しない
 *    `niwa.shell.run`の子シェルがタブ内だと誤認する。シェル統合がOSC 7をstdoutへ書いて結果を汚し、
 *    `niwa tab var set`は無関係な起動元のタブへ書き込む。タブ・ポップアップは自分のIDを明示的に注入する。
 *    WSLENVに名前が残っていても、値が無い変数はWSL側へ渡らない。
 */
const INHERITED_TERMINAL_ENV_KEYS = [
  "TMUX",
  "TMUX_PANE",
  // TERM_PROGRAMはniwaterm自身の名前へ差し替えるため、版数だけが起動元のまま残らないようにする
  "TERM_PROGRAM_VERSION",
  // GNU screen
  "STY",
  "ZELLIJ",
  "ZELLIJ_PANE_ID",
  "ZELLIJ_SESSION_NAME",
  // タブ側が参照するアプリ名はAPP_VARIANT（board.ts・popup.tsが明示的に注入する）
  "NIWATERM_APP_NAME",
  "NIWATERM_CONFIG_DIR",
  "NIWATERM_TAB_ID",
];

/**
 * WSLは`wsl.exe`起動時にWindows側の環境変数を既定では継承しない
 * （`WSLENV`にコロン区切りで明示リストした変数名だけがLinux側へ渡る仕様）。
 * niwatermがPTY起動時に注入する変数（NIWATERM_TAB_ID等）をWSL内のシェルまで
 * 届けるため、WSLプロファイル起動時のみWSLENVへ追記する
 */
export function buildEnv(
  cmd: string[],
  term: string,
  extraEnv: Record<string, string> | undefined,
): Record<string, string> {
  const env: Record<string, string> = { ...process.env, TERM: term, TERM_PROGRAM: "niwaterm" };
  for (const key of INHERITED_TERMINAL_ENV_KEYS) delete env[key];
  Object.assign(env, extraEnv);
  if (process.platform === "darwin") fillMissingLocale(env, defaultMacLang());
  if (isWindows && extraEnv && cmd[0]?.toLowerCase() === "wsl.exe") {
    const existing = env["WSLENV"]?.split(":").filter((v) => v.length > 0) ?? [];
    env["WSLENV"] = [...new Set([...existing, ...Object.keys(extraEnv)])].join(":");
  }
  return env;
}

export function createPty(opts: PtyOptions): Pty {
  const term = opts.term ?? "xterm-256color";
  const cmd = shellCommand(opts.shell);

  // wsl.exeプロファイル起動時、Windows側のcwdをそのままBun.spawnへ渡すと
  // Linux側で/mnt/c/...等にマップされてしまうため、必要ならcmdへ--cdを追記する
  // （詳細: wsl-cwd.ts）
  const spawnCwd = applyWslCdArg(cmd, opts.cwd);
  appendCommandArgs(cmd, opts.command, opts.captureStdoutTo);

  const env = buildEnv(cmd, term, opts.env);
  const relay = conptyRelayPath();
  if (relay) return createRelayPty(relay, cmd, env, spawnCwd, opts.cols, opts.rows);
  return createBunTerminalPty(cmd, env, spawnCwd, term, opts.cols, opts.rows);
}

/**
 * Bun.spawnを呼び、cwdが原因の失敗ならホームディレクトリで再試行する。
 * uv_spawnのENOENTはcwd不在・実行ファイル不在いずれでも発生し、エラー自体からは
 * 区別できない（libuv/Windowsの既知の癖）。spawnCwdを明示指定していた場合は
 * cwd起因（例: WSL側CLIから渡されたパスがWindows側に存在しない）を疑い、
 * homedir()へフォールバックして再試行する。フォールバックでも失敗する場合は
 * シェルコマンド自体の問題とみなしそのまま投げる
 */
function spawnWithCwdFallback<T>(spawn: (cwd: string) => T, spawnCwd: string | undefined): T {
  try {
    return spawn(spawnCwd ?? homedir());
  } catch (err) {
    if (spawnCwd === undefined) throw err;
    console.log(
      `[bun] failed to spawn pty with cwd=${spawnCwd}, falling back to home directory: ${String(err)}`,
    );
    return spawn(homedir());
  }
}

/**
 * Windowsで、同梱した新しいConPTYを中継exe経由で使うPTY（ADR 0009）。
 * cwd・環境変数は中継exeに渡し、中継exeがそのままシェルへ引き継ぐ
 */
function createRelayPty(
  relay: string,
  cmd: string[],
  env: Record<string, string>,
  spawnCwd: string | undefined,
  cols: number,
  rows: number,
): Pty {
  let onDataFn: ((data: Uint8Array) => void) | null = null;
  let onExitFn: ((code: number | null) => void) | null = null;

  const proc = spawnWithCwdFallback(
    (cwd) =>
      Bun.spawn([relay, String(cols), String(rows), "--", ...cmd], {
        env,
        cwd,
        stdin: "pipe",
        stdout: "pipe",
        stderr: "pipe",
        windowsHide: true,
      }),
    spawnCwd,
  );

  async function pumpOutput(): Promise<void> {
    for await (const chunk of proc.stdout) onDataFn?.(chunk);
  }
  async function logStderr(): Promise<void> {
    const stderr = await new Response(proc.stderr).text();
    if (stderr.trim() !== "") console.log(`[bun] niwaterm-conpty: ${stderr.trim()}`);
  }
  // 中継exeの終了はパイプに残った出力より先に届きうる。最後の出力（終了直前のエラーメッセージ等）を
  // 描画し終えてから終了を伝えないと、受け手が端末を破棄した後に出力が来て捨てられる
  async function notifyExit(output: Promise<void>): Promise<void> {
    const code = await proc.exited;
    await output.catch(() => {});
    onExitFn?.(proc.signalCode ? null : code);
  }
  void notifyExit(pumpOutput());
  void logStderr();

  function send(frame: Uint8Array): void {
    try {
      proc.stdin.write(frame);
      proc.stdin.flush();
    } catch {
      // 中継exeが既に終わっている。終了はonExitで伝わる
    }
  }

  return {
    pid: proc.pid,
    onData(fn) {
      onDataFn = fn;
    },
    onExit(fn) {
      onExitFn = fn;
    },
    write(data) {
      const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data;
      if (bytes.length > 0) send(encodeRelayFrame(RELAY_FRAME_INPUT, bytes));
    },
    resize(newCols, newRows) {
      send(encodeRelayResize(newCols, newRows));
    },
    kill() {
      // 中継exeはJobオブジェクトでシェルとOpenConsole.exeを道連れにするので、中継exeだけ止めればよい
      proc.kill();
    },
  };
}

function createBunTerminalPty(
  cmd: string[],
  env: Record<string, string>,
  spawnCwd: string | undefined,
  term: string,
  cols: number,
  rows: number,
): Pty {
  let onDataFn: ((data: Uint8Array) => void) | null = null;
  let onExitFn: ((code: number | null) => void) | null = null;

  const terminal = new Bun.Terminal({
    cols,
    rows,
    name: term,
    data(_terminal, data) {
      onDataFn?.(data);
    },
  });

  const spawnOptions = {
    // TerminalOptions.nameはTERM環境変数を設定しないため明示的に渡す
    env,
    terminal,
    onExit(_proc: Bun.Subprocess, exitCode: number | null) {
      onExitFn?.(exitCode);
    },
  };

  // 制御端末の設定はcmdの組み立て（wsl.exeの--cd・シェルの-l -i -c）が全て終わった後に行う。
  // 先頭要素でシェル種別を判定している処理があるため、ラップは最後の最後に噛ませる
  const spawnArgv = withPtyExec(cmd, ptyExecPath());

  const proc = spawnWithCwdFallback(
    (cwd) => Bun.spawn(spawnArgv, { ...spawnOptions, cwd }),
    spawnCwd,
  );

  function onData(fn: (data: Uint8Array) => void): void {
    onDataFn = fn;
  }

  function onExit(fn: (code: number | null) => void): void {
    onExitFn = fn;
  }

  function write(data: string | Uint8Array): void {
    terminal.write(data);
    // Bun.Terminal.write()はptyのline discipline処理（ISIG検知によるシグナル生成）を
    // バイパスするため、Ctrl+C(ETX, 0x03)を書き込むだけではSIGINTが生成されない。
    // フォアグラウンドプロセスグループへ直接送ることで代替する。
    // Windowsにはプロセスグループが無く、ConPTYがCtrl+Cをコンソール入力として解釈するため不要。
    if (!isWindows && data === "\x03") {
      try {
        process.kill(-proc.pid, "SIGINT");
      } catch {}
    }
  }

  function resize(cols: number, rows: number): void {
    terminal.resize(cols, rows);
    // PTYが子の制御端末なら、kernelがwinsizeの変更時にフォアグラウンドのプロセスグループへ
    // SIGWINCHを配る。ここから重ねて送ると、シェルがジョブを動かしている間にシェルのグループへ
    // 届いてしまい、zshがZLE内から起動したnvim等から端末を奪ってジョブごと停止させる
    // （詳細: docs/known-issues/pty-resize-sigwinch-to-shell-suspends-foreground-job.md）。
    // Windowsにはプロセスグループもシグナルも無く、ConPTY側がサイズ変更を子へ通知する。
    if (isWindows || ptyExecPath()) return;
    // ptyexecが無いとPTYが制御端末にならずkernelは配らないので、シェルの$COLUMNS等が
    // 古いサイズのまま固着しないよう自前で送る
    try {
      process.kill(-proc.pid, "SIGWINCH");
    } catch {}
  }

  function kill(): void {
    // terminal.close()でPTYマスター側を閉じ、シェル側にSIGHUPを送って終了させる。
    // proc.kill()（SIGTERM）だけでは対話型シェルが無視し、プロセスが残り続けることがある。
    terminal.close();
    proc.kill();
  }

  return { pid: proc.pid, onData, onExit, write, resize, kill };
}
