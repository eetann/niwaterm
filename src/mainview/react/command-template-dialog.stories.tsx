import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import type { PreparedCommandTemplate } from "../../shared/command-template";
import { CommandTemplateDialog } from "./command-template-dialog";

const worktreeTemplate: PreparedCommandTemplate = {
  id: "worktree",
  name: "worktreeを作る",
  description: "ブランチを切ってworktreeを作り、選んだワークスペースにBoardを開く",
  command: "niwa worktree new {{branch}} --workspace {{workspace}}",
  fields: [
    {
      name: "branch",
      label: "ブランチ名",
      placeholder: "feat/...",
      quote: true,
      focus: false,
      options: null,
      error: null,
      initial: "",
    },
    {
      name: "workspace",
      label: "ワークスペース",
      placeholder: "",
      quote: true,
      focus: false,
      options: [
        { label: "🌱 niwaterm", value: "ws-8c1e", description: "今のワークスペース" },
        { label: "📝 blog", value: "ws-2a74" },
        { label: "🧪 sandbox", value: "ws-f019" },
      ],
      error: null,
      initial: "ws-8c1e",
    },
  ],
};

const meta = {
  component: CommandTemplateDialog,
  args: {
    open: true,
    template: worktreeTemplate,
    modKeyLabel: "Ctrl",
    onSubmit: fn(),
    onCancel: fn(),
  },
} satisfies Meta<typeof CommandTemplateDialog>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

/** 自由入力だけのテンプレート。空白を含む値はクォートされてプレビューに出る */
export const TextFieldsOnly: Story = {
  args: {
    template: {
      id: "report",
      name: "期間を決めて集計",
      description: "",
      command: "foo --from {{from}} --to {{to}} --file {{file}}",
      fields: [
        {
          name: "from",
          label: "from",
          placeholder: "2026-09-20",
          quote: true,
          focus: false,
          options: null,
          error: null,
          initial: "2026-09-20",
        },
        {
          name: "to",
          label: "to",
          placeholder: "2026-09-24",
          quote: true,
          focus: false,
          options: null,
          error: null,
          initial: "2026-09-24",
        },
        {
          name: "file",
          label: "file",
          placeholder: "",
          quote: true,
          focus: false,
          options: null,
          error: null,
          initial: "project red 92.csv",
        },
      ],
    },
  },
};

/** 選択肢の関数が失敗した・候補が無い欄 */
/** 選択肢の欄がまだ選ばれていないとき */
export const OptionUnselected: Story = {
  args: {
    template: {
      ...worktreeTemplate,
      fields: worktreeTemplate.fields.map((field) =>
        field.options === null ? field : { ...field, initial: "" },
      ),
    },
  },
};

export const OptionErrors: Story = {
  args: {
    template: {
      ...worktreeTemplate,
      fields: [
        {
          name: "branch",
          label: "ブランチ",
          placeholder: "",
          quote: true,
          focus: false,
          options: [],
          error: "候補を作れませんでした: not a git repository",
          initial: "",
        },
        {
          name: "workspace",
          label: "ワークスペース",
          placeholder: "",
          quote: true,
          focus: false,
          options: [],
          error: null,
          initial: "",
        },
      ],
    },
  },
};

/** 選択肢を取り寄せている間 */
export const Loading: Story = {
  args: { template: null },
};

export const MacShortcuts: Story = {
  args: { modKeyLabel: "Cmd" },
};

/** 候補の名前・値がモーダルより長いとき。はみ出さずに省略される */
export const LongOptions: Story = {
  args: {
    template: {
      id: "branch",
      name: "ブランチを切り替える",
      description: "",
      command: "git switch {{branch}}",
      fields: [
        {
          name: "branch",
          label: "branch",
          placeholder: "",
          quote: true,
          focus: false,
          options: [
            {
              label:
                "feature/very-long-branch-name-that-keeps-going-and-going-past-the-edge-of-the-dialog",
              value:
                "feature/very-long-branch-name-that-keeps-going-and-going-past-the-edge-of-the-dialog",
            },
            { label: "main", value: "main" },
          ],
          error: null,
          initial:
            "feature/very-long-branch-name-that-keeps-going-and-going-past-the-edge-of-the-dialog",
        },
      ],
    },
  },
};

/** focusの欄（2つ目の欄）へ最初にフォーカスし、長いコマンドは語の切れ目で折り返す */
export const FocusAndLongCommand: Story = {
  args: {
    template: {
      id: "worktree-remote",
      name: "リモートのブランチからワークツリーを作る",
      description: "リモートのブランチを選んでワークツリーを作る",
      command:
        "niwa worktree new --open board-switch -w review --layout {{layout}} --trust {{branch}}",
      fields: [
        {
          name: "layout",
          label: "レイアウト",
          placeholder: "",
          quote: true,
          focus: false,
          options: [
            { label: "work-dev", value: "work-dev" },
            { label: "review", value: "review" },
          ],
          error: null,
          initial: "work-dev",
        },
        {
          name: "branch",
          label: "リモートのブランチ",
          placeholder: "",
          quote: true,
          focus: true,
          options: [
            { label: "origin/main", value: "origin/main" },
            {
              label: "origin/feature/add-command-template-focus-option",
              value: "origin/feature/add-command-template-focus-option",
            },
          ],
          error: null,
          initial: "origin/feature/add-command-template-focus-option",
        },
      ],
    },
  },
};
