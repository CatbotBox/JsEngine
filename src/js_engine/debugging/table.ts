export function table(): string;
export function table<T extends ReadonlyArray<unknown>>(tabularData: ReadonlyArray<T>, properties?: ReadonlyArray<number | string>): string; // array of arrays/tuples
export function table<T extends Record<PropertyKey, unknown>>(tabularData: ReadonlyArray<T>, properties?: ReadonlyArray<Extract<keyof T, string | number>>): string; // array of objects
export function table<T extends Record<PropertyKey, unknown>>(tabularData: Readonly<Record<string, T>>, properties?: ReadonlyArray<Extract<keyof T, string | number>>): string; // object of rows
export function table<K, V>(tabularData: ReadonlyMap<K, V>): string; // Map
export function table<V>(tabularData: ReadonlySet<V>): string;       // Set
export function table<T>(tabularData: ArrayLike<T>): string;         // typed arrays, array-like
export function table(tabularData?: unknown, properties?: ReadonlyArray<string | number>): string {
  type Row = Record<string, unknown>;
  type Rows = Array<Row>;

  const INDEX_COL = "(index)";

  const isMap = (v: unknown): v is ReadonlyMap<unknown, unknown> =>
    typeof v === "object" && v !== null && v instanceof Map;

  const isSet = (v: unknown): v is ReadonlySet<unknown> =>
    typeof v === "object" && v !== null && v instanceof Set;

  const isArrayLike = (v: unknown): v is ArrayLike<unknown> =>
    typeof v !== "string" &&
    typeof v !== "function" &&
    !!v &&
    typeof (v as { length?: unknown }).length === "number";

  const isPlainObject = (v: unknown): v is Readonly<Record<string, unknown>> => {
    if (typeof v !== "object" || v === null) return false;
    const proto = Object.getPrototypeOf(v);
    return proto === Object.prototype || proto === null;
  };

  const toRowObject = (value: unknown): Row => {
    if (value === null || typeof value !== "object") {
      return {value};
    }
    if (Array.isArray(value)) {
      const r: Row = {};
      for (let i = 0; i < value.length; i++) r[String(i)] = value[i];
      return r;
    }
    if (isArrayLike(value)) {
      const r: Row = {};
      const a = Array.from(value);
      for (let i = 0; i < a.length; i++) r[String(i)] = a[i];
      return r;
    }
    // enumerable own props only
    const r: Row = {};
    for (const k of Object.keys(value)) {
      r[k] = (value as Record<string, unknown>)[k];
    }
    return r;
  };

  const formatCell = (v: unknown): string => {
    if (v === null) return "null";
    switch (typeof v) {
      case "undefined":
        return "undefined";
      case "string":
        return v;
      case "number":
      case "boolean":
      case "bigint":
        return String(v);
      case "symbol":
        return v.description ? `Symbol(${v.description})` : String(v);
      case "function":
        return "[Function]";
      case "object":
        if (Array.isArray(v)) return `Array(${v.length})`;
        if (v instanceof Map) return `Map(${v.size})`;
        if (v instanceof Set) return `Set(${v.size})`;
        if (ArrayBuffer.isView(v as ArrayBufferView)) {
          const view = v as ArrayBufferView;
          return `${(view.constructor as { name: string }).name}(${view.byteLength})`;
        }
        return "[Object]";
    }
    return `[${typeof v}]`;
  };

  // Normalize input into rows + index labels
  let rows: Rows = [];
  let indexLabels: string[] = [];

  if (tabularData === undefined) {
    // nothing to print
    return "┌─┐\n└─┘";
  } else if (isMap(tabularData)) {
    let i = 0;
    for (const [k, v] of tabularData.entries()) {
      rows.push({key: k, value: v});
      indexLabels.push(String(i++));
    }
  } else if (isSet(tabularData)) {
    let i = 0;
    for (const v of tabularData.values()) {
      rows.push({value: v});
      indexLabels.push(String(i++));
    }
  } else if (Array.isArray(tabularData) || isArrayLike(tabularData)) {
    const arr = Array.isArray(tabularData) ? tabularData : Array.from(tabularData);
    rows = arr.map(toRowObject);
    indexLabels = arr.map((_, i) => String(i));
  } else if (isPlainObject(tabularData)) {
    const entries = Object.entries(tabularData);
    for (const [k, v] of entries) {
      rows.push(toRowObject(v));
      indexLabels.push(k);
    }
  } else {
    rows = [toRowObject(tabularData)];
    indexLabels = ["0"];
  }

// Determine columns
  const providedCols = properties?.map((p) => String(p));
  const colSet: string[] = [];

  if (providedCols && providedCols.length > 0) {
    for (const c of providedCols) if (!colSet.includes(c)) colSet.push(c);
  } else {
    for (const r of rows) {
      for (const k of Object.keys(r)) {
        if (!colSet.includes(k)) colSet.push(k);
      }
    }
  }

// Build printable matrix (headers + rows as strings)
  const headers = [INDEX_COL, ...colSet];
  const matrix: string[][] = [];
  matrix.push(headers);

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const line: string[] = [indexLabels[i]];
    for (const c of colSet) {
      line.push(formatCell(r[c]));
    }
    matrix.push(line);
  }

// Compute column widths
  const widths: number[] = new Array(headers.length).fill(0);
  for (let j = 0; j < headers.length; j++) {
    let maxLen = 0;
    for (let i = 0; i < matrix.length; i++) {
      const cell = matrix[i][j] ?? "";
      const len = cell.length;
      if (len > maxLen) maxLen = len;
    }
    widths[j] = Math.max(3, maxLen); // minimum width
  }

  const pad = (s: string, w: number): string =>
    s.length < w ? s + " ".repeat(w - s.length) : s;

  const lineOf = (left: string, mid: string, right: string): string => {
    const parts: string[] = [];
    for (let i = 0; i < widths.length; i++) {
      parts.push("".padEnd(widths[i] + 2, "─")); // 1 space padding on each side
    }
    return left + parts.join(mid) + right;
  };

  const top = lineOf("┌", "┬", "┐");
  const sep = lineOf("├", "┼", "┤");
  const bot = lineOf("└", "┴", "┘");

  const renderRow = (cells: string[]): string => {
    const padded = cells.map((c, i) => " " + pad(c, widths[i]) + " ");
    return "│" + padded.join("│") + "│";
  };

  const out: string[] = [];
  out.push(top);
  out.push(renderRow(matrix[0])); // header
  out.push(sep);
  for (let i = 1; i < matrix.length; i++) out.push(renderRow(matrix[i]));
  out.push(bot);

  return out.join("\n");
}