import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { WorkspacePicker } from "./workspace-picker";

const meta = {
  component: WorkspacePicker,
  args: {
    open: true,
    heading: "Board「feature/sidebar」の移動先",
    items: [
      { workspaceId: "workspace-2", label: "dotfiles", boardCount: 1 },
      { workspaceId: "workspace-3", label: "Workspace 3", boardCount: 3 },
    ],
    onOpenChange: fn(),
    onSelect: fn(),
  },
} satisfies Meta<typeof WorkspacePicker>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

/** 移動先の候補が無い */
export const Empty: Story = {
  args: { items: [] },
};
