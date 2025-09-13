import * as util from "node:util";
import {table as tableFormatFunction} from "./table";
import {originalConsole} from "./originalConsole";

import fs from "fs";

type ConsoleLabelKey = string | number | symbol;

type LogLevel = "LOG" | "DEBUG" | "INFO" | "WARN" | "ERROR";

type LogNode = { kind: "log"; level: LogLevel; text: string; ts: number };
type GroupNode = { kind: "group"; label: string; ts: number; children: Node[] };
type Node = LogNode | GroupNode;

const logFilePath = "./logs/";
let logFile: NodeJS.WritableStream | null = null;
const logOptions: Intl.DateTimeFormatOptions = {hour12: false};

function getDateString(): string {
  const date = new Date();
  //format YYYYMMDD-HHMMSS
  return date.toLocaleDateString("sv-SE", logOptions).replace(/-/g, "") + "-" + date.toLocaleTimeString("sv-SE", logOptions).replace(/:/g, "");
}

function getLogFile(): NodeJS.WritableStream {
  if (!logFile) {
    if (!fs.existsSync(logFilePath)) {
      fs.mkdirSync(logFilePath, {recursive: true});
    }
    logFile = fs.createWriteStream(logFilePath + getDateString() + ".log", {flags: "a"});
  }
  return logFile!;
}

const errorFilePath = "./crash-logs/";
let errorFile: NodeJS.WritableStream | null = null;

function getErrorFile(): NodeJS.WritableStream {
  if (!fs.existsSync(logFilePath)) {
    fs.mkdirSync(logFilePath, {recursive: true});
  }
  if (!errorFile) errorFile = fs.createWriteStream(errorFilePath + getDateString() + ".log", {flags: "a"});

  return errorFile!;
}

class FileConsole implements Console {
  // If you really need access to the Node Console constructor,
  public Console: typeof import("node:console").Console =
    undefined as unknown as typeof import("node:console").Console;


  // ── organization ──────────────────────────────────────────────────────────────
  private _rootGroup: GroupNode = {kind: "group", label: "<root>", ts: Date.now(), children: []};
  private _groupStack: GroupNode[] = [this._rootGroup];


  private _append(node: Node): void {
    const parent = this._groupStack[this._groupStack.length - 1];
    parent.children.push(node);
  }

  group(...data: unknown[]): void {
    const label = `[${util.format(...data)}]`;
    const node: GroupNode = {kind: "group", label, ts: Date.now(), children: []};
    this._append(node);
    this._groupStack.push(node);
  }

  groupCollapsed = this.group;

  groupEnd(): void {
    const node = this._groupStack.pop();
    if (!node || node === this._rootGroup) return;
    if (this._groupStack.length === 1) {
      const lines = this._renderTopGroup(node);
      for (const ln of lines) this.writeLine(this._stamp(ln.ts, ln.level, ln.text));
    }
  }


// ── rendering helpers ──────────────────────────────────────────────────────────
// Longest of the levels, plus the two brackets
  private _tagWidth: number = (() => {
    const levels: ReadonlyArray<LogLevel> = ["LOG", "DEBUG", "INFO", "WARN", "ERROR"];
    const maxLen = levels.reduce((m, s) => Math.max(m, s.length), 0);
    return maxLen + 2; // includes '[' and ']'
  })();

  private _formatTag = (level?: LogLevel): string => {
    if (!level) return " ".repeat(this._tagWidth);
    const raw = `[${level}]`;
    return raw.length >= this._tagWidth ? raw : raw + " ".repeat(this._tagWidth - raw.length);
  };

// existing ts formatter from your timestamped version
  private _stamp = (ts: number, level: LogLevel | undefined, line: string): string =>
    `[${this._formatTimestamp(ts)}] ${this._formatTag(level)} ${line}`;


  private _formatTimestamp = (ts: number): string => {
    const d = new Date(ts);
    const pad = (n: number, w = 2) => String(n).padStart(w, "0");
    const y = d.getFullYear();
    const mo = pad(d.getMonth() + 1);
    const da = pad(d.getDate());
    const h = pad(d.getHours());
    const mi = pad(d.getMinutes());
    const s = pad(d.getSeconds());
    const ms = String(d.getMilliseconds()).padStart(3, "0");
    return `${y}-${mo}-${da} ${h}:${mi}:${s}.${ms}`;
  };

  private _renderTopGroup(
    node: GroupNode
  ): Array<{ ts: number; level: LogLevel | undefined; text: string }> {
    const out: Array<{ ts: number; level: LogLevel | undefined; text: string }> = [];
    out.push({ts: node.ts, level: undefined, text: node.label}); // group line has blank level column
    out.push(...this._renderChildren(node.children, []));
    return out;
  }

  private _renderChildren(
    children: Node[],
    ancestorsLast: ReadonlyArray<boolean>
  ): Array<{ ts: number; level: LogLevel | undefined; text: string }> {
    const lines: Array<{ ts: number; level: LogLevel | undefined; text: string }> = [];
    for (let i = 0; i < children.length; i++) {
      const child = children[i];
      const isLast = i === children.length - 1;

      const guide = ancestorsLast.map((last) => (last ? "    " : "│   ")).join("");
      const branch = isLast ? "└── " : "├── ";

      if (child.kind === "log") {
        lines.push({ts: child.ts, level: child.level, text: guide + branch + child.text});
      } else {
        lines.push({ts: child.ts, level: undefined, text: guide + branch + child.label});
        lines.push(...this._renderChildren(child.children, [...ancestorsLast, isLast]));
      }
    }
    return lines;
  }


  // ── main ─────────────────────────────────────────────────────────────────────
  assert(condition?: boolean, ...data: unknown[]): void {
    throw new Error("Method not implemented.");
  }

  writeLine(msg: string): void {
    getLogFile().write(msg + "\n");
  }

  private writeLineHelper(level: LogLevel, timestamp: number, msg: string): void {
    if (this._groupStack.length === 1) {
      this.writeLine(this._stamp(timestamp, level, msg));
    } else {
      this._append({kind: "log", level, text: msg, ts: timestamp});
    }
  }

  debug(...data: unknown[]): void {
    const text = util.format(...data);
    const ts = Date.now();
    text.split("\n").forEach((line) => this.writeLineHelper("DEBUG", ts, line));
  }

  error(...data: unknown[]): void {
    const text = util.format(...data);
    const ts = Date.now();
    text.split("\n").forEach((line) => this.writeLineHelper("ERROR", ts, line));
    text.split("\n").forEach((line) => getErrorFile().write(`[ERROR] [${(new Date()).toISOString()}] ${line}\n`));
  }

  info(...data: unknown[]): void {
    const text = util.format(...data);
    const ts = Date.now();
    text.split("\n").forEach((line) => this.writeLineHelper("INFO", ts, line));
  }

  log(...data: unknown[]): void {
    const text = util.format(...data);
    const ts = Date.now();
    text.split("\n").forEach((line) => this.writeLineHelper("LOG", ts, line));
  }


  trace(...data: unknown[]): void {
    //todo: implement
    throw new Error("Method not implemented.");
  }

  warn(...data: unknown[]): void {
    const text = util.format(...data);
    const ts = Date.now();
    text.split("\n").forEach((line) => this.writeLineHelper("WARN", ts, line));
  }

  clear(): void {
    //flush current log file and start a new one
    if (logFile) {
      logFile.end();
      logFile = null;
    }
    if (errorFile) {
      errorFile.end();
      errorFile = null;
    }
  }

  // ── derived helpers ──────────────────────────────────────────────────────────
  private _countTracker: Record<ConsoleLabelKey, number> = {};

  count(label?: string): void {
    const key = (label ?? "default") as ConsoleLabelKey;
    if (!this._countTracker[key]) this._countTracker[key] = 0;
    this._countTracker[key]++;
    this.log(`${String(key)}: ${this._countTracker[key]}`);
  }

  countReset(label?: string): void {
    const key = (label ?? "default") as ConsoleLabelKey;
    this._countTracker[key] = 0;
  }

  dir(item?: unknown, options?: util.InspectOptions): void {
    // modern single-`options` overload; no `any`
    this.log(util.inspect(item, options));
  }

  dirxml(...data: unknown[]): void {
    throw new Error("Method not implemented.");
  }


// Implementation (must be the single definition with a body)
  table(...args: Parameters<typeof tableFormatFunction>): void {
    console.log(tableFormatFunction(...args));
  }

  private _time: Record<ConsoleLabelKey, number> = {};

  time(label?: string): void {
    const key = (label ?? "default") as ConsoleLabelKey;
    if (this._time[key]) {
      this.warn(`Timer '${String(key)}' already exists`);
      return;
    }
    this._time[key] = Date.now();
  }

  timeEnd(label?: string): void {
    const key = (label ?? "default") as ConsoleLabelKey;
    if (!this._time[key]) {
      this.warn(`Timer '${String(key)}' does not exist`);
      return;
    }
    const duration = Date.now() - this._time[key];
    this.log(`${String(key)}: ${duration}ms`);
    delete this._time[key];
  }

  timeLog(label?: string, ...data: unknown[]): void {
    const key = (label ?? "default") as ConsoleLabelKey;
    if (!this._time[key]) {
      this.warn(`Timer '${String(key)}' does not exist`);
      return;
    }
    const duration = Date.now() - this._time[key];
    this.log(`${String(key)}: ${duration}ms`, ...data);
  }

  // ── inspector-only (present in many environments) ────────────────────────────
  public timeStamp: ((label?: string) => void) = originalConsole.timeStamp;
  public profile: ((label?: string) => void) = originalConsole.profile;
  public profileEnd: ((label?: string) => void) = originalConsole.profileEnd;
}

// Assign into the global console. Cast through `unknown` to avoid `any`.
export const fileLogger = Object.freeze(new FileConsole()) as unknown as Console;
export default fileLogger;