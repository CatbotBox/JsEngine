import {existsSync, readdirSync} from "fs";
import {join} from "path";
import type {DemoModel} from "./game";

export const MODEL_FOLDERS: readonly string[] = ["./demo/3d/", "./"];

export function findDemoModels(root: string = "."): DemoModel[] {
    return MODEL_FOLDERS.filter(folder => existsSync(join(root, folder))).flatMap(folder =>
        readdirSync(join(root, folder)).filter(file => file.endsWith(".obj")).map(file => {
            const data = file.split(".");
            return {name: data[0], path: folder + data[0] + "." + data[1]};
        }));
}
