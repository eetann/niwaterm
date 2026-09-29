import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { PhasePicker } from "./phase-picker";

const PHASES = [
  { id: "impl", label: "実装中", color: "#89b4fa" },
  { id: "review", label: "レビュー待ち", color: "#f9e2af" },
  { id: "done", label: "完了", color: null },
];

const meta = {
  component: PhasePicker,
  args: {
    open: true,
    heading: "Board「main」のフェーズ",
    phases: PHASES,
    current: null,
    onOpenChange: fn(),
    onSelect: fn(),
  },
} satisfies Meta<typeof PhasePicker>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

/** フェーズが付いている。解除の項目が出る */
export const WithCurrent: Story = {
  args: { current: PHASES[1] ?? null },
};

/** board.phasesが未定義。候補を定義する案内だけが出る */
export const NoPhases: Story = {
  args: { phases: [] },
};
