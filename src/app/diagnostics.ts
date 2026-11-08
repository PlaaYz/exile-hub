// The Diagnóstico tab: recent events the app understood and the copyable report.
import { diagReport, kDiagMax, type DiagEntry, type DiagKind } from "../core/diag";

export class Diagnostics {
  private entries: DiagEntry[] = [];
  lastLineAt: number | null = null;
  linesSeen = 0;

  add(kind: DiagKind, text: string): void {
    this.entries.push({ ts: Date.now(), kind, text });
    if (this.entries.length > kDiagMax) this.entries.splice(0, this.entries.length - kDiagMax);
  }

  /** A Client.txt line arrived (parsed or not). */
  lineSeen(): void {
    this.lastLineAt = Date.now();
    this.linesSeen++;
  }

  /** Newest first, for the tab. */
  recent(n = 60): DiagEntry[] {
    return this.entries.slice(-n).reverse();
  }

  report(header: string[]): string {
    return diagReport(header, [...this.entries]);
  }
}
