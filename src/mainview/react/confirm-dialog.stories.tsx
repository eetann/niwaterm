import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { ConfirmDialog } from "./confirm-dialog";

const meta = {
  component: ConfirmDialog,
  args: {
    open: true,
    title: "Board「main」を削除しますか？",
    description: "実行中のプロセスは強制終了されます。",
    onConfirm: fn(),
    onCancel: fn(),
  },
} satisfies Meta<typeof ConfirmDialog>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

/** 取り返しのつかない操作（niwatermの終了）。見出しに警告アイコンが付く */
export const Danger: Story = {
  args: {
    title: "niwatermを終了しますか？",
    description: "すべてのウィンドウが閉じ、実行中のプロセスは強制終了されます。",
    danger: true,
  },
};

export const WithoutDescription: Story = {
  args: { description: undefined },
};

/** プロジェクトローカルのレイアウト適用。trustの確認を1枚にまとめるため説明文が長くなる */
export const LongDescription: Story = {
  args: {
    title: "レイアウト「dev」を適用しますか？",
    description:
      "Board 1の既存タブ・プロセスはすべて閉じられます。次回の起動時もこのプリセットで組み直します。このプリセットは /home/user/projects/example/.niwaterm/config.ts で定義されているため、起動のたびにこのファイルが評価され、プリセットのcommandが実行されます。信頼できるリポジトリでのみ許可してください。",
  },
};
