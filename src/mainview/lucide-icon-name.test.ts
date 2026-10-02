import { describe, expect, test } from "bun:test";
import { icons } from "lucide-react";
import { lucideIconKey } from "./lucide-icon-name";

describe("lucideIconKey", () => {
  test("kebab-caseのアイコン名をlucide-reactのiconsのキーへ変換する", () => {
    expect(lucideIconKey("git-branch")).toBe("GitBranch");
    expect(lucideIconKey("power")).toBe("Power");
    expect(lucideIconKey("arrow-down-0-1")).toBe("ArrowDown01");
    for (const name of ["git-branch", "power", "arrow-down-0-1", "square-terminal"]) {
      expect(icons[lucideIconKey(name) as keyof typeof icons]).toBeDefined();
    }
  });
});
