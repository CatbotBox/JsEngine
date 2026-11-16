import {describeJson} from "./sceneDocument";

export function describeFieldValue(value: unknown): string {
    if (value instanceof Float32Array) return `Float32Array [${Array.from(value).join(", ")}]`;
    if (typeof value === "function") return "a function";
    if (typeof value === "object" && value !== null && !Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype) {
        return `a ${value.constructor.name}`;
    }
    return describeJson(value);
}

export function fieldValueError(path: string, expectation: string, actual: unknown): Error {
    return new Error(`Scene field ${path}: expected ${expectation}, got ${describeFieldValue(actual)}`);
}
