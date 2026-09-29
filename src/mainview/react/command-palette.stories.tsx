import { defaultKeybindings } from "@niwaterm/config";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { CommandPalette, type NonPaletteKeybindAction } from "./command-palette";

/** index.tsのshortcutLabelForActionと同じ表記（`Ctrl+b C`の形）を既定のキーバインドから作る */
function defaultShortcutLabel(action: NonPaletteKeybindAction): string | undefined {
  const format = (token: string) =>
    token
      .split("+")
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join("+");
  const prefix = defaultKeybindings.prefix;
  const entry = Object.entries(defaultKeybindings.bindings ?? {}).find(([, a]) => a === action);
  if (!prefix || !entry) return undefined;
  return `${format(prefix)} ${format(entry[0])}`;
}

const meta = {
  component: CommandPalette,
  args: {
    open: true,
    onOpenChange: fn(),
    onSelectAction: fn(),
    shellProfiles: [],
    onSelectShellProfile: fn(),
    sidebarViews: [],
    boardPhases: [],
    boards: [],
    onSelectBoard: fn(),
    workspaces: [],
    onSelectWorkspace: fn(),
    shortcutLabelFor: defaultShortcutLabel,
  },
} satisfies Meta<typeof CommandPalette>;

export default meta;
type Story = StoryObj<typeof meta>;

/** 設定が既定のまま。アクション由来の項目だけが並ぶ */
export const Default: Story = {};

/** シェルプロファイル・切り替え先・フェーズ・customViewが設定されていて、動的な項目が全部並ぶ */
export const WithDynamicItems: Story = {
  args: {
    shellProfiles: [
      { id: "pwsh", name: "PowerShell", command: "pwsh.exe" },
      { id: "wsl-nixos", name: "NixOS (WSL)", command: "wsl.exe -d NixOS" },
    ],
    sidebarViews: [
      { id: "workspaces", name: "ワークスペース" },
      { id: "todo", name: "TODO" },
    ],
    boardPhases: [
      { id: "impl", label: "実装中", color: "#89b4fa" },
      { id: "review", label: "レビュー待ち", color: "#f9e2af" },
      { id: "done", label: "完了", color: null },
    ],
    boards: [
      { boardId: "board-2", label: "feature/sidebar", workspaceLabel: "niwaterm" },
      { boardId: "board-3", label: "main", workspaceLabel: "dotfiles" },
    ],
    workspaces: [{ workspaceId: "workspace-2", label: "dotfiles", boardCount: 3 }],
  },
};

/** キーバインドが1つも割り当たっていない（prefix未設定）。右端のショートカット表示が消える */
export const WithoutShortcuts: Story = {
  args: { shortcutLabelFor: () => undefined },
};
