import fs from "node:fs";

export interface TailOptions {
  /** read the whole existing file first (tests / replay). Default: only new lines. */
  fromStart?: boolean;
  intervalMs?: number;
  onError?: (err: Error) => void;
}

/** Polls a growing text file and emits complete lines. Survives truncation and late creation. */
export class LogTailer {
  private pos = 0;
  private pending: Buffer = Buffer.alloc(0);
  private timer: NodeJS.Timeout | null = null;
  private seenFile = false;

  constructor(
    private readonly path: string,
    private readonly onLine: (line: string) => void,
    private readonly opts: TailOptions = {},
  ) {}

  start(): void {
    this.stop();
    try {
      const st = fs.statSync(this.path);
      this.seenFile = true;
      this.pos = this.opts.fromStart ? 0 : st.size;
    } catch {
      this.pos = 0; // file will appear later: read it from the beginning
    }
    this.pending = Buffer.alloc(0);
    this.timer = setInterval(() => this.poll(), this.opts.intervalMs ?? 250);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  get fileSeen(): boolean {
    return this.seenFile;
  }

  /** Exposed for tests: run one poll synchronously. */
  poll(): void {
    let size: number;
    try {
      size = fs.statSync(this.path).size;
      this.seenFile = true;
    } catch {
      return; // not there yet
    }
    if (size < this.pos) {
      this.pos = 0; // truncated or rotated
      this.pending = Buffer.alloc(0);
    }
    if (size === this.pos) return;

    let fd: number | null = null;
    try {
      fd = fs.openSync(this.path, "r");
      while (this.pos < size) {
        const len = Math.min(size - this.pos, 1 << 20);
        const buf = Buffer.alloc(len);
        const read = fs.readSync(fd, buf, 0, len, this.pos);
        if (read <= 0) break;
        this.pos += read;
        this.consume(buf.subarray(0, read));
      }
    } catch (e) {
      this.opts.onError?.(e as Error);
    } finally {
      if (fd !== null) fs.closeSync(fd);
    }
  }

  private consume(chunk: Buffer): void {
    const all = this.pending.length ? Buffer.concat([this.pending, chunk]) : chunk;
    const lastNl = all.lastIndexOf(0x0a);
    if (lastNl === -1) {
      this.pending = Buffer.from(all);
      return;
    }
    const text = all.subarray(0, lastNl).toString("utf8");
    this.pending = Buffer.from(all.subarray(lastNl + 1));
    for (const line of text.split("\n")) this.onLine(line);
  }
}
