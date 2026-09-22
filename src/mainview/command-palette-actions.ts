// コマンドパレットに表示するアクション一覧。KEYBIND_ACTIONS（command-palette自体は除く）を
// ラベル・アイコン・カテゴリと対応付ける。実行はtile-keybindings.tsのactionToTileCommand→
// index.tsのhandleTileCommandへ委譲するため、ここでは表示情報のみを持つ。
//
// 検索対象（CommandItemのvalue）は英語ラベル(labelEn)にしている。IME切り替えなしで
// 検索できるようにするための意図的な選択で、日本語ラベル(label)は補助として小さく表示するのみ。
import {
  AppWindow,
  ArrowDown,
  ArrowDownToLine,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ArrowUpToLine,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  ChevronsLeft,
  ChevronsRight,
  ClipboardPaste,
  Columns2,
  Copy,
  Crosshair,
  FolderGit2,
  FolderInput,
  FolderPlus,
  Globe,
  Maximize2,
  MoveDown,
  MoveLeft,
  MoveRight,
  MoveUp,
  PanelLeft,
  Pencil,
  PictureInPicture2,
  Plus,
  Tag,
  RefreshCw,
  RotateCcw,
  RotateCw,
  Rows2,
  SlidersHorizontal,
  TextCursorInput,
  X,
  ZoomIn,
  ZoomOut,
  type LucideIcon,
} from "lucide-react";
import {
  type KeybindAction,
  type ResolvedBoardStatus,
  SET_BOARD_STATUS_PREFIX,
  SHOW_SIDEBAR_VIEW_PREFIX,
} from "@niwaterm/config";

export type CommandPaletteCategory =
  | "タイル"
  | "タブ"
  | "Board"
  | "ワークスペース"
  | "表示"
  | "編集"
  | "スクロール"
  | "設定";

export interface CommandPaletteActionDef {
  action: Exclude<KeybindAction, "command-palette">;
  /** 検索対象・メイン表示に使う英語ラベル */
  labelEn: string;
  /** 補助として小さく表示する日本語ラベル */
  label: string;
  category: CommandPaletteCategory;
  icon: LucideIcon;
  /** fuzzy検索でヒットさせたい追加の別名等 */
  keywords?: string[];
}

export const COMMAND_PALETTE_ACTIONS: readonly CommandPaletteActionDef[] = [
  {
    action: "split-vertical",
    labelEn: "Split Tile Vertically",
    label: "タイルを垂直分割",
    category: "タイル",
    icon: Columns2,
  },
  {
    action: "split-horizontal",
    labelEn: "Split Tile Horizontally",
    label: "タイルを水平分割",
    category: "タイル",
    icon: Rows2,
  },
  {
    action: "close-tile",
    labelEn: "Close Tile/Tab",
    label: "タイル/タブを閉じる",
    category: "タイル",
    icon: X,
  },
  {
    action: "focus-up",
    labelEn: "Focus Tile Above",
    label: "上のタイルへフォーカス移動",
    category: "タイル",
    icon: ArrowUp,
  },
  {
    action: "focus-down",
    labelEn: "Focus Tile Below",
    label: "下のタイルへフォーカス移動",
    category: "タイル",
    icon: ArrowDown,
  },
  {
    action: "focus-left",
    labelEn: "Focus Tile to the Left",
    label: "左のタイルへフォーカス移動",
    category: "タイル",
    icon: ArrowLeft,
  },
  {
    action: "focus-right",
    labelEn: "Focus Tile to the Right",
    label: "右のタイルへフォーカス移動",
    category: "タイル",
    icon: ArrowRight,
  },
  {
    action: "resize-up",
    labelEn: "Resize Tile Up",
    label: "タイルを上方向へ拡大",
    category: "タイル",
    icon: MoveUp,
  },
  {
    action: "resize-down",
    labelEn: "Resize Tile Down",
    label: "タイルを下方向へ拡大",
    category: "タイル",
    icon: MoveDown,
  },
  {
    action: "resize-left",
    labelEn: "Resize Tile Left",
    label: "タイルを左方向へ拡大",
    category: "タイル",
    icon: MoveLeft,
  },
  {
    action: "resize-right",
    labelEn: "Resize Tile Right",
    label: "タイルを右方向へ拡大",
    category: "タイル",
    icon: MoveRight,
  },
  {
    action: "toggle-zoom",
    labelEn: "Toggle Tile Zoom",
    label: "タイルの一時的なズーム表示を切り替え",
    category: "タイル",
    icon: Maximize2,
    keywords: ["resize-pane -Z", "maximize"],
  },
  {
    action: "new-tab",
    labelEn: "New Tab",
    label: "新しいタブを開く",
    category: "タブ",
    icon: Plus,
  },
  {
    action: "new-browser-tab",
    labelEn: "New Browser Tab",
    label: "新しいブラウザタブを開く",
    category: "タブ",
    icon: Globe,
  },
  {
    action: "new-custom-view-tab",
    labelEn: "New Custom View Tab",
    label: "新しいカスタムビュータブを開く",
    category: "タブ",
    icon: AppWindow,
  },
  {
    action: "next-tab",
    labelEn: "Next Tab",
    label: "次のタブへ切り替え",
    category: "タブ",
    icon: ChevronRight,
  },
  {
    action: "prev-tab",
    labelEn: "Previous Tab",
    label: "前のタブへ切り替え",
    category: "タブ",
    icon: ChevronLeft,
  },
  {
    action: "rename-tab",
    labelEn: "Rename Tab",
    label: "タブの名前を変更",
    category: "タブ",
    icon: Pencil,
    keywords: ["名前"],
  },
  {
    action: "restart-tab",
    labelEn: "Restart Tab",
    label: "タブを再起動",
    category: "タブ",
    icon: RefreshCw,
    keywords: ["respawn-pane", "respawn"],
  },
  {
    action: "next-board",
    labelEn: "Next Board",
    label: "次のBoardへ切り替え",
    category: "Board",
    icon: ChevronsRight,
    keywords: ["next-window", "window"],
  },
  {
    action: "prev-board",
    labelEn: "Previous Board",
    label: "前のBoardへ切り替え",
    category: "Board",
    icon: ChevronsLeft,
    keywords: ["previous-window", "window"],
  },
  {
    action: "move-board-up",
    labelEn: "Move Board Up",
    label: "Boardを上へ移動",
    category: "Board",
    icon: ChevronUp,
    keywords: ["reorder", "並び替え", "順番"],
  },
  {
    action: "move-board-down",
    labelEn: "Move Board Down",
    label: "Boardを下へ移動",
    category: "Board",
    icon: ChevronDown,
    keywords: ["reorder", "並び替え", "順番"],
  },
  {
    action: "move-board-to-workspace",
    labelEn: "Move Board to Workspace...",
    label: "Boardを別のワークスペースへ移動",
    category: "Board",
    icon: FolderInput,
    keywords: ["move-window", "window", "workspace", "ワークスペース", "移動"],
  },
  {
    action: "rename-board",
    labelEn: "Rename Board",
    label: "Boardの名前を変更",
    category: "Board",
    icon: Pencil,
    keywords: ["rename-window", "window", "名前"],
  },
  {
    action: "set-board-worktree",
    labelEn: "Set Board Worktree Directory",
    label: "Boardに紐づくワークツリーを設定",
    category: "Board",
    icon: FolderGit2,
    keywords: ["worktree", "directory", "cwd", "ディレクトリ", "紐づけ"],
  },
  {
    action: "clear-board-status",
    labelEn: "Clear Board Status",
    label: "Boardのステータスを解除",
    category: "Board",
    icon: Tag,
    keywords: ["board status", "ステータス", "clear"],
  },
  {
    action: "new-workspace",
    labelEn: "New Workspace",
    label: "新しいワークスペースを作成",
    category: "ワークスペース",
    icon: FolderPlus,
  },
  {
    action: "new-window",
    labelEn: "New Window",
    label: "新しいウィンドウを開く",
    category: "ウィンドウ",
    icon: AppWindow,
    keywords: ["window", "ウィンドウ", "新規"],
  },
  {
    action: "next-workspace",
    labelEn: "Next Workspace",
    label: "次のワークスペースへ切り替え",
    category: "ワークスペース",
    icon: ChevronsRight,
  },
  {
    action: "prev-workspace",
    labelEn: "Previous Workspace",
    label: "前のワークスペースへ切り替え",
    category: "ワークスペース",
    icon: ChevronsLeft,
  },
  {
    action: "move-workspace-up",
    labelEn: "Move Workspace Up",
    label: "ワークスペースを上へ移動",
    category: "ワークスペース",
    icon: ChevronUp,
    keywords: ["reorder", "並び替え", "順番"],
  },
  {
    action: "move-workspace-down",
    labelEn: "Move Workspace Down",
    label: "ワークスペースを下へ移動",
    category: "ワークスペース",
    icon: ChevronDown,
    keywords: ["reorder", "並び替え", "順番"],
  },
  {
    action: "toggle-sidebar",
    labelEn: "Toggle Sidebar",
    label: "サイドバーの表示切り替え",
    category: "表示",
    icon: PanelLeft,
  },
  {
    action: "next-sidebar-view",
    labelEn: "Next Sidebar View",
    label: "次のサイドバービューへ切り替え",
    category: "表示",
    icon: ChevronsRight,
    keywords: ["custom view", "workspaces", "カスタムビュー"],
  },
  {
    action: "prev-sidebar-view",
    labelEn: "Previous Sidebar View",
    label: "前のサイドバービューへ切り替え",
    category: "表示",
    icon: ChevronsLeft,
    keywords: ["custom view", "workspaces", "カスタムビュー"],
  },
  {
    action: "toggle-popup",
    labelEn: "Toggle Popup",
    label: "ポップアップの表示切り替え",
    category: "表示",
    icon: PictureInPicture2,
  },
  {
    action: "jump-hint",
    labelEn: "Jump with Hints",
    label: "ヒントでジャンプ",
    category: "表示",
    icon: Crosshair,
    keywords: ["hint", "vimium", "label", "ラベル"],
  },
  {
    action: "copy-selection",
    labelEn: "Copy Selection",
    label: "選択範囲をコピー",
    category: "編集",
    icon: Copy,
  },
  {
    action: "copy-mode",
    labelEn: "Copy Mode",
    label: "vi風コピーモードに入る",
    category: "編集",
    icon: TextCursorInput,
    keywords: ["vi", "vim", "select", "keyboard", "選択"],
  },
  {
    action: "paste-clipboard",
    labelEn: "Paste from Clipboard",
    label: "クリップボードから貼り付け",
    category: "編集",
    icon: ClipboardPaste,
  },
  {
    action: "scroll-page-up",
    labelEn: "Scroll Page Up",
    label: "1ページ分上へスクロール",
    category: "スクロール",
    icon: ArrowUpToLine,
  },
  {
    action: "scroll-page-down",
    labelEn: "Scroll Page Down",
    label: "1ページ分下へスクロール",
    category: "スクロール",
    icon: ArrowDownToLine,
  },
  {
    action: "scroll-to-top",
    labelEn: "Scroll to Top",
    label: "スクロールバック先頭へ移動",
    category: "スクロール",
    icon: ArrowUpToLine,
    keywords: ["scrollback"],
  },
  {
    action: "scroll-to-bottom",
    labelEn: "Scroll to Bottom",
    label: "最新行へ移動",
    category: "スクロール",
    icon: ArrowDownToLine,
    keywords: ["latest line"],
  },
  {
    action: "increase-font-size",
    labelEn: "Increase Font Size",
    label: "フォントサイズを拡大",
    category: "表示",
    icon: ZoomIn,
    keywords: ["zoom in"],
  },
  {
    action: "decrease-font-size",
    labelEn: "Decrease Font Size",
    label: "フォントサイズを縮小",
    category: "表示",
    icon: ZoomOut,
    keywords: ["zoom out"],
  },
  {
    action: "reset-font-size",
    labelEn: "Reset Font Size",
    label: "フォントサイズをリセット",
    category: "表示",
    icon: RotateCcw,
    keywords: ["zoom reset"],
  },
  {
    action: "reload-config",
    labelEn: "Reload Config",
    label: "設定ファイルを再読み込み",
    category: "設定",
    icon: RotateCw,
    keywords: ["source-file", "config reload"],
  },
  {
    action: "show-config",
    labelEn: "Show Settings",
    label: "現在の設定値を表示",
    category: "設定",
    icon: SlidersHorizontal,
    keywords: ["config show", "font size", "settings"],
  },
];

/**
 * アクティブBoardへ作業フェーズを付ける項目。候補は設定ファイル次第で増減するため実行時に組み立てる
 * （解除はKEYBIND_ACTIONS側のclear-board-statusが担うため、ここには含めない）
 */
export function boardStatusActionDefs(
  statuses: readonly ResolvedBoardStatus[],
): CommandPaletteActionDef[] {
  return statuses.map((status) => ({
    action: `${SET_BOARD_STATUS_PREFIX}${status.id}`,
    labelEn: `Set Board Status: ${status.label}`,
    label: `Boardのステータスを${status.label}にする`,
    category: "Board",
    icon: Tag,
    keywords: ["board status", "ステータス", status.id],
  }));
}

/** サイドバーのビューを直接出す項目。ビューは設定ファイル次第で増減するため実行時に組み立てる */
export function sidebarViewActionDefs(
  views: readonly { id: string; name: string }[],
): CommandPaletteActionDef[] {
  return views.map((view) => ({
    action: `${SHOW_SIDEBAR_VIEW_PREFIX}${view.id}`,
    labelEn: `Show Sidebar View: ${view.name}`,
    label: `サイドバーに${view.name}を表示`,
    category: "表示",
    icon: PanelLeft,
    keywords: ["custom view", "sidebar", "カスタムビュー", view.id],
  }));
}
