import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { SelectionMenu } from "./selection-menu";

const meta = {
  component: SelectionMenu,
  args: {
    open: true,
    x: 40,
    y: 40,
    items: [],
    onCopy: fn(),
    onCopyMode: fn(),
    onSelectItem: fn(),
    onClose: fn(),
  },
} satisfies Meta<typeof SelectionMenu>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

/** 設定のmouse.selectionMenuで項目を足した状態。組み込みの項目との間に区切り線が入る */
export const WithUserItems: Story = {
  args: {
    items: [
      { id: "search", label: "Webで検索" },
      { id: "translate", label: "翻訳" },
    ],
  },
};
