import type {DemoModel} from "./game";

export const DEFAULT_LAZY_MODEL_BYTES = 16 * 1024 * 1024;

const MODEL_EXTENSION = ".obj";
const PATH_SEPARATOR = "/";
const NAME_SEPARATOR = ".";

export function demoModelsAmong(paths: readonly string[]): DemoModel[] {
    return [...paths].sort().filter(path => path.toLowerCase().endsWith(MODEL_EXTENSION)).map(path => {
        const file = path.slice(path.lastIndexOf(PATH_SEPARATOR) + 1);
        return {name: file.split(NAME_SEPARATOR)[0], path};
    });
}
