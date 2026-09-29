import type { Meta, StoryObj } from "@storybook/react-vite";
import type { WebviewTagElement } from "electrobun/view";
import { fn } from "storybook/test";
import { BrowserToolbar } from "./browser-toolbar";

/**
 * BrowserToolbarが触るメソッドだけを持つwebviewタグの代役。遷移の履歴を持ち、
 * 実物と同じくdid-navigateを発火するので、戻る・進む・URL入力の挙動をそのまま試せる
 */
function createFakeWebview(history: string[], index = history.length - 1): WebviewTagElement {
  const listeners = new Set<(e: CustomEvent) => void>();
  const navigate = (nextIndex: number) => {
    index = nextIndex;
    const event = new CustomEvent("did-navigate", { detail: history[index] });
    for (const listener of listeners) listener(event);
  };
  const fake = {
    on: (_name: string, listener: (e: CustomEvent) => void) => {
      listeners.add(listener);
      // 実物はマウント時点で既に1回遷移を終えているので、戻る/進むの可否を初期化させる
      queueMicrotask(() => navigate(index));
    },
    off: (_name: string, listener: (e: CustomEvent) => void) => listeners.delete(listener),
    canGoBack: async () => index > 0,
    canGoForward: async () => index < history.length - 1,
    goBack: () => index > 0 && navigate(index - 1),
    goForward: () => index < history.length - 1 && navigate(index + 1),
    reload: () => navigate(index),
    loadURL: (url: string) => {
      history.splice(index + 1, Infinity, url);
      navigate(index + 1);
    },
  };
  return fake as unknown as WebviewTagElement;
}

const meta = {
  component: BrowserToolbar,
  decorators: [
    (Story) => (
      <div className="browser-toolbar">
        <Story />
      </div>
    ),
  ],
  args: {
    webviewEl: createFakeWebview(["https://example.com/"]),
    initialUrl: "https://example.com/",
    onRequestTerminalFocus: fn(),
  },
} satisfies Meta<typeof BrowserToolbar>;

export default meta;
type Story = StoryObj<typeof meta>;

/** 開いた直後。履歴が1件なので戻る・進むは押せない */
export const Default: Story = {};

/** 履歴の途中にいる。戻る・進むの両方が押せる */
export const MiddleOfHistory: Story = {
  args: {
    webviewEl: createFakeWebview(
      ["https://example.com/", "https://example.com/docs", "https://example.com/docs/guide"],
      1,
    ),
    initialUrl: "https://example.com/docs",
  },
};

/** 新規ブラウザタブを開いたとき。URL欄が全選択された状態で始まる */
export const AutoFocusUrl: Story = {
  args: {
    webviewEl: createFakeWebview(["about:blank"]),
    initialUrl: "about:blank",
    autoFocusUrl: true,
  },
};

export const LongUrl: Story = {
  args: {
    webviewEl: createFakeWebview([
      "https://github.com/eetann/niwaterm/pulls?q=is%3Apr+is%3Aopen+sort%3Aupdated-desc+label%3Aenhancement",
    ]),
    initialUrl:
      "https://github.com/eetann/niwaterm/pulls?q=is%3Apr+is%3Aopen+sort%3Aupdated-desc+label%3Aenhancement",
  },
};
