export const EXIT_SUCCESS = 0;
export const EXIT_FAILURE = 1;
export const EXIT_USAGE = 2;

export class CliError extends Error {
    public constructor(message: string, public readonly details: readonly string[] = [], public readonly exitCode = EXIT_FAILURE) {
        super(message);
    }
}

export function usageError(message: string): CliError {
    return new CliError(message, [], EXIT_USAGE);
}

export type OptionSpec =
    | {readonly kind: "flag"}
    | {readonly kind: "value"; readonly values?: readonly string[]};

export type OptionSpecs = Readonly<Record<string, OptionSpec>>;

const OPTION_PREFIX = "--";
const VALUE_SEPARATOR = "=";

export class ParsedOptions {
    public constructor(private readonly values: ReadonlyMap<string, string>, private readonly flags: ReadonlySet<string>) {
    }

    public flag(name: string): boolean {
        return this.flags.has(name);
    }

    public value(name: string): string | undefined {
        return this.values.get(name);
    }

    public has(name: string): boolean {
        return this.flags.has(name) || this.values.has(name);
    }
}

export function parseOptions(command: string, args: readonly string[], specs: OptionSpecs): ParsedOptions {
    const values = new Map<string, string>();
    const flags = new Set<string>();
    for (let index = 0; index < args.length; index++) {
        const arg = args[index];
        if (!arg.startsWith(OPTION_PREFIX)) throw usageError(`jsengine ${command} takes no argument "${arg}"; options start with ${OPTION_PREFIX} (run jsengine help)`);
        const separator = arg.indexOf(VALUE_SEPARATOR);
        const name = arg.slice(OPTION_PREFIX.length, separator < 0 ? undefined : separator);
        const inlineValue = separator < 0 ? undefined : arg.slice(separator + 1);
        const spec = specs[name];
        if (spec === undefined) throw usageError(`jsengine ${command} has no option ${OPTION_PREFIX}${name} (run jsengine help)`);
        if (flags.has(name) || values.has(name)) throw usageError(`${OPTION_PREFIX}${name} is given twice; keep one`);
        if (spec.kind === "flag") {
            if (inlineValue !== undefined) throw usageError(`${OPTION_PREFIX}${name} takes no value; drop "${VALUE_SEPARATOR}${inlineValue}"`);
            flags.add(name);
            continue;
        }
        let value = inlineValue;
        if (value === undefined) {
            const next = args[index + 1];
            if (next === undefined || next.startsWith(OPTION_PREFIX)) throw usageError(`${OPTION_PREFIX}${name} needs a value, e.g. ${OPTION_PREFIX}${name} ${spec.values?.[0] ?? "<value>"}`);
            value = next;
            index++;
        }
        if (spec.values !== undefined && !spec.values.includes(value)) {
            throw usageError(`${OPTION_PREFIX}${name} must be one of ${spec.values.join(", ")}; got "${value}"`);
        }
        values.set(name, value);
    }
    return new ParsedOptions(values, flags);
}
