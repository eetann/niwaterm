// Bun.Terminal（Bun 1.3.5+）ベースのPTY実装。
// node-ptyと異なり、Bun Worker内でもTerminalのdata/exitコールバックが正常に発火する。
// WindowsではBun 1.3.14+が必要（ConPTY実装がそのバージョンから入った）。

import { homedir } from "node:os";
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
  onExit(fn: (code: number) => void): void;
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
 * 必ずapplyWslCdArg（--cdの追記）より後に呼ぶこと: wsl.exeの`--`以降は全てLinux側でexecする
 * コマンドの引数として扱われるため、`--cd`は`--`より前に無ければならない。
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
    // `--`以降を`bash -c 'exec "$SHELL" -l -i -c "<command>"'`という1コマンドに包んでexecする。
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
    cmd.push("--", "bash", "-c", inner);
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
 *    `niwaterm init`が、そのタブを開いているインスタンス用の設定ディレクトリを引き継いでしまう。
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

  let onDataFn: ((data: Uint8Array) => void) | null = null;
  let onExitFn: ((code: number) => void) | null = null;

  const terminal = new Bun.Terminal({
    cols: opts.cols,
    rows: opts.rows,
    name: term,
    data(_terminal, data) {
      onDataFn?.(data);
    },
  });

  const spawnOptions = {
    // TerminalOptions.nameはTERM環境変数を設定しないため明示的に渡す
    env: buildEnv(cmd, term, opts.env),
    terminal,
    onExit(_proc: Bun.Subprocess, exitCode: number | null) {
      onExitFn?.(exitCode ?? 0);
    },
  };

  // 制御端末の設定はcmdの組み立て（wsl.exeの--cd・シェルの-l -i -c）が全て終わった後に行う。
  // 先頭要素でシェル種別を判定している処理があるため、ラップは最後の最後に噛ませる
  const spawnArgv = withPtyExec(cmd, ptyExecPath());

  let proc: Bun.Subprocess;
  try {
    proc = Bun.spawn(spawnArgv, { ...spawnOptions, cwd: spawnCwd ?? homedir() });
  } catch (err) {
    // uv_spawnのENOENTはcwd不在・実行ファイル不在いずれでも発生し、エラー自体からは
    // 区別できない（libuv/Windowsの既知の癖）。spawnCwdを明示指定していた場合は
    // cwd起因（例: WSL側CLIから渡されたパスがWindows側に存在しない）を疑い、
    // homedir()へフォールバックして再試行する。フォールバックでも失敗する場合は
    // シェルコマンド自体の問題とみなしそのまま投げる
    if (spawnCwd === undefined) throw err;
    console.log(
      `[bun] failed to spawn pty with cwd=${spawnCwd}, falling back to home directory: ${String(err)}`,
    );
    proc = Bun.spawn(spawnArgv, { ...spawnOptions, cwd: homedir() });
  }

  function onData(fn: (data: Uint8Array) => void): void {
    onDataFn = fn;
  }

  function onExit(fn: (code: number) => void): void {
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
    // Bun.Terminal.resize()はwinsize（TIOCSWINSZ相当）は更新するが、
    // SIGWINCHをフォアグラウンドプロセスグループへ送出しない。
    // このためシェルの$COLUMNS等リサイズ通知に依存する値が更新されず、
    // プロンプト側の罫線幅計算などが古いサイズのまま固着する。
    // Windowsにはプロセスグループもシグナルも無く、ConPTY側がサイズ変更を子へ通知する。
    if (isWindows) return;
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
