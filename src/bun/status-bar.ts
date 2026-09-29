// ウィンドウ下端のステータスバー（設定のstatusBar）の部品の評価と、押された部品の実行。
// render・runはユーザー設定の関数でbun側でしか呼べないため、webviewへは部品のidと評価後の
// 文字列だけを送る（hoverButtonsと同じ方式）。builtin:modeはwebview側の状態なのでここでは扱わない。
//
// 評価はウィンドウごとに、状況（フォーカス中タブ・タブ変数・Board・ワークスペース）が前回と
// 変わった時だけ走らせる。描画は出力のたびに16ms間隔で呼ばれるので、毎回renderを呼ぶと
// ユーザーの関数（コマンド実行等）が出力の勢いで連打されてしまう。
// 状況と無関係に変わる値（時計等）はintervalで別に呼び直す。
// ユーザーがバーを隠している間はrenderを一切呼ばず、出し直した時にまとめて評価する。

import type {
  Niwa,
  ResolvedStatusBarConfig,
  ResolvedStatusBarItem,
  StatusBarComponentConfig,
  StatusBarContext,
  StatusBarRenderFn,
  StatusBarSection,
  StatusBarSegment,
  StatusBarSource,
  StatusBarValue,
} from "@niwaterm/config";

/** 関数を含む解決済みの1部品。webviewへ渡せない部分をbun側に残すための型 */
export interface StatusBarComponentEntry {
  id: string;
  section: StatusBarSection;
  /** renderを持つ部品ではnull */
  source: StatusBarSource | null;
  render: StatusBarRenderFn | undefined;
  /** renderを呼び直す周期(ms)。nullなら状況が変わった時だけ */
  interval: number | null;
  /** 未指定は空文字列 */
  prefix: string;
  /** 未指定は空文字列 */
  color: string;
  /** 未指定は空文字列 */
  tooltip: string;
  run: StatusBarComponentConfig["run"];
}

export interface StatusBarDefinition {
  visible: boolean;
  css: string;
  components: StatusBarComponentEntry[];
}

export interface StatusBarHandle {
  /** webviewへ配る定義（関数を除いたもの） */
  resolved(): ResolvedStatusBarConfig;
  /** 描画のたびに呼ぶ。状況が前回と変わったウィンドウだけ部品を評価し直す */
  update(windowId: string, ctx: StatusBarContext): void;
  /** webviewが読み込み直された時に、評価済みの値を送り直す */
  resend(windowId: string): void;
  /** 閉じたウィンドウの状況・値を捨てる */
  forget(windowId: string): void;
  /**
   * 状況が変わっていなくても部品を評価し直す（renderが外部の状態を読む場合に、変化を知らせる口）。
   * itemId省略で全部品、全ウィンドウ。未知のidならfalse
   */
  refresh(itemId?: string): boolean;
  /** ユーザーがバーを隠したか。隠している間はrender・intervalを止め、出した時に評価し直す */
  setHidden(hidden: boolean): void;
  /** webviewで押された部品のrunを、そのウィンドウの今の状況で呼ぶ */
  run(windowId: string, itemId: string): Promise<void>;
  /** intervalのタイマーを止める。設定のリロードで作り直す前に呼ぶ */
  dispose(): void;
}

export interface CreateStatusBarOptions {
  /** 評価した値をそのウィンドウのwebviewへ送る。内容が前回と変わった時だけ呼ばれる */
  send(windowId: string, values: Record<string, StatusBarValue>): void;
  /**
   * builtin:cwdで`~`へ縮めるホームディレクトリ。タブのシェルごとに違う（WSLのタブはLinux側の
   * ホーム）ので、評価する状況ごとに引く
   */
  homeDirOf(ctx: StatusBarContext): string;
  /** 作った時点でユーザーがバーを隠しているか */
  hidden: boolean;
}

interface WindowState {
  ctx: StatusBarContext;
  key: string;
  values: Record<string, StatusBarValue>;
  /** 最後に送った値。未送信は空文字列 */
  sent: string;
  /** 部品id → 最後に始めた評価の通し番号。非同期のrenderが追い越された時に古い結果を捨てる */
  seq: Map<string, number>;
  /** 評価中の部品id。intervalが前回の評価を待たずに重ねて呼ばないようにする */
  pending: Set<string>;
  flushScheduled: boolean;
}

const EMPTY_VALUE: StatusBarValue = { text: "", html: "", tooltip: "", color: "" };

/** cwdの先頭がホームなら`~`へ縮める。区切りの途中（/home/userx等）では縮めない */
export function abbreviateHome(path: string, homeDir: string): string {
  if (homeDir === "") return path;
  const home = homeDir.replace(/[\\/]+$/, "");
  if (path === home) return "~";
  for (const sep of ["/", "\\"]) {
    if (path.startsWith(home + sep)) return `~${sep}${path.slice(home.length + 1)}`;
  }
  return path;
}

function sourceValue(source: StatusBarSource, ctx: StatusBarContext, homeDir: string): string {
  if (source.kind === "tab-var") return ctx.vars[source.name] ?? "";
  switch (source.id) {
    case "cwd":
      return ctx.cwd === undefined ? "" : abbreviateHome(ctx.cwd, homeDir);
    case "workspace":
      return ctx.workspaceName;
    case "board":
      return ctx.boardName ?? "";
    case "mode":
      return "";
  }
}

/** renderの戻り値を表示用の値へ均す。想定外の型は何も出さない */
function segmentOf(result: unknown): StatusBarSegment | null {
  if (typeof result === "string") return { text: result };
  if (typeof result !== "object" || result === null) return null;
  return result as StatusBarSegment;
}

function stringOr(value: unknown, fallback: string): string {
  return typeof value === "string" && value !== "" ? value : fallback;
}

function toValue(entry: StatusBarComponentEntry, segment: StatusBarSegment | null): StatusBarValue {
  if (segment === null) return EMPTY_VALUE;
  const text = stringOr(segment.text, "");
  const html = stringOr(segment.html, "");
  if (text === "" && html === "") return EMPTY_VALUE;
  return {
    // 値が空の部品にprefixだけが残ると意味の無いラベルが並ぶので、中身がある時だけ付ける
    text: text === "" ? "" : `${entry.prefix}${text}`,
    html,
    tooltip: stringOr(segment.tooltip, entry.tooltip),
    color: stringOr(segment.color, entry.color),
  };
}

export function createStatusBar(
  definition: StatusBarDefinition,
  niwa: Niwa,
  opts: CreateStatusBarOptions,
): StatusBarHandle {
  const resolvedConfig: ResolvedStatusBarConfig = {
    visible: definition.visible,
    css: definition.css,
    sections: { left: [], center: [], right: [] },
  };
  for (const entry of definition.components) {
    const item: ResolvedStatusBarItem = {
      id: entry.id,
      kind: entry.source?.kind === "builtin" && entry.source.id === "mode" ? "mode" : "value",
      clickable: entry.run !== undefined,
    };
    resolvedConfig.sections[entry.section].push(item);
  }
  const byId = new Map(definition.components.map((entry) => [entry.id, entry]));
  const valueComponents = definition.visible
    ? definition.components.filter(
        (entry) => !(entry.source?.kind === "builtin" && entry.source.id === "mode"),
      )
    : [];
  const windows = new Map<string, WindowState>();
  /** 部品id → 直前に出したエラー。intervalで同じ失敗を毎周期ログへ積まないために持つ */
  const lastErrors = new Map<string, string>();
  let hidden = opts.hidden;

  function flush(windowId: string): void {
    const state = windows.get(windowId);
    if (!state) return;
    state.flushScheduled = false;
    const serialized = JSON.stringify(state.values);
    if (serialized === state.sent) return;
    state.sent = serialized;
    opts.send(windowId, { ...state.values });
  }

  function commit(windowId: string, state: WindowState, id: string, value: StatusBarValue): void {
    state.values[id] = value;
    // 同じ描画で評価した部品の結果を1回のRPCへまとめる
    if (state.flushScheduled) return;
    state.flushScheduled = true;
    queueMicrotask(() => flush(windowId));
  }

  function logError(entry: StatusBarComponentEntry, err: unknown): void {
    const message = String(err);
    if (lastErrors.get(entry.id) === message) return;
    lastErrors.set(entry.id, message);
    console.log(`[bun] statusBar ${entry.id} render failed: ${message}`);
  }

  function evaluate(windowId: string, state: WindowState, entry: StatusBarComponentEntry): void {
    if (entry.render === undefined) {
      const text =
        entry.source === null
          ? ""
          : sourceValue(entry.source, state.ctx, opts.homeDirOf(state.ctx));
      // builtin:cwdは縮めた形を出すので、省略前の全体をツールチップで引けるようにする
      const tooltip =
        entry.tooltip === "" && entry.source?.kind === "builtin" && entry.source.id === "cwd"
          ? (state.ctx.cwd ?? "")
          : entry.tooltip;
      commit(windowId, state, entry.id, toValue({ ...entry, tooltip }, { text }));
      return;
    }
    const seq = (state.seq.get(entry.id) ?? 0) + 1;
    state.seq.set(entry.id, seq);
    state.pending.add(entry.id);
    const render = entry.render;
    void (async () => {
      let value = EMPTY_VALUE;
      try {
        value = toValue(entry, segmentOf(await render(state.ctx, niwa)));
        lastErrors.delete(entry.id);
      } catch (err) {
        logError(entry, err);
      }
      if (state.seq.get(entry.id) !== seq) return;
      state.pending.delete(entry.id);
      if (windows.get(windowId) !== state) return;
      commit(windowId, state, entry.id, value);
    })();
  }

  const timers = valueComponents
    .filter((entry) => entry.render !== undefined && entry.interval !== null)
    .map((entry) =>
      setInterval(() => {
        if (hidden) return;
        for (const [windowId, state] of windows) {
          if (state.pending.has(entry.id)) continue;
          evaluate(windowId, state, entry);
        }
      }, entry.interval ?? 0),
    );

  return {
    resolved() {
      return resolvedConfig;
    },
    update(windowId, ctx) {
      // 値を持つ部品が無くても状況は覚えておく。builtin:modeにもrunを書けるため
      if (!definition.visible) return;
      const key = JSON.stringify(ctx);
      let state = windows.get(windowId);
      if (state?.key === key) return;
      if (state === undefined) {
        state = {
          ctx,
          key,
          values: {},
          sent: "",
          seq: new Map(),
          pending: new Set(),
          flushScheduled: false,
        };
        windows.set(windowId, state);
      } else {
        state.ctx = ctx;
        state.key = key;
      }
      if (hidden) return;
      for (const entry of valueComponents) evaluate(windowId, state, entry);
    },
    refresh(itemId) {
      if (itemId !== undefined && !byId.has(itemId)) return false;
      if (hidden) return true;
      const targets =
        itemId === undefined
          ? valueComponents
          : valueComponents.filter((entry) => entry.id === itemId);
      for (const [windowId, state] of windows) {
        for (const entry of targets) evaluate(windowId, state, entry);
      }
      return true;
    },
    setHidden(next) {
      if (hidden === next) return;
      hidden = next;
      // 隠している間に変わった状況は評価していないので、出した時点の状況で全部品を評価し直す
      if (!hidden) this.refresh();
    },
    resend(windowId) {
      const state = windows.get(windowId);
      if (!state) return;
      state.sent = "";
      flush(windowId);
    },
    forget(windowId) {
      windows.delete(windowId);
    },
    async run(windowId, itemId) {
      const entry = byId.get(itemId);
      const ctx = windows.get(windowId)?.ctx;
      if (!entry?.run || !ctx) return;
      try {
        await entry.run(ctx, niwa);
      } catch (err) {
        console.log(`[bun] statusBar ${itemId} run failed: ${String(err)}`);
      }
    },
    dispose() {
      for (const timer of timers) clearInterval(timer);
      windows.clear();
    },
  };
}
