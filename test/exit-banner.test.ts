import { describe, expect, test } from "bun:test";

import { printExitBanner } from "../src/ExitBanner.tsx";

describe("ExitBanner", () => {
  test("prints clean exit banner without logo to stdout", () => {
    const logs: string[] = [];
    const origLog = console.log;
    console.log = (msg: string) => {
      logs.push(msg);
    };

    try {
      printExitBanner("test-session-1234", "wangscode");
    } finally {
      console.log = origLog;
    }

    const output = logs.join("\n");
    expect(output).toContain("Wangs Code");
    expect(output).toContain("Session ID: test-session-1234");
    expect(output).toContain("wangscode --resume test-session-1234");
    // Confirms logo blocks are omitted
    expect(output).not.toContain("████");
  });
});
