import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createIpcServer, type IpcServer } from "./ipc-server";

describe("createIpcServer", () => {
  let dir: string;
  let socketPath: string;
  let server: IpcServer | null;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "niwaterm-ipc-test-"));
    socketPath = join(dir, "niwaterm.sock");
    server = null;
  });

  afterEach(async () => {
    server?.close();
    await rm(dir, { recursive: true, force: true });
  });

  test("/pingがok:true・pidを返す", async () => {
    server = await createIpcServer(socketPath);
    const res = await fetch("http://localhost/ping", { unix: socketPath });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, pid: process.pid });
  });

  test("close()後はソケットファイルが消える", async () => {
    server = await createIpcServer(socketPath);
    expect(existsSync(socketPath)).toBe(true);
    server.close();
    expect(existsSync(socketPath)).toBe(false);
  });

  test("stale（プロセスが生きていない）ソケットファイルが残っていても起動できる", async () => {
    await writeFile(socketPath, "");
    server = await createIpcServer(socketPath);
    const res = await fetch("http://localhost/ping", { unix: socketPath });
    expect(res.status).toBe(200);
  });

  test("既に別プロセスが同じソケットで生きている場合は例外を投げる", async () => {
    server = await createIpcServer(socketPath);
    await expect(createIpcServer(socketPath)).rejects.toThrow();
  });
});
