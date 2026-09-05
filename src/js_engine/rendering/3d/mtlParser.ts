import {Material, packRgb} from "./material";

export type MaterialLibrary = Map<string, Material>;

export function parseMtl(text: string, baseDirectory: string = ""): MaterialLibrary {
    const library: MaterialLibrary = new Map();
    let current: Material | undefined;

    for (const rawLine of text.split(/\r?\n/)) {
        const line = rawLine.trim();
        if (line.length === 0 || line[0] === '#') continue;
        const separator = line.search(/\s/);
        const keyword = separator < 0 ? line : line.substring(0, separator);
        const argument = separator < 0 ? "" : line.substring(separator + 1).trim();

        if (keyword === "newmtl") {
            current = new Material(argument);
            library.set(argument, current);
        } else if (current === undefined) {
            continue;
        } else if (keyword === "Kd") {
            const [r, g, b] = argument.split(/\s+/).map(Number.parseFloat);
            if (Number.isFinite(r) && Number.isFinite(g) && Number.isFinite(b)) current.diffuseColor = packRgb(r, g, b);
        } else if (keyword === "map_Kd") {
            current.diffuseTexturePath = resolveTexturePath(argument, baseDirectory);
        }
    }
    return library;
}

const textureMapOptionArgumentCounts: Record<string, number> = {
    "-blendu": 1, "-blendv": 1, "-cc": 1, "-clamp": 1, "-mm": 2, "-o": 3, "-s": 3, "-t": 3,
    "-texres": 1, "-bm": 1, "-imfchan": 1, "-boost": 1,
};

function resolveTexturePath(argument: string, baseDirectory: string): string {
    const fileName = stripTextureMapOptions(argument).replace(/\\+/g, "/");
    if (baseDirectory.length === 0 || /^([a-zA-Z]:)?\//.test(fileName)) return fileName;
    const path = require("path") as typeof import("path");
    return path.join(baseDirectory, fileName);
}

function stripTextureMapOptions(argument: string): string {
    const tokenPattern = /\S+/g;
    let fileNameStart = 0;
    let pendingArguments = 0;
    for (let match = tokenPattern.exec(argument); match !== null; match = tokenPattern.exec(argument)) {
        const token = match[0];
        if (pendingArguments > 0) {
            pendingArguments--;
        } else if (token in textureMapOptionArgumentCounts) {
            pendingArguments = textureMapOptionArgumentCounts[token];
        } else {
            return argument.substring(match.index);
        }
        fileNameStart = match.index + token.length;
    }
    return argument.substring(fileNameStart).trim();
}
