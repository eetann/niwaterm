// タイル操作の暫定キーバインド。
// roadmap「TypeScript設定ファイルとキーバインド」でユーザー設定可能に置き換える前提の仮実装。

export type TileCommand =
  | { type: "split"; orientation: "horizontal" | "vertical" }
  | { type: "close" }
  | { type: "focus"; direction: "up" | "down" | "left" | "right" }
  | { type: "newTab" }
  | { type: "cycleTab"; delta: 1 | -1 }
  | { type: "newWorkspace" }
  | { type: "switchWorkspace"; delta: 1 | -1 };

// keydownイベントから使うプロパティだけを受け取る（テストでモックしやすくするため最小化）
// codeはCmd+Shift+[/]（Shiftで文字自体が変わるためkeyでは判定できない）にのみ使う
export type KeyboardEventLike = Pick<
  KeyboardEvent,
  "key" | "code" | "metaKey" | "altKey" | "shiftKey"
>;

// Cmd+D=垂直分割、Cmd+Shift+D=水平分割、Cmd+W=タイルを閉じる、Cmd+Option+矢印=フォーカス移動、
// Cmd+T=タブ新規作成、Cmd+Shift+]/[=タブ切替、Cmd+N=ワークスペース新規作成、
// Cmd+Option+]/[=ワークスペース切替
export function resolveTileCommand(e: KeyboardEventLike): TileCommand | null {
  if (!e.metaKey) return null;

  if (e.altKey) {
    switch (e.key) {
      case "ArrowUp":
        return { type: "focus", direction: "up" };
      case "ArrowDown":
        return { type: "focus", direction: "down" };
      case "ArrowLeft":
        return { type: "focus", direction: "left" };
      case "ArrowRight":
        return { type: "focus", direction: "right" };
    }
    if (e.code === "BracketRight") {
      return { type: "switchWorkspace", delta: 1 };
    }
    if (e.code === "BracketLeft") {
      return { type: "switchWorkspace", delta: -1 };
    }
    return null;
  }

  if (e.shiftKey && e.code === "BracketRight") {
    return { type: "cycleTab", delta: 1 };
  }
  if (e.shiftKey && e.code === "BracketLeft") {
    return { type: "cycleTab", delta: -1 };
  }

  const key = e.key.toLowerCase();
  if (key === "d") {
    return { type: "split", orientation: e.shiftKey ? "horizontal" : "vertical" };
  }
  if (key === "w" && !e.shiftKey) {
    return { type: "close" };
  }
  if (key === "t" && !e.shiftKey) {
    return { type: "newTab" };
  }
  if (key === "n" && !e.shiftKey) {
    return { type: "newWorkspace" };
  }
  return null;
}
