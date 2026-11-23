import {mkdirSync, symlinkSync} from "fs";
import {dirname, join} from "path";
import {ENGINE_PACKAGES} from "./publicEntryPoints";

const NODE_MODULES_FOLDER = "node_modules";
const DIRECTORY_LINK_TYPE = "junction";
const PACKAGE_NAME_SEPARATOR = "/";

export function linkEnginePackages(projectFolder: string): void {
    for (const enginePackage of ENGINE_PACKAGES) {
        const link = join(projectFolder, NODE_MODULES_FOLDER, ...enginePackage.name.split(PACKAGE_NAME_SEPARATOR));
        mkdirSync(dirname(link), {recursive: true});
        symlinkSync(enginePackage.folder, link, DIRECTORY_LINK_TYPE);
    }
}
