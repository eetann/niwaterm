import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { PromptDialog } from "./prompt-dialog";

const meta = {
  component: PromptDialog,
  args: {
    open: true,
    title: "Boardの名前を変更",
    description: "空のまま確定すると自動で付く名前へ戻ります。",
    initialValue: "main",
    onSubmit: fn(),
    onCancel: fn(),
  },
} satisfies Meta<typeof PromptDialog>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const EmptyInitialValue: Story = {
  args: {
    title: "ワークスペースの名前を変更",
    description: "空のまま確定すると既定の連番ラベルへ戻ります。",
    initialValue: "",
  },
};
