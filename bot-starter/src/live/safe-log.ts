// Telemetry is best-effort. A full disk or closed stdout must never prevent
// the bot from submitting a bid or completing a word.
import { appendFileSync, writeSync } from 'node:fs';
import { join } from 'node:path';
export interface LogIO {
  append(path: string, text: string): void;
  stdout(text: string): void;
  now(): number;
}
const defaultIO: LogIO = {
  append: (path, text) => appendFileSync(path, text),
  stdout: text => { writeSync(1, text); },
  now: Date.now,
};
export class SafeLog {
  private fileRetryAt = 0;
  private stdoutRetryAt = 0;
  private dropped = 0;
  constructor(private directory: string, private io: LogIO = defaultIO) {}
  text(line: string): void {
    const now = this.io.now();
    if (now < this.stdoutRetryAt) return;
    try { this.io.stdout(line + '\n'); }
    catch { this.stdoutRetryAt = now + 30_000; }
  }
  json(file: string, row: Record<string, unknown>): void {
    const now = this.io.now();
    if (now < this.fileRetryAt) { this.dropped++; return; }
    try {
      const date = new Date(now).toISOString();
      const text = JSON.stringify({ t: date, ...row, ...(this.dropped ? { telemetryDropped: this.dropped } : {}) },
        (_k, value) => typeof value === 'bigint' ? Number(value) : value) + '\n';
      this.io.append(join(this.directory, `${file}-${date.slice(0,10)}.jsonl`), text);
      this.dropped = 0;
    } catch {
      this.dropped++;
      this.fileRetryAt = now + 30_000;
    }
  }
}
