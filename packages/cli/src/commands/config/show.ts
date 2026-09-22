import { define } from "gunshi";
import { failAndExit } from "../../cli-error";
import { resolveIpcEndpoint, showConfig, type ShowConfigResult } from "../../ipc-client";

/** 全セクションを通したキー名の幅で揃える。セクションごとに幅が変わると縦の並びが崩れて読みにくい */
function keyWidth(sections: Extract<ShowConfigResult, { ok: true }>["sections"]): number {
  const widths = sections.flatMap((section) => section.entries.map((entry) => entry.key.length));
  return widths.length === 0 ? 0 : Math.max(...widths);
}

export function formatConfigSummary(result: Extract<ShowConfigResult, { ok: true }>): string[] {
  const lines = [
    result.configFileLoaded
      ? `config: ${result.configFile}`
      : `config: ${result.configFile} (未読み込み。全項目が既定値です)`,
  ];
  const width = keyWidth(result.sections);
  for (const section of result.sections) {
    lines.push("", `[${section.name}]`);
    for (const entry of section.entries) {
      const value = entry.note === undefined ? entry.value : `${entry.value} (${entry.note})`;
      lines.push(`${entry.key.padEnd(width)}  ${value}`);
    }
  }
  return lines;
}

export default define({
  name: "show",
  description: "現在有効な設定値の一覧を表示",
  run: async () => {
    const result = await showConfig(resolveIpcEndpoint());
    if (!result.ok) {
      failAndExit(`config showに失敗しました: ${result.error}`);
    }
    for (const line of formatConfigSummary(result)) {
      console.log(line);
    }
  },
});
