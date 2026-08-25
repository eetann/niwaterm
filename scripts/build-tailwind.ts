// preBuildフックで実行され、Tailwind CSS v4のユーティリティ生成をビルド前に行う。
// electrobun 2.x でviews.<name>.pluginsが廃止され(bun-plugin-tailwindが使えなくなった)ため、
// tailwindcss CLIを直接叩いて生成したCSSを.tailwind-build/に出力し、
// electrobun.config.tsのbuild.copyでビルド出力へ組み込む。
import { execFileSync } from "node:child_process";
import { join } from "node:path";

const projectRoot = join(import.meta.dir, "..");
const input = join(projectRoot, "src", "mainview", "index.css");
const output = join(projectRoot, ".tailwind-build", "index.css");
const tailwindcssBin = join(projectRoot, "node_modules", ".bin", "tailwindcss");

execFileSync(tailwindcssBin, ["--cwd", projectRoot, "-i", input, "-o", output], {
	stdio: "inherit",
});

console.log("preBuild(build-tailwind): index.css generated");
