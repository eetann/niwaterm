import { define } from "gunshi";
import { failAndExit } from "../../cli-error";
import { getTabInfo, resolveIpcEndpoint, type TabInfo } from "../../ipc-client";
import { createTargetResolver } from "../../resolve-target";

export const TAB_INFO_FIELDS = [
  "workspace.id",
  "workspace.name",
  "board.id",
  "board.name",
  "tile.id",
  "tile.name",
  "tab.id",
  "tab.name",
] as const;

export type TabInfoField = (typeof TAB_INFO_FIELDS)[number];

/** fieldの値。所属が無い（ポップアップのtile等）・名前が未設定のときは空文字列 */
export function tabInfoField(info: TabInfo, field: TabInfoField): string {
  const [resource, key] = field.split(".") as [keyof TabInfo, "id" | "name"];
  return info[resource]?.[key] ?? "";
}

export function formatTabInfo(info: TabInfo): string[] {
  return TAB_INFO_FIELDS.map((field) => {
    const value = tabInfoField(info, field);
    return value ? `${field}: ${value}` : `${field}:`;
  });
}

export default define({
  name: "show",
  description: "指定したタブの所属ワークスペース・Board・タイルのidと名前を表示する",
  args: {
    tab: {
      type: "string",
      short: "t",
      description:
        "対象のtabId（niwaterm listで確認）。省略時はこのコマンドを実行しているタブ（niwatermの外から実行した場合はフォーカス中タイルのアクティブタブ）",
    },
    field: {
      type: "enum",
      choices: TAB_INFO_FIELDS,
      short: "f",
      description:
        "指定した項目の値だけを出力する（シェルスクリプトの$(...)で受け取る用）。値が無いとき（ポップアップのtile.*や未設定の名前）は空行を出す。--jsonとは同時指定不可",
    },
    json: {
      type: "boolean",
      description: "JSON形式で出力する。--fieldとは同時指定不可",
    },
  },
  run: async (ctx) => {
    const { field, json } = ctx.values;
    if (field && json) {
      failAndExit("tab showに失敗しました: --fieldと--jsonは同時に指定できません");
    }
    const endpoint = resolveIpcEndpoint();
    const target = createTargetResolver(endpoint, "tab show", { tabId: ctx.values.tab });
    const result = await getTabInfo(endpoint, await target.tabId());
    if (!result.ok) {
      failAndExit(`tab showに失敗しました: ${result.error}`);
    }
    if (field) {
      console.log(tabInfoField(result.info, field));
      return;
    }
    if (json) {
      console.log(JSON.stringify(result.info, null, 2));
      return;
    }
    for (const line of formatTabInfo(result.info)) {
      console.log(line);
    }
  },
});
