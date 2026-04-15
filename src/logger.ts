import { CONFIG } from './config.ts';
import { appendFileSync, mkdirSync } from 'node:fs';

const logFile = CONFIG.debug ? `logs/${new Date().toISOString().slice(0, 10)}-run.log` : null;

if (logFile) {
  mkdirSync('logs', { recursive: true });
}

function fmt(level: string, args: unknown[]): string {
  const ts = new Date().toISOString();
  const msg = args
    .map((a) => (typeof a === 'object' && a !== null ? JSON.stringify(a) : String(a)))
    .join(' ');
  return `${ts} [${level}] ${msg}`;
}

function write(line: string): void {
  if (logFile) appendFileSync(logFile, line + '\n');
}

export const logger = {
  log(...args: unknown[]): void {
    console.log(...args);
    write(fmt('INFO', args));
  },
  warn(...args: unknown[]): void {
    console.warn(...args);
    write(fmt('WARN', args));
  },
  error(...args: unknown[]): void {
    console.error(...args);
    write(fmt('ERROR', args));
  },
  debug(...args: unknown[]): void {
    if (!CONFIG.debug) return;
    console.log(...args);
    write(fmt('DEBUG', args));
  },
};
