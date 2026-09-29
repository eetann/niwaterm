import type { Decorator, Preview } from "@storybook/react-vite";
import "../src/mainview/index.css";
// index.cssより後に読み込み、同じ詳細度のルールを上書きさせる
import "./preview.css";

interface StoryTheme {
  foreground: string;
  background: string;
  light: boolean;
  ui: {
    border: string;
    accent: string;
    warning: string;
    success: string;
    danger: string;
    badgeForeground: string;
    scrollbar: string;
  };
}

// darkはdefaultAppearance・defaultUiColors（Catppuccin Mocha）と同じ値。
// lightは明るい地での崩れ（入力欄の文字色等）を確かめるためのCatppuccin Latte
const THEMES: Record<string, StoryTheme> = {
  dark: {
    foreground: "#cdd6f4",
    background: "#1e1e2e",
    light: false,
    ui: {
      border: "#313244",
      accent: "#89b4fa",
      warning: "#f9e2af",
      success: "#a6e3a1",
      danger: "#f38ba8",
      badgeForeground: "#1e1e2e",
      scrollbar: "#45475a",
    },
  },
  light: {
    foreground: "#4c4f69",
    background: "#eff1f5",
    light: true,
    ui: {
      border: "#ccd0da",
      accent: "#1e66f5",
      warning: "#df8e1d",
      success: "#40a02b",
      danger: "#d20f39",
      badgeForeground: "#eff1f5",
      scrollbar: "#bcc0cc",
    },
  },
};

/**
 * src/mainview/index.tsのapplyAppearance・applyThemeModeがhtml要素へ流し込む値を再現する。
 * shadcnのトークンはこれらのCSS変数から派生し、`dark:`バリアントは.darkクラスで効く
 */
function applyTheme(theme: StoryTheme): void {
  const root = document.documentElement;
  root.style.setProperty("--term-fg", theme.foreground);
  root.style.setProperty("--term-bg", theme.background);
  root.style.setProperty("--ui-border", theme.ui.border);
  root.style.setProperty("--ui-accent", theme.ui.accent);
  root.style.setProperty("--ui-warning", theme.ui.warning);
  root.style.setProperty("--ui-success", theme.ui.success);
  root.style.setProperty("--ui-danger", theme.ui.danger);
  root.style.setProperty("--ui-badge-fg", theme.ui.badgeForeground);
  root.style.setProperty("--ui-scrollbar", theme.ui.scrollbar);
  root.style.setProperty("--ui-color-scheme", theme.light ? "light" : "dark");
  root.classList.toggle("dark", !theme.light);
}

const withTheme: Decorator = (Story, context) => {
  applyTheme(THEMES[String(context.globals["theme"])] ?? THEMES["dark"]!);
  return <Story />;
};

const preview: Preview = {
  decorators: [withTheme],
  globalTypes: {
    theme: {
      description: "配色（appearance.foreground/background・appearance.ui）",
      toolbar: {
        title: "Theme",
        icon: "mirror",
        items: [
          { value: "dark", title: "Dark (Mocha)" },
          { value: "light", title: "Light (Latte)" },
        ],
        dynamicTitle: true,
      },
    },
  },
  initialGlobals: { theme: "dark" },
  parameters: {
    // 地の色はテーマ（--term-bg）に従わせるため、Storybook側の背景切り替えは使わない
    backgrounds: { disable: true },
    layout: "fullscreen",
  },
};

export default preview;
