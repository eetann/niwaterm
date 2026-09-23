import { describe, expect, test } from "bun:test";
import { directoryName, isSequentialName, nextSequentialName } from "./board-naming";

describe("directoryName", () => {
  test("POSIXパスの末尾のディレクトリ名を返す", () => {
    expect(directoryName("/home/eetann/ghq/github.com/eetann/niwaterm")).toBe("niwaterm");
  });

  test("末尾のスラッシュは無視する", () => {
    expect(directoryName("/home/eetann/work///")).toBe("work");
  });

  test("Windowsのパス区切りにも対応する", () => {
    expect(directoryName("C:\\Users\\eetann\\work")).toBe("work");
  });

  test("WSLのUNCパスにも対応する", () => {
    expect(directoryName("\\\\wsl$\\NixOS\\home\\eetann\\niwaterm")).toBe("niwaterm");
  });

  test("区切りを含まない相対パスはそのまま名前になる", () => {
    expect(directoryName("niwaterm")).toBe("niwaterm");
  });

  test("ルート直下・ドライブ直下は名前が取れないのでnull", () => {
    expect(directoryName("/")).toBeNull();
    expect(directoryName("C:\\")).toBeNull();
  });

  test("cwdが未報告（undefined）ならnull", () => {
    expect(directoryName(undefined)).toBeNull();
  });
});

describe("nextSequentialName", () => {
  test("既存が無ければBoard 1", () => {
    expect(nextSequentialName([])).toBe("Board 1");
  });

  test("空いている最小の番号を使う", () => {
    expect(nextSequentialName(["Board 1", "Board 3"])).toBe("Board 2");
  });

  test("連番以外の自動名は番号の判定に影響しない", () => {
    expect(nextSequentialName(["niwaterm", "Board 1"])).toBe("Board 2");
  });
});

describe("isSequentialName", () => {
  test("連番方式で付いた名前を見分ける", () => {
    expect(isSequentialName("Board 12")).toBe(true);
    expect(isSequentialName("Board")).toBe(false);
    expect(isSequentialName("niwaterm")).toBe(false);
  });
});
