import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { NoBoard } from "./no-board";

const meta = {
  component: NoBoard,
  args: {
    newBoardShortcut: "Ctrl+B C",
    onNewBoard: fn(),
  },
  decorators: [
    (Story) => (
      <div className="relative h-[480px]">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof NoBoard>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

/** prefix未設定、またはnew-boardにキーが割り当てられていない */
export const WithoutShortcut: Story = {
  args: { newBoardShortcut: undefined },
};
