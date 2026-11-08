import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { LogTailer } from "../src/core/tail";

let dir: string;
let file: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "tail-"));
  file = path.join(dir, "Client.txt");
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("LogTailer", () => {
  it("only emits lines appended after start, handles partial lines", () => {
    fs.writeFileSync(file, "old line\n");
    const got: string[] = [];
    const t = new LogTailer(file, (l) => got.push(l));
    t.start();
    t.poll();
    expect(got).toEqual([]);

    fs.appendFileSync(file, "first\nsecond-par");
    t.poll();
    expect(got).toEqual(["first"]);

    fs.appendFileSync(file, "tial\r\nthird\n");
    t.poll();
    expect(got).toEqual(["first", "second-partial\r", "third"]);
    t.stop();
  });

  it("reads multibyte characters split across polls", () => {
    fs.writeFileSync(file, "");
    const got: string[] = [];
    const t = new LogTailer(file, (l) => got.push(l));
    t.start();
    const bytes = Buffer.from("zona ção\n", "utf8");
    fs.appendFileSync(file, bytes.subarray(0, 7)); // cuts inside 'ç'
    t.poll();
    fs.appendFileSync(file, bytes.subarray(7));
    t.poll();
    expect(got).toEqual(["zona ção"]);
    t.stop();
  });

  it("recovers after truncation", () => {
    fs.writeFileSync(file, "aaaaaaaaaaaa\n");
    const got: string[] = [];
    const t = new LogTailer(file, (l) => got.push(l));
    t.start();
    fs.writeFileSync(file, "new\n");
    t.poll();
    expect(got).toEqual(["new"]);
    t.stop();
  });

  it("picks up a file created after start", () => {
    const got: string[] = [];
    const t = new LogTailer(file, (l) => got.push(l));
    t.start();
    t.poll();
    expect(t.fileSeen).toBe(false);
    fs.writeFileSync(file, "hello\n");
    t.poll();
    expect(got).toEqual(["hello"]);
    t.stop();
  });

  it("fromStart replays existing content", () => {
    fs.writeFileSync(file, "a\nb\n");
    const got: string[] = [];
    const t = new LogTailer(file, (l) => got.push(l), { fromStart: true });
    t.start();
    t.poll();
    expect(got).toEqual(["a", "b"]);
    t.stop();
  });
});
