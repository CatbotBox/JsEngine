export type SettingValue = number | undefined;

const PATH_SEPARATOR = ".";
const DECIMAL_BASE = 10;

type FieldHolder = Record<string, unknown>;

interface ResolvedField {
    readonly holder: FieldHolder;
    readonly key: string;
}

function isFieldHolder(value: unknown): value is FieldHolder {
    return typeof value === "object" && value !== null;
}

function isSettingValue(value: unknown): value is SettingValue | null {
    return value === undefined || value === null || typeof value === "number";
}

function resolveField(root: object, path: string, rootName: string): ResolvedField {
    const keys = path.split(PATH_SEPARATOR);
    const key = keys.pop()!;
    let holder: unknown = root;
    for (const step of keys) holder = isFieldHolder(holder) ? holder[step] : undefined;
    if (!isFieldHolder(holder) || !(key in holder) || !isSettingValue(holder[key])) {
        throw new Error(`"${path}" names no number field of ${rootName}`);
    }
    return {holder, key};
}

export function readSetting(root: object, path: string, rootName: string): SettingValue {
    const {holder, key} = resolveField(root, path, rootName);
    const value = holder[key];
    return typeof value === "number" ? value : undefined;
}

export function writeSetting(root: object, path: string, rootName: string, value: SettingValue): void {
    const {holder, key} = resolveField(root, path, rootName);
    holder[key] = value;
}

export function roundToDecimals(value: number, decimals: number): number {
    const scale = DECIMAL_BASE ** decimals;
    return Math.round(value * scale) / scale;
}

export function steppedSetting(value: number, step: number, min: number, max: number, decimals: number): number {
    return Math.min(max, Math.max(min, roundToDecimals(value + step, decimals)));
}
