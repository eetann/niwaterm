// niwa.keybindに渡す関数ハンドラの実行基盤（@niwaterm/configのNiwaインターフェースの実装）。
// niwa.keybind/niwa.prefix/niwa.unbindは「登録」のみ行い、実際の操作はしない
// （configファイル実行時に1回だけ呼ばれる）。niwa.tile/tab/popup/workspace/clipboardは
// 「実行」で、呼ばれた時点のworkspaceManagerの実際の状態を操作・参照する
// （キーバインドの関数ハンドラが実際に押された時に呼ばれるため、登録時とは別タイミング）。

import type {
  BindingEntry,
  BindingTarget,
  KeyBindingString,
  KeybindHandler,
  KeybindingsConfig,
  Niwa,
  SecondKeyString,
  ShellProfile,
} from "@niwaterm/config";
import { readClipboardText, writeClipboardText } from "./clipboard";
import { resolveShellProfileCommand } from "./shell-profiles";
import { tmuxKeysToBytes } from "./tmux-keys";
import type { WorkspaceManager } from "./workspace-manager";

export interface CreateNiwaApiDeps {
  workspaceManager: WorkspaceManager;
  /** ホットリロードでの変化を反映するため、呼び出し毎に評価する */
  getShellProfiles: () => ShellProfile[];
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
      var: {
        get(tabId, key) {
          const result = workspaceManager.getTabVar(tabId, key);
          return result.found ? result.value : undefined;
        },
        set(tabId, key, value) {
          workspaceManager.setTabVar(tabId, key, value);
        },
      },
    },
    popup: {
      open(opts) {
        const tabId = workspaceManager.openPopup(opts);
        return tabId ? { tabId } : null;
      },
    },
    workspace: {
      create(cwd) {
        return workspaceManager.newWorkspace(cwd);
      },
      switch(workspaceId) {
        return workspaceManager.switchWorkspace(workspaceId);
      },
      swap(workspaceIdA, workspaceIdB) {
        return workspaceManager.swapWorkspaces(workspaceIdA, workspaceIdB);
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
