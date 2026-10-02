import { builtinThemes, DEFAULT_THEME, isThemeName, type ThemeColors } from "@niwaterm/config";
import type { Decorator, Preview } from "@storybook/react-vite";
import "../src/mainview/index.css";
import { TooltipProvider } from "../src/mainview/components/ui/tooltip";
import { isLightBackground } from "../src/mainview/theme-mode";
// index.cssより後に読み込み、同じ詳細度のルールを上書きさせる
import "./preview.css";

/**
 * 組み込みテーマの背景は#rrggbbだけなので、本番のようにcanvasで色を解決せず直接読む
 */
function isLightHex(hex: string): boolean {
  const n = Number.parseInt(hex.slice(1), 16);
  return isLightBackground((n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff);
}

/**
 * src/mainview/index.tsのapplyAppearance・applyThemeModeがhtml要素へ流し込む値を再現する。
 * shadcnのトークンはこれらのCSS変数から派生し、`dark:`バリアントは.darkクラスで効く
 */
function applyTheme(theme: ThemeColors): void {
  const root = document.documentElement;
  root.style.setProperty("--term-fg", theme.foreground);
  root.style.setProperty("--term-bg", theme.background);
  root.style.setProperty("--term-cursor", theme.cursor);
  root.style.setProperty("--ui-border", theme.ui.border);
  root.style.setProperty("--ui-accent", theme.ui.accent);
  root.style.setProperty("--ui-warning", theme.ui.warning);
  root.style.setProperty("--ui-success", theme.ui.success);
  root.style.setProperty("--ui-danger", theme.ui.danger);
  root.style.setProperty("--ui-badge-fg", theme.ui.badgeForeground);
  root.style.setProperty("--ui-scrollbar", theme.ui.scrollbar);
  theme.ansiColors.forEach((color, i) => root.style.setProperty(`--vt-palette-${i}`, color));
  const light = isLightHex(theme.background);
  root.style.setProperty("--ui-color-scheme", light ? "light" : "dark");
  root.classList.toggle("dark", !light);
}

const withTheme: Decorator = (Story, context) => {
  const name = context.globals["theme"];
  applyTheme(builtinThemes[isThemeName(name) ? name : DEFAULT_THEME].colors);
  return (
    <TooltipProvider>
      <Story />
    </TooltipProvider>
  );
};

const preview: Preview = {
  decorators: [withTheme],
  globalTypes: {
    theme: {
      description: "配色（appearance.themeの組み込みテーマ）",
      toolbar: {
        title: "Theme",
        icon: "mirror",
        items: Object.entries(builtinThemes).map(([value, theme]) => ({
          value,
          title: theme.title,
        })),
        dynamicTitle: true,
      },
    },
  },
  initialGlobals: { theme: DEFAULT_THEME },
  parameters: {
    // 地の色はテーマ（--term-bg）に従わせるため、Storybook側の背景切り替えは使わない
    backgrounds: { disable: true },
    layout: "fullscreen",
  },
};

export default preview;
