export type OutlineKind = "component" | "system" | "systemGroup" | "resource" | "class" | "function" | "constant";

export interface OutlineSymbol {
    readonly kind: OutlineKind;
    readonly name: string;
    readonly line: number;
    readonly typeName?: string;
}

export interface OutlineGroup {
    readonly kind: OutlineKind;
    readonly title: string;
    readonly symbols: readonly OutlineSymbol[];
}

type EcsKind = "component" | "system" | "systemGroup" | "resource";

interface ClassDeclaration {
    readonly name: string;
    readonly baseName: string | undefined;
    readonly exported: boolean;
    readonly index: number;
}

interface SchemaCall {
    readonly kind: "component" | "resource";
    readonly constructorName: string;
    readonly typeName: string;
    readonly index: number;
}

export const OUTLINE_GROUP_TITLES: Readonly<Record<OutlineKind, string>> = {
    component: "Components",
    system: "Systems",
    systemGroup: "System groups",
    resource: "Resources",
    class: "Other classes",
    function: "Functions",
    constant: "Constants",
};

const OUTLINE_GROUP_ORDER: readonly OutlineKind[] = ["component", "system", "systemGroup", "resource", "class", "function", "constant"];
const ECS_KIND_BY_BASE: ReadonlyMap<string, EcsKind> = new Map<string, EcsKind>([
    ["Component", "component"],
    ["System", "system"],
    ["SystemGroup", "systemGroup"],
    ["PresentationSystemGroup", "systemGroup"],
    ["Resource", "resource"],
]);
const SCHEMA_KIND_BY_FUNCTION: ReadonlyMap<string, "component" | "resource"> = new Map([
    ["componentSchema", "component"],
    ["resourceSchema", "resource"],
]);

const QUALIFIED_IDENTIFIER = /^[A-Za-z_$][\w$]*(?:\s*\.\s*[A-Za-z_$][\w$]*)*/;
const WHITESPACE = /\s/;
const LEADING_WHITESPACE = /^\s*/;
const CLASS_DECLARATION = /(\bexport\s+(?:default\s+)?)?(?:\b(?:abstract|declare)\s+)*\bclass\s+([A-Za-z_$][\w$]*)/g;
const EXPORTED_FUNCTION = /\bexport\s+(?:default\s+)?(?:async\s+)?function\b\s*\*?\s*([A-Za-z_$][\w$]*)/g;
const EXPORTED_VARIABLE = /\bexport\s+(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g;
const SCHEMA_CALL = /\b(componentSchema|resourceSchema)\s*\(\s*([A-Za-z_$][\w$.]*)\s*,\s*(["'`])/g;
const TYPE_ANNOTATION_THEN_ASSIGNMENT = /^\s*(?::[^=;]*)?=(?![=>])/;
const FUNCTION_INITIALIZER = /^\s*(?:async\b\s*)?(?:function\b|[A-Za-z_$][\w$]*\s*=>)/;
const ARROW_AFTER_PARAMETERS = /^\s*(?::[^=;{]*)?=>/;
const ASYNC_PREFIX = /^\s*async\b\s*/;
const EXTENDS_KEYWORD = /^extends\b/;
const RESERVED_CLASS_NAMES: ReadonlySet<string> = new Set(["extends", "implements"]);
const RESERVED_VARIABLE_NAMES: ReadonlySet<string> = new Set(["enum"]);
const REGEX_PRECEDING_CHARACTERS = "(,=:[!&|?{};+-*%<>~^";
const REGEX_PRECEDING_KEYWORDS: ReadonlySet<string> = new Set(["return", "typeof", "case", "do", "else", "in", "of", "new", "delete", "void", "throw", "yield", "await", "instanceof"]);
const BLANK = " ";
const LINE_FEED = "\n";
const CARRIAGE_RETURN = "\r";
const BACKSLASH = "\\";
const BACKTICK = "`";
const SLASH = "/";
const OPEN_BRACE = "{";
const CLOSE_BRACE = "}";
const OPEN_BRACKET = "[";
const CLOSE_BRACKET = "]";
const INTERPOLATION_START = "${";
const FIRST_LINE = 1;

class Masker {
    private readonly characters: string[];
    private readonly interpolationDepths: number[] = [];
    private braceDepth = 0;
    private previousSignificant = -1;

    public constructor(private readonly source: string) {
        this.characters = source.split("");
    }

    public mask(): string {
        let index = 0;
        while (index < this.source.length) index = this.step(index);
        return this.characters.join("");
    }

    private step(index: number): number {
        const source = this.source;
        const character = source[index];
        const next = source[index + 1];
        if (character === SLASH && next === SLASH) return this.blankUntil(index, this.lineEnd(index));
        if (character === SLASH && next === "*") {
            const close = source.indexOf("*/", index + 2);
            return this.blankUntil(index, close < 0 ? source.length : close + 2);
        }
        if (character === "\"" || character === "'") return this.quoted(index, character);
        if (character === BACKTICK) return this.template(index + 1);
        if (character === SLASH && this.regexMayStart()) return this.regex(index);
        if (character === OPEN_BRACE) this.braceDepth++;
        if (character === CLOSE_BRACE) {
            const depths = this.interpolationDepths;
            if (depths.length > 0 && depths[depths.length - 1] === this.braceDepth) {
                depths.pop();
                return this.template(index + 1);
            }
            this.braceDepth--;
        }
        if (!WHITESPACE.test(character)) this.previousSignificant = index;
        return index + 1;
    }

    private lineEnd(index: number): number {
        const end = this.source.indexOf(LINE_FEED, index);
        return end < 0 ? this.source.length : end;
    }

    private blankUntil(start: number, end: number): number {
        for (let index = start; index < end; index++) {
            const character = this.characters[index];
            if (character !== LINE_FEED && character !== CARRIAGE_RETURN) this.characters[index] = BLANK;
        }
        return end;
    }

    private quoted(start: number, quote: string): number {
        const source = this.source;
        let index = start + 1;
        while (index < source.length && source[index] !== quote && source[index] !== LINE_FEED) index += source[index] === BACKSLASH ? 2 : 1;
        const end = Math.min(index, source.length);
        this.blankUntil(start + 1, end);
        this.previousSignificant = start;
        return source[end] === quote ? end + 1 : end;
    }

    private template(start: number): number {
        const source = this.source;
        let index = start;
        while (index < source.length) {
            if (source[index] === BACKSLASH) {
                index += 2;
                continue;
            }
            if (source[index] === BACKTICK) {
                this.blankUntil(start, index);
                this.previousSignificant = index;
                return index + 1;
            }
            if (source.startsWith(INTERPOLATION_START, index)) {
                this.blankUntil(start, index);
                this.interpolationDepths.push(this.braceDepth);
                this.previousSignificant = index + 1;
                return index + INTERPOLATION_START.length;
            }
            index++;
        }
        return this.blankUntil(start, source.length);
    }

    private regexMayStart(): boolean {
        if (this.previousSignificant < 0) return true;
        const previous = this.source[this.previousSignificant];
        if (REGEX_PRECEDING_CHARACTERS.includes(previous)) return true;
        let wordStart = this.previousSignificant;
        while (wordStart > 0 && /[\w$]/.test(this.source[wordStart - 1])) wordStart--;
        return REGEX_PRECEDING_KEYWORDS.has(this.source.slice(wordStart, this.previousSignificant + 1));
    }

    private regex(start: number): number {
        const source = this.source;
        let index = start + 1;
        let inClass = false;
        while (index < source.length) {
            const character = source[index];
            if (character === LINE_FEED) {
                this.previousSignificant = start;
                return start + 1;
            }
            if (character === BACKSLASH) {
                index += 2;
                continue;
            }
            if (character === OPEN_BRACKET) inClass = true;
            else if (character === CLOSE_BRACKET) inClass = false;
            else if (character === SLASH && !inClass) break;
            index++;
        }
        this.blankUntil(start + 1, index);
        this.previousSignificant = index;
        return index + 1;
    }
}

export function maskCommentsAndStrings(source: string): string {
    return new Masker(source).mask();
}

function lineStarts(source: string): number[] {
    const starts = [0];
    for (let index = source.indexOf(LINE_FEED); index >= 0; index = source.indexOf(LINE_FEED, index + 1)) starts.push(index + 1);
    return starts;
}

function lineAt(starts: readonly number[], index: number): number {
    let low = 0;
    let high = starts.length - 1;
    while (low < high) {
        const middle = (low + high + 1) >> 1;
        if (starts[middle] <= index) low = middle;
        else high = middle - 1;
    }
    return low + FIRST_LINE;
}

function skipWhitespace(text: string, index: number): number {
    return index + (LEADING_WHITESPACE.exec(text.slice(index))?.[0].length ?? 0);
}

function skipBalanced(text: string, index: number, open: string, close: string): number {
    if (text[index] !== open) return index;
    let depth = 0;
    for (let position = index; position < text.length; position++) {
        if (text[position] === open) depth++;
        else if (text[position] === close && --depth === 0) return position + 1;
    }
    return text.length;
}

function lastSegment(qualified: string): string {
    const parts = qualified.split(".");
    return parts[parts.length - 1].trim();
}

function classDeclarations(masked: string): ClassDeclaration[] {
    const found: ClassDeclaration[] = [];
    for (const match of masked.matchAll(CLASS_DECLARATION)) {
        const name = match[2];
        if (RESERVED_CLASS_NAMES.has(name)) continue;
        let index = skipWhitespace(masked, match.index + match[0].length);
        index = skipWhitespace(masked, skipBalanced(masked, index, "<", ">"));
        let baseName: string | undefined;
        if (EXTENDS_KEYWORD.test(masked.slice(index))) {
            const base = QUALIFIED_IDENTIFIER.exec(masked.slice(skipWhitespace(masked, index + "extends".length)));
            if (base !== null) baseName = lastSegment(base[0]);
        }
        found.push({name, baseName, exported: match[1] !== undefined, index: match.index});
    }
    return found;
}

function schemaCalls(source: string, masked: string): SchemaCall[] {
    const calls: SchemaCall[] = [];
    for (const match of masked.matchAll(SCHEMA_CALL)) {
        const kind = SCHEMA_KIND_BY_FUNCTION.get(match[1]);
        const quote = match[3];
        const nameStart = match.index + match[0].length;
        const nameEnd = masked.indexOf(quote, nameStart);
        if (kind === undefined || nameEnd < 0) continue;
        const typeName = source.slice(nameStart, nameEnd);
        if (typeName.length === 0 || typeName.includes(LINE_FEED)) continue;
        calls.push({kind, constructorName: lastSegment(match[2]), typeName, index: match.index});
    }
    return calls;
}

function ecsKindsOf(classes: readonly ClassDeclaration[]): Map<string, EcsKind> {
    const kinds = new Map<string, EcsKind>();
    const baseByName = new Map(classes.map(declaration => [declaration.name, declaration.baseName]));
    const resolve = (name: string, visiting: Set<string>): EcsKind | undefined => {
        const known = kinds.get(name);
        if (known !== undefined || visiting.has(name)) return known;
        const base = baseByName.get(name);
        if (base === undefined) return undefined;
        visiting.add(name);
        const kind = baseByName.has(base) ? resolve(base, visiting) ?? ECS_KIND_BY_BASE.get(base) : ECS_KIND_BY_BASE.get(base);
        if (kind !== undefined) kinds.set(name, kind);
        return kind;
    };
    for (const declaration of classes) resolve(declaration.name, new Set());
    return kinds;
}

function isFunctionInitializer(masked: string, afterName: number): boolean {
    const assignment = TYPE_ANNOTATION_THEN_ASSIGNMENT.exec(masked.slice(afterName));
    if (assignment === null) return false;
    const initializerStart = afterName + assignment[0].length;
    const initializer = masked.slice(initializerStart);
    if (FUNCTION_INITIALIZER.test(initializer)) return true;
    const parametersStart = skipWhitespace(masked, initializerStart + (ASYNC_PREFIX.exec(initializer)?.[0].length ?? 0));
    const afterTypeParameters = skipWhitespace(masked, skipBalanced(masked, parametersStart, "<", ">"));
    if (masked[afterTypeParameters] !== "(") return false;
    return ARROW_AFTER_PARAMETERS.test(masked.slice(skipBalanced(masked, afterTypeParameters, "(", ")")));
}

export function outlineCode(source: string): OutlineSymbol[] {
    const masked = maskCommentsAndStrings(source);
    const starts = lineStarts(source);
    const classes = classDeclarations(masked);
    const calls = schemaCalls(source, masked);
    const ecsKinds = ecsKindsOf(classes);
    const callByConstructor = new Map<string, SchemaCall>();
    for (const call of calls) if (!callByConstructor.has(call.constructorName)) callByConstructor.set(call.constructorName, call);
    const symbols: OutlineSymbol[] = [];
    const classNames = new Set<string>();
    for (const declaration of classes) {
        classNames.add(declaration.name);
        const call = callByConstructor.get(declaration.name);
        const kind: OutlineKind | undefined = ecsKinds.get(declaration.name) ?? call?.kind ?? (declaration.exported ? "class" : undefined);
        if (kind === undefined) continue;
        const line = lineAt(starts, declaration.index);
        const schemaNamed = kind === "component" || kind === "resource";
        symbols.push(schemaNamed ? {kind, name: declaration.name, line, typeName: call?.typeName ?? declaration.name} : {kind, name: declaration.name, line});
    }
    for (const call of calls) {
        if (classNames.has(call.constructorName) || callByConstructor.get(call.constructorName) !== call) continue;
        symbols.push({kind: call.kind, name: call.constructorName, line: lineAt(starts, call.index), typeName: call.typeName});
    }
    for (const match of masked.matchAll(EXPORTED_FUNCTION)) symbols.push({kind: "function", name: match[1], line: lineAt(starts, match.index)});
    for (const match of masked.matchAll(EXPORTED_VARIABLE)) {
        if (RESERVED_VARIABLE_NAMES.has(match[1])) continue;
        const kind = isFunctionInitializer(masked, match.index + match[0].length) ? "function" : "constant";
        symbols.push({kind, name: match[1], line: lineAt(starts, match.index)});
    }
    return symbols.sort((a, b) => a.line - b.line);
}

export function groupOutline(symbols: readonly OutlineSymbol[]): OutlineGroup[] {
    return OUTLINE_GROUP_ORDER
        .map(kind => ({kind, title: OUTLINE_GROUP_TITLES[kind], symbols: symbols.filter(symbol => symbol.kind === kind)}))
        .filter(group => group.symbols.length > 0);
}
