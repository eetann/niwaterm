import { describe, expect, test } from "bun:test";
import { defaultTerminalConfig } from "./terminal";

describe("defaultTerminalConfig", () => {
  test("scrollbackは非負の整数", () => {
    expect(Number.isInteger(defaultTerminalConfig.scrollback)).toBe(true);
    expect(defaultTerminalConfig.scrollback).toBeGreaterThanOrEqual(0);
  });
});
