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
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  ClipboardPaste,
  Columns2,
  Copy,
  FolderPlus,
  Globe,
  Maximize2,
  MoveDown,
  MoveLeft,
  MoveRight,
  MoveUp,
  PanelLeft,
  PictureInPicture2,
  Plus,
  RefreshCw,
  RotateCcw,
  RotateCw,
  Rows2,
  TextCursorInput,
  X,
  ZoomIn,
  ZoomOut,
  type LucideIcon,
} from "lucide-react";
import type { KeybindAction } from "@niwaterm/config";

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
    action: "new-workspace",
    labelEn: "New Workspace",
    label: "新しいワークスペースを作成",
    category: "ワークスペース",
    icon: FolderPlus,
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
    action: "toggle-sidebar",
    labelEn: "Toggle Sidebar",
    label: "サイドバーの表示切り替え",
    category: "表示",
    icon: PanelLeft,
  },
  {
    action: "toggle-popup",
    labelEn: "Toggle Popup",
    label: "ポップアップの表示切り替え",
    category: "表示",
    icon: PictureInPicture2,
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
];
