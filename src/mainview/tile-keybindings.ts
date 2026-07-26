// タイル操作の暫定キーバインド。
// roadmap「TypeScript設定ファイルとキーバインド」でユーザー設定可能に置き換える前提の仮実装。

export type TileCommand =
  | { type: "split"; orientation: "horizontal" | "vertical" }
  | { type: "close" }
  | { type: "focus"; direction: "up" | "down" | "left" | "right" };

// keydownイベントから使うプロパティだけを受け取る（テストでモックしやすくするため最小化）
export type KeyboardEventLike = Pick<KeyboardEvent, "key" | "metaKey" | "altKey" | "shiftKey">;

// Cmd+D=垂直分割、Cmd+Shift+D=水平分割、Cmd+W=タイルを閉じる、Cmd+Option+矢印=フォーカス移動
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
    return null;
  }

  const key = e.key.toLowerCase();
  if (key === "d") {
    return { type: "split", orientation: e.shiftKey ? "horizontal" : "vertical" };
  }
  if (key === "w" && !e.shiftKey) {
    return { type: "close" };
  }
  return null;
}
