// niwa.keybindに渡す関数ハンドラの実行基盤（@niwaterm/configのNiwaインターフェースの実装）。
// niwa.keybind/niwa.prefix/niwa.unbindは「登録」のみ行い、実際の操作はしない
// （configファイル実行時に1回だけ呼ばれる）。niwa.tile/tab/popup/board/workspace/clipboardは
// 「実行」で、呼ばれた時点のworkspaceManagerの実際の状態を操作・参照する
// （キーバインドの関数ハンドラが実際に押された時に呼ばれるため、登録時とは別タイミング）。

import type {
  BindingEntry,
  BindingTarget,
  KeyBindingString,
  KeybindHandler,
  KeybindingsConfig,
  Niwa,
  NiwaNotifyOptions,
  SecondKeyString,
  ShellProfile,
} from "@niwaterm/config";
import { readClipboardText, writeClipboardText } from "./clipboard";
import { resolveShellProfileCommand } from "./shell-profiles";
import { runShellCommand } from "./shell-run";
import { tmuxKeysToBytes } from "./tmux-keys";
import type { WorkspaceManager } from "./workspace-manager";

export interface CreateNiwaApiDeps {
  workspaceManager: WorkspaceManager;
  /** ホットリロードでの変化を反映するため、呼び出し毎に評価する */
  getShellProfiles: () => ShellProfile[];
  /**
   * niwa.shell.runで実行するコマンドへ自動で環境変数として渡す、niwaterm CLIの接続先情報
   * （NIWATERM_SOCKET/NIWATERM_BRIDGE_PORT）。ipc-server.tsがniwa-api.tsに依存しているため
   * ここでは直接importできず、呼び出し元（config.ts）から注入する。tab.new/tab.respawn/
   * popup.open相当のPTY起動では自動付与済みだが、shell.runはPTYを使わないため同様に必要
   * （詳細: .mywork/work-logs/2026-08-22-tab-respawn-command-non-login-shell-path-issue.md）
   */
  getShellRunEnv: () => Record<string, string>;
  /**
   * shell.default（config.tsのshell設定）を返す。resolveShellProfileCommandは
   * shellProfile未指定時にcommand: undefinedを返すだけで、defaultShellへのフォールバックは
   * 責務外（tab.new/tab.respawnはworkspaceManager.newTab/respawnTab内部でこのフォールバックの
   * 恩恵を受けているが、shell.runはPTYを経由しないため自前で行う必要がある）
   */
  getDefaultShell: () => string | undefined;
  /**
   * OSのデスクトップ通知を出す。niwa-api.tsはElectrobunに直接依存しない設計のため
   * （テストでモックしやすくするため）、実体（Utils.showNotification）は呼び出し元が注入する
   */
  sendNotification: (opts: NiwaNotifyOptions) => void;
  /**
   * 設定ファイルを再読み込みする実体。index.tsのhandleConfigFileChanged
   * （ファイル監視での自動リロードと同じ処理）を注入する
   */
  reloadConfig: () => Promise<void>;
}

/** niwa.tile.resizeのamount省略時のratio増減幅 */
export const DEFAULT_RESIZE_AMOUNT = 0.05;

export interface NiwaApiHandle {
  niwa: Niwa;
  /** configファイル実行後に呼び出し、niwa.prefix/keybindで登録された内容を取り出す */
  extractKeybindingsConfig(): KeybindingsConfig;
  /** custom BindingTargetのidを受け取り、対応する関数ハンドラを実行する（RPC経由でbun側から呼ばれる） */
  runHandler(id: string): Promise<void>;
}

export function createNiwaApi(deps: CreateNiwaApiDeps): NiwaApiHandle {
  const { workspaceManager } = deps;

  let prefixBinding: KeyBindingString | undefined;
  let repeatTimeoutMs: number | undefined;
  const bindings = new Map<SecondKeyString, BindingEntry>();
  const direct = new Map<KeyBindingString, BindingEntry>();
  const handlerRegistry = new Map<string, KeybindHandler>();
  let handlerIdCounter = 0;

  function toBindingTarget(action: Parameters<Niwa["keybind"]>[1]): BindingTarget {
    if (typeof action !== "function") return action;
    const id = `handler-${handlerIdCounter++}`;
    handlerRegistry.set(id, action);
    return { kind: "custom", id };
  }

  function focusedTileCwd(tileId: string): string | undefined {
    const activeTabId = workspaceManager.getActiveTabId(tileId);
    if (!activeTabId) return undefined;
    const result = workspaceManager.getTabVar(activeTabId, "cwd");
    return result.found ? result.value : undefined;
  }

  const niwa: Niwa = {
    prefix(binding) {
      prefixBinding = binding;
    },
    repeatTimeout(ms) {
      repeatTimeoutMs = ms;
    },
    keybind(key, action, opts) {
      const target = toBindingTarget(action);
      const entry: BindingEntry = opts?.repeat ? { target, repeat: true } : target;
      if (opts?.noPrefix) {
        direct.set(key as KeyBindingString, entry);
      } else {
        bindings.set(key, entry);
      }
    },
    unbind(key, opts) {
      if (opts?.noPrefix) {
        direct.delete(key as KeyBindingString);
      } else {
        bindings.delete(key);
      }
    },
    sleep(ms) {
      return new Promise((resolve) => setTimeout(resolve, ms));
    },
    notify(opts) {
      deps.sendNotification(opts);
    },
    reloadConfig() {
      return deps.reloadConfig();
    },
    tile: {
      current() {
        const tileId = workspaceManager.getFocusedTileId();
        return { id: tileId, cwd: focusedTileCwd(tileId) };
      },
      split(opts) {
        const tileId = workspaceManager.getFocusedTileId();
        return workspaceManager.splitTile(tileId, opts.orientation, opts.ratio, opts.cwd);
      },
      focus(direction) {
        workspaceManager.focusDirection(direction);
      },
      resize(opts) {
        const tileId = workspaceManager.getFocusedTileId();
        return workspaceManager.resizeTileInDirection(
          tileId,
          opts.direction,
          opts.amount ?? DEFAULT_RESIZE_AMOUNT,
        );
      },
      zoom() {
        const tileId = workspaceManager.getFocusedTileId();
        return workspaceManager.toggleZoomTile(tileId) ?? false;
      },
      close() {
        const tileId = workspaceManager.getFocusedTileId();
        const activeTabId = workspaceManager.getActiveTabId(tileId);
        if (activeTabId) workspaceManager.closeTab(tileId, activeTabId);
      },
    },
    tab: {
      current() {
        const tileId = workspaceManager.getFocusedTileId();
        const tabId = workspaceManager.getActiveTabId(tileId);
        return tabId ? { tabId } : null;
      },
      create(opts) {
        const tileId = opts?.tileId ?? workspaceManager.getFocusedTileId();
        const resolved = resolveShellProfileCommand(deps.getShellProfiles(), opts?.shellProfile);
        if (!resolved.ok) {
          console.log(`[bun] niwa.tab.new: ${resolved.error}`);
          return null;
        }
        const tabId = workspaceManager.newTab(tileId, resolved.command, opts?.cwd);
        return tabId ? { tabId } : null;
      },
      respawn(tabId, opts) {
        const resolved = resolveShellProfileCommand(deps.getShellProfiles(), opts?.shellProfile);
        if (!resolved.ok) {
          console.log(`[bun] niwa.tab.respawn: ${resolved.error}`);
          return false;
        }
        return workspaceManager.respawnTab(tabId, resolved.command, opts?.cwd, opts?.command);
      },
      sendKeys(tabId, ...keys) {
        workspaceManager.handleInput(tabId, tmuxKeysToBytes(keys));
      },
      show(tabId) {
        return workspaceManager.showTab(tabId);
      },
      var: {
        get(tabId, key) {
          const result = workspaceManager.getTabVar(tabId, key);
          return result.found ? result.value : undefined;
        },
        set(tabId, key, value) {
          workspaceManager.setTabVar(tabId, key, value);
        },
        find(key, value) {
          return workspaceManager.findTabsByVar(key, value);
        },
      },
    },
    popup: {
      open(opts) {
        const tabId = workspaceManager.openPopup(opts);
        return tabId ? { tabId } : null;
      },
      run(command, opts) {
        const tabId = workspaceManager.openPopup({ ...opts, command, captureStdout: true });
        if (!tabId) return Promise.resolve(null);
        // openPopupと同期的に（間にawaitを挟まず）waitForPopupCloseを呼ぶ必要があるため、
        // このメソッドはasyncにしない。待機中にアクティブワークスペースが切り替わっても
        // 開いた時点のポップアップを見続けるための約束（詳細: workspace-manager.ts）
        return workspaceManager.waitForPopupClose().then((output) => output ?? "");
      },
    },
    board: {
      create(cwd) {
        return workspaceManager.newBoard(workspaceManager.getActiveWorkspaceId(), cwd);
      },
    },
    workspace: {
      create(cwd) {
        return workspaceManager.newWorkspace(cwd);
      },
      switch(workspaceId) {
        return workspaceManager.switchWorkspace(workspaceId);
      },
      move(workspaceId, index) {
        return workspaceManager.moveWorkspace(workspaceId, index);
      },
      swap(workspaceIdA, workspaceIdB) {
        return workspaceManager.swapWorkspaces(workspaceIdA, workspaceIdB);
      },
      list() {
        return workspaceManager
          .listWorkspaces()
          .map((entry) => ({ id: entry.workspaceId, name: entry.name, active: entry.active }));
      },
      current() {
        return workspaceManager.getActiveWorkspaceId();
      },
    },
    clipboard: {
      write(text) {
        writeClipboardText(text);
      },
      read() {
        return readClipboardText();
      },
    },
    shell: {
      run(command, opts) {
        const resolved = resolveShellProfileCommand(deps.getShellProfiles(), opts?.shellProfile);
        if (!resolved.ok) {
          console.log(`[bun] niwa.shell.run: ${resolved.error}`);
          return Promise.resolve({ exitCode: 1, stdout: "", stderr: resolved.error });
        }
        return runShellCommand(command, {
          shell: resolved.command ?? deps.getDefaultShell(),
          cwd: opts?.cwd,
          env: { ...deps.getShellRunEnv(), ...opts?.env },
        });
      },
    },
  };

  function extractKeybindingsConfig(): KeybindingsConfig {
    return {
      prefix: prefixBinding,
      bindings: Object.fromEntries(bindings),
      direct: Object.fromEntries(direct),
      repeatTimeoutMs,
    };
  }

  async function runHandler(id: string): Promise<void> {
    const handler = handlerRegistry.get(id);
    if (!handler) {
      console.log(`[bun] unknown keybind handler id: ${id}`);
      return;
    }
    await handler(niwa);
  }

  return { niwa, extractKeybindingsConfig, runHandler };
}
