import { CONFIG } from './config.ts';
import { appendFileSync, mkdirSync } from 'node:fs';

const logFile = CONFIG.debug ? `logs/${new Date().toISOString().slice(0, 10)}-run.log` : null;

if (logFile) {
  mkdirSync('logs', { recursive: true });
}

type LogListener = (level: string, message: string) => void;
const listeners: Set<LogListener> = new Set();

function fmt(level: string, args: unknown[]): string {
  const ts = new Date().toISOString();
  const msg = args
    .map((a) => (typeof a === 'object' && a !== null ? JSON.stringify(a) : String(a)))
    .join(' ');
  return `${ts} [${level}] ${msg}`;
}

function write(line: string, level: string, rawMsg: string): void {
  if (logFile) appendFileSync(logFile, line + '\n');
  listeners.forEach((l) => l(level, rawMsg));
}

export const logger = {
  subscribe(cb: LogListener): () => void {
    listeners.add(cb);
    return () => listeners.delete(cb);
  },
  log(...args: unknown[]): void {
    const rawMsg = args.map(a => String(a)).join(' ');
    console.log(...args);
    write(fmt('INFO', args), 'INFO', rawMsg);
  },
  warn(...args: unknown[]): void {
    const rawMsg = args.map(a => String(a)).join(' ');
    console.warn(...args);
    write(fmt('WARN', args), 'WARN', rawMsg);
  },
  error(...args: unknown[]): void {
    const rawMsg = args.map(a => String(a)).join(' ');
    console.error(...args);
    write(fmt('ERROR', args), 'ERROR', rawMsg);
  },
  debug(...args: unknown[]): void {
    if (!CONFIG.debug) return;
    const rawMsg = args.map(a => String(a)).join(' ');
    console.log(...args);
    write(fmt('DEBUG', args), 'DEBUG', rawMsg);
  },
};
