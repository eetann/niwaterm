// コマンドパレットに表示するアクション一覧。KEYBIND_ACTIONS（command-palette自体は除く）を
// ラベル・アイコン・カテゴリと対応付ける。実行はtile-keybindings.tsのactionToTileCommand→
// index.tsのhandleTileCommandへ委譲するため、ここでは表示情報のみを持つ。
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
  PanelLeft,
  PictureInPicture2,
  Plus,
  Rows2,
  X,
  type LucideIcon,
} from "lucide-react";
import type { KeybindAction } from "@niwaterm/config";

export type CommandPaletteCategory =
  | "タイル"
  | "タブ"
  | "ワークスペース"
  | "表示"
  | "編集"
  | "スクロール";

export interface CommandPaletteActionDef {
  action: Exclude<KeybindAction, "command-palette">;
  label: string;
  category: CommandPaletteCategory;
  icon: LucideIcon;
  /** fuzzy検索でヒットさせたい英語エイリアス等 */
  keywords?: string[];
}

export const COMMAND_PALETTE_ACTIONS: readonly CommandPaletteActionDef[] = [
  {
    action: "split-vertical",
    label: "タイルを垂直分割",
    category: "タイル",
    icon: Columns2,
    keywords: ["split", "vertical"],
  },
  {
    action: "split-horizontal",
    label: "タイルを水平分割",
    category: "タイル",
    icon: Rows2,
    keywords: ["split", "horizontal"],
  },
  {
    action: "close-tile",
    label: "タイル/タブを閉じる",
    category: "タイル",
    icon: X,
    keywords: ["close"],
  },
  {
    action: "focus-up",
    label: "上のタイルへフォーカス移動",
    category: "タイル",
    icon: ArrowUp,
    keywords: ["focus", "up"],
  },
  {
    action: "focus-down",
    label: "下のタイルへフォーカス移動",
    category: "タイル",
    icon: ArrowDown,
    keywords: ["focus", "down"],
  },
  {
    action: "focus-left",
    label: "左のタイルへフォーカス移動",
    category: "タイル",
    icon: ArrowLeft,
    keywords: ["focus", "left"],
  },
  {
    action: "focus-right",
    label: "右のタイルへフォーカス移動",
    category: "タイル",
    icon: ArrowRight,
    keywords: ["focus", "right"],
  },
  {
    action: "new-tab",
    label: "新しいタブを開く",
    category: "タブ",
    icon: Plus,
    keywords: ["new tab"],
  },
  {
    action: "new-browser-tab",
    label: "新しいブラウザタブを開く",
    category: "タブ",
    icon: Globe,
    keywords: ["new browser tab"],
  },
  {
    action: "new-custom-view-tab",
    label: "新しいカスタムビュータブを開く",
    category: "タブ",
    icon: AppWindow,
    keywords: ["new custom view tab"],
  },
  {
    action: "next-tab",
    label: "次のタブへ切り替え",
    category: "タブ",
    icon: ChevronRight,
    keywords: ["next tab"],
  },
  {
    action: "prev-tab",
    label: "前のタブへ切り替え",
    category: "タブ",
    icon: ChevronLeft,
    keywords: ["prev tab", "previous tab"],
  },
  {
    action: "new-workspace",
    label: "新しいワークスペースを作成",
    category: "ワークスペース",
    icon: FolderPlus,
    keywords: ["new workspace"],
  },
  {
    action: "next-workspace",
    label: "次のワークスペースへ切り替え",
    category: "ワークスペース",
    icon: ChevronsRight,
    keywords: ["next workspace"],
  },
  {
    action: "prev-workspace",
    label: "前のワークスペースへ切り替え",
    category: "ワークスペース",
    icon: ChevronsLeft,
    keywords: ["prev workspace", "previous workspace"],
  },
  {
    action: "toggle-sidebar",
    label: "サイドバーの表示切り替え",
    category: "表示",
    icon: PanelLeft,
    keywords: ["sidebar"],
  },
  {
    action: "toggle-popup",
    label: "ポップアップの表示切り替え",
    category: "表示",
    icon: PictureInPicture2,
    keywords: ["popup"],
  },
  {
    action: "copy-selection",
    label: "選択範囲をコピー",
    category: "編集",
    icon: Copy,
    keywords: ["copy"],
  },
  {
    action: "paste-clipboard",
    label: "クリップボードから貼り付け",
    category: "編集",
    icon: ClipboardPaste,
    keywords: ["paste"],
  },
  {
    action: "scroll-page-up",
    label: "1ページ分上へスクロール",
    category: "スクロール",
    icon: ArrowUpToLine,
    keywords: ["scroll up"],
  },
  {
    action: "scroll-page-down",
    label: "1ページ分下へスクロール",
    category: "スクロール",
    icon: ArrowDownToLine,
    keywords: ["scroll down"],
  },
  {
    action: "scroll-to-top",
    label: "スクロールバック先頭へ移動",
    category: "スクロール",
    icon: ArrowUpToLine,
    keywords: ["scroll top"],
  },
  {
    action: "scroll-to-bottom",
    label: "最新行へ移動",
    category: "スクロール",
    icon: ArrowDownToLine,
    keywords: ["scroll bottom"],
  },
];
