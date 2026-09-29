import { fileURLToPath } from "node:url";
import type { StorybookConfig } from "@storybook/react-vite";
import tailwindcss from "@tailwindcss/vite";
import { mergeConfig } from "vite";

const config: StorybookConfig = {
  framework: "@storybook/react-vite",
  stories: ["../src/mainview/**/*.stories.tsx"],
  core: { disableTelemetry: true },
  async viteFinal(viteConfig) {
    return mergeConfig(viteConfig, {
      // アプリ本体はTailwindをCLIで事前生成している（scripts/build-tailwind.ts）が、
      // Storybookはstoriesの編集に追従させたいのでViteプラグインで都度生成する
      plugins: [tailwindcss()],
      resolve: {
        // electrobun.config.tsのviews.mainview.aliasと同じ解決先に揃える
        alias: { "@": fileURLToPath(new URL("../src/mainview", import.meta.url)) },
      },
    });
  },
};

export default config;
