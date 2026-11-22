export interface OriginalPosition {
    readonly source: string;
    readonly line: number;
    readonly column: number;
    readonly name?: string;
}

export interface DecodedMappings {
    readonly lineStarts: Int32Array;
    readonly segments: Int32Array;
}

export interface StackFrameLocation {
    readonly prefix: string;
    readonly url: string;
    readonly line: number;
    readonly column: number;
    readonly suffix: string;
}

export interface StackLine {
    readonly text: string;
    readonly bundleFrame: string | undefined;
}

export type SourceMapLookup = (url: string) => SourceMap | undefined;

export const SEGMENT_FIELDS = 5;

const BASE64_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const ASCII_RANGE = 128;
const NO_VALUE = -1;
const VLQ_SHIFT = 5;
const VLQ_CONTINUATION_BIT = 1 << VLQ_SHIFT;
const VLQ_VALUE_MASK = VLQ_CONTINUATION_BIT - 1;
const VLQ_SIGN_BIT = 1;
const LINE_SEPARATOR = ";".charCodeAt(0);
const SEGMENT_SEPARATOR = ",".charCodeAt(0);
const GENERATED_COLUMN_FIELD = 0;
const SOURCE_FIELD = 1;
const SOURCE_LINE_FIELD = 2;
const SOURCE_COLUMN_FIELD = 3;
const NAME_FIELD = 4;
const FIELDS_WITH_SOURCE = 4;
const FIELDS_WITH_NAME = 5;
const INITIAL_SEGMENT_CAPACITY = 1024;
const GROWTH_FACTOR = 2;
const ONE_BASED = 1;
const SUPPORTED_SOURCE_MAP_VERSION = 3;
const INLINE_SOURCE_MAP_MARKER = "//# sourceMappingURL=data:application/json";
const BASE64_MARKER = ";base64,";
const DATA_URL_SEPARATOR = ",";
const STACK_LINE_BREAK = /\r?\n/;
const STACK_LINE_JOINER = "\n";
const NAMED_V8_FRAME = /^(\s*at .*?\()(.+):(\d+):(\d+)(\)\s*)$/;
const BARE_V8_FRAME = /^(\s*at )(.+):(\d+):(\d+)(\s*)$/;
const FIREFOX_FRAME = /^(.*?@)(.+):(\d+):(\d+)(\s*)$/;
const FRAME_PATTERNS: readonly RegExp[] = [NAMED_V8_FRAME, BARE_V8_FRAME, FIREFOX_FRAME];
const FILE_URL_PREFIX = /^file:\/\/\/?/;
const BACKSLASHES = /\\/g;
const FORWARD_SLASH = "/";
const RELATIVE_SEGMENTS = /^(?:\.\.?\/)+/;
const TRAILING_SLASHES = /\/+$/;
const ABSOLUTE_PATH = /^(?:\/|[A-Za-z]:\/|[A-Za-z][A-Za-z0-9+.-]*:)/;
const PROJECT_EDITOR_ENTRY = /(?:^|\/)generated\/main\.editor-[^/]+\.worker\.ts$/;
const PROJECT_GENERATED_FOLDER = "generated/";

const BASE64_VALUES = (() => {
    const values = new Int8Array(ASCII_RANGE).fill(NO_VALUE);
    for (let index = 0; index < BASE64_ALPHABET.length; index++) values[BASE64_ALPHABET.charCodeAt(index)] = index;
    return values;
})();

function base64Value(mappings: string, position: number): number {
    const code = mappings.charCodeAt(position);
    const value = code < ASCII_RANGE ? BASE64_VALUES[code] : NO_VALUE;
    if (value === NO_VALUE) throw new Error(`Invalid source map mappings character at ${position}`);
    return value;
}

class SegmentBuffer {
    private values = new Int32Array(INITIAL_SEGMENT_CAPACITY * SEGMENT_FIELDS);
    private used = 0;

    public get count(): number {
        return this.used / SEGMENT_FIELDS;
    }

    public push(fields: Int32Array): void {
        if (this.used + SEGMENT_FIELDS > this.values.length) {
            const grown = new Int32Array(this.values.length * GROWTH_FACTOR);
            grown.set(this.values);
            this.values = grown;
        }
        this.values.set(fields, this.used);
        this.used += SEGMENT_FIELDS;
    }

    public finish(): Int32Array {
        return this.values.slice(0, this.used);
    }
}

export function decodeMappings(mappings: string): DecodedMappings {
    const segments = new SegmentBuffer();
    const lineStarts: number[] = [0];
    const state = new Int32Array(SEGMENT_FIELDS);
    const segment = new Int32Array(SEGMENT_FIELDS);
    let position = 0;
    while (position < mappings.length) {
        const code = mappings.charCodeAt(position);
        if (code === LINE_SEPARATOR) {
            lineStarts.push(segments.count);
            state[GENERATED_COLUMN_FIELD] = 0;
            position++;
            continue;
        }
        if (code === SEGMENT_SEPARATOR) {
            position++;
            continue;
        }
        let fields = 0;
        while (position < mappings.length && mappings.charCodeAt(position) !== LINE_SEPARATOR && mappings.charCodeAt(position) !== SEGMENT_SEPARATOR) {
            let shift = 0;
            let accumulated = 0;
            let digit: number;
            do {
                if (position >= mappings.length) throw new Error("Truncated source map mappings");
                digit = base64Value(mappings, position++);
                accumulated += (digit & VLQ_VALUE_MASK) * 2 ** shift;
                shift += VLQ_SHIFT;
            } while ((digit & VLQ_CONTINUATION_BIT) !== 0);
            const magnitude = Math.floor(accumulated / 2);
            const delta = (accumulated & VLQ_SIGN_BIT) === 0 ? magnitude : -magnitude;
            if (fields < SEGMENT_FIELDS) state[fields] += delta;
            fields++;
        }
        segment[GENERATED_COLUMN_FIELD] = state[GENERATED_COLUMN_FIELD];
        const hasSource = fields >= FIELDS_WITH_SOURCE;
        segment[SOURCE_FIELD] = hasSource ? state[SOURCE_FIELD] : NO_VALUE;
        segment[SOURCE_LINE_FIELD] = hasSource ? state[SOURCE_LINE_FIELD] : NO_VALUE;
        segment[SOURCE_COLUMN_FIELD] = hasSource ? state[SOURCE_COLUMN_FIELD] : NO_VALUE;
        segment[NAME_FIELD] = fields >= FIELDS_WITH_NAME ? state[NAME_FIELD] : NO_VALUE;
        segments.push(segment);
    }
    lineStarts.push(segments.count);
    return {lineStarts: Int32Array.from(lineStarts), segments: segments.finish()};
}

function lastSegmentAtOrBefore(mappings: DecodedMappings, first: number, end: number, generatedColumn: number): number {
    let low = first;
    let high = end - 1;
    let found = NO_VALUE;
    while (low <= high) {
        const middle = (low + high) >>> 1;
        if (mappings.segments[middle * SEGMENT_FIELDS + GENERATED_COLUMN_FIELD] <= generatedColumn) {
            found = middle;
            low = middle + 1;
        } else {
            high = middle - 1;
        }
    }
    return found;
}

function slashed(path: string): string {
    return path.replace(BACKSLASHES, FORWARD_SLASH);
}

function joinedSource(sourceRoot: string, source: string): string {
    const root = slashed(sourceRoot).replace(TRAILING_SLASHES, "");
    const path = slashed(source);
    return root.length === 0 || ABSOLUTE_PATH.test(path) ? path : `${root}${FORWARD_SLASH}${path}`;
}

export function projectRootOf(sources: readonly string[]): string | undefined {
    const entry = sources.find(source => PROJECT_EDITOR_ENTRY.test(source));
    if (entry === undefined) return undefined;
    return entry.slice(0, entry.lastIndexOf(PROJECT_GENERATED_FOLDER));
}

export function displaySourcePath(source: string, projectRoot: string | undefined): string {
    const path = slashed(source).replace(FILE_URL_PREFIX, FORWARD_SLASH);
    if (projectRoot !== undefined && projectRoot.length > 0 && path.startsWith(projectRoot)) return path.slice(projectRoot.length);
    return path.replace(RELATIVE_SEGMENTS, "");
}

function isStringArray(value: unknown): value is string[] {
    return Array.isArray(value) && value.every(item => typeof item === "string");
}

function isNullableStringArray(value: unknown): value is (string | null)[] {
    return Array.isArray(value) && value.every(item => item === null || typeof item === "string");
}

export class SourceMap {
    public readonly sources: readonly string[];

    private constructor(
        private readonly mappings: DecodedMappings,
        sources: readonly string[],
        private readonly names: readonly string[],
    ) {
        const projectRoot = projectRootOf(sources);
        this.sources = sources.map(source => displaySourcePath(source, projectRoot));
    }

    public static parse(text: string): SourceMap | undefined {
        try {
            const parsed: unknown = JSON.parse(text);
            if (typeof parsed !== "object" || parsed === null) return undefined;
            const map = parsed as Record<string, unknown>;
            if (map.version !== SUPPORTED_SOURCE_MAP_VERSION || typeof map.mappings !== "string" || !isNullableStringArray(map.sources)) return undefined;
            const sourceRoot = typeof map.sourceRoot === "string" ? map.sourceRoot : "";
            const sources = map.sources.map(source => joinedSource(sourceRoot, source ?? ""));
            const names = isStringArray(map.names) ? map.names : [];
            return new SourceMap(decodeMappings(map.mappings), sources, names);
        } catch {
            return undefined;
        }
    }

    public originalPosition(line: number, column: number): OriginalPosition | undefined {
        const lineIndex = line - ONE_BASED;
        const {lineStarts, segments} = this.mappings;
        if (lineIndex < 0 || lineIndex + 1 >= lineStarts.length) return undefined;
        const found = lastSegmentAtOrBefore(this.mappings, lineStarts[lineIndex], lineStarts[lineIndex + 1], column - ONE_BASED);
        if (found === NO_VALUE) return undefined;
        const offset = found * SEGMENT_FIELDS;
        const source = this.sources[segments[offset + SOURCE_FIELD]];
        if (source === undefined) return undefined;
        const position = {source, line: segments[offset + SOURCE_LINE_FIELD] + ONE_BASED, column: segments[offset + SOURCE_COLUMN_FIELD] + ONE_BASED};
        const name = this.names[segments[offset + NAME_FIELD]];
        return name === undefined ? position : {...position, name};
    }
}

function decodedBase64(payload: string): string {
    const binary = atob(payload);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
    return new TextDecoder().decode(bytes);
}

export function inlineSourceMapText(bundleText: string): string | undefined {
    const marker = bundleText.lastIndexOf(INLINE_SOURCE_MAP_MARKER);
    if (marker < 0) return undefined;
    const lineEnd = bundleText.indexOf(STACK_LINE_JOINER, marker);
    const dataUrl = bundleText.slice(marker + INLINE_SOURCE_MAP_MARKER.length, lineEnd < 0 ? undefined : lineEnd).trim();
    const separator = dataUrl.indexOf(DATA_URL_SEPARATOR);
    if (separator < 0) return undefined;
    const payload = dataUrl.slice(separator + DATA_URL_SEPARATOR.length);
    try {
        return dataUrl.slice(0, separator + DATA_URL_SEPARATOR.length).endsWith(BASE64_MARKER) ? decodedBase64(payload) : decodeURIComponent(payload);
    } catch {
        return undefined;
    }
}

export function parseStackFrame(line: string): StackFrameLocation | undefined {
    for (const pattern of FRAME_PATTERNS) {
        const match = pattern.exec(line);
        if (match !== null) return {prefix: match[1], url: match[2], line: Number(match[3]), column: Number(match[4]), suffix: match[5]};
    }
    return undefined;
}

export function stackFrameUrls(stack: string): Set<string> {
    const urls = new Set<string>();
    for (const line of stack.split(STACK_LINE_BREAK)) {
        const frame = parseStackFrame(line);
        if (frame !== undefined) urls.add(frame.url);
    }
    return urls;
}

function mappedLine(line: string, lookup: SourceMapLookup): StackLine {
    const frame = parseStackFrame(line);
    const original = frame === undefined ? undefined : lookup(frame.url)?.originalPosition(frame.line, frame.column);
    if (frame === undefined || original === undefined) return {text: line, bundleFrame: undefined};
    return {text: `${frame.prefix}${original.source}:${original.line}:${original.column}${frame.suffix}`, bundleFrame: line};
}

export function rewriteStack(stack: string, lookup: SourceMapLookup): StackLine[] {
    return stack.split(STACK_LINE_BREAK).map(line => mappedLine(line, lookup));
}
