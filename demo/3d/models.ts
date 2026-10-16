import {existsSync, readdirSync} from "fs";
import {join} from "path";
import type {DemoModel} from "./game";

/** Where the terminal demo looks for models, relative to the working directory. */
export const MODEL_FOLDERS: readonly string[] = ["./demo/3d/", "./"];

/**
 * Every .obj directly inside a MODEL_FOLDERS folder under `root`, named by its file name up to the
 * first dot. Paths stay relative ("./demo/3d/cube.obj"). Node only: the browser gets the same list
 * from the manifest scripts/buildWeb.ts writes with this function.
 */
export function findDemoModels(root: string = "."): DemoModel[] {
    return MODEL_FOLDERS.filter(folder => existsSync(join(root, folder))).flatMap(folder =>
        readdirSync(join(root, folder)).filter(file => file.endsWith(".obj")).map(file => {
            const data = file.split(".");
            return {name: data[0], path: folder + data[0] + "." + data[1]};
        }));
}
