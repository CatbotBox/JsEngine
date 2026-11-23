import {existsSync, mkdirSync, readFileSync, writeFileSync} from "fs";
import {dirname, join} from "path";
import {REPO_ROOT} from "../repoPaths";
import {generatedFileStamp} from "./generatedHeader";
import type {GeneratedSource, ProjectGenerator} from "./generatedHeader";
import {ONE_SHOT_PROGRAM_HOST, ProjectSources} from "./projectSources";
import type {ProjectProgramHost} from "./projectSources";
import {GAME_GENERATOR} from "./gameModule";
import {MAINS_GENERATOR} from "./mains";
import {SCHEMAS_GENERATOR} from "./schemas";
import {SYSTEMS_GENERATOR} from "./systems";

export const PROJECT_GENERATORS: readonly ProjectGenerator[] = [SCHEMAS_GENERATOR, SYSTEMS_GENERATOR, GAME_GENERATOR, MAINS_GENERATOR];
export const PROJECT_GENERATED_FILES: readonly string[] = PROJECT_GENERATORS.flatMap(generator => generator.files);

export type GeneratedFileState = "upToDate" | "missing" | "stale" | "otherVersion";

export interface GeneratedFile {
    readonly generator: ProjectGenerator;
    readonly path: string;
    readonly source: string;
    readonly state: GeneratedFileState;
    readonly writtenByVersion?: number;
}

export interface GeneratedFiles {
    readonly files: readonly GeneratedFile[];
    readonly warnings: readonly string[];
}

function stateOf(generator: ProjectGenerator, existing: string | undefined, source: string): Pick<GeneratedFile, "state" | "writtenByVersion"> {
    if (existing === undefined) return {state: "missing"};
    if (existing === source) return {state: "upToDate"};
    const stamp = generatedFileStamp(existing);
    const isOtherVersion = stamp !== undefined && stamp.generator === generator.name && stamp.version !== generator.version;
    return isOtherVersion ? {state: "otherVersion", writtenByVersion: stamp.version} : {state: "stale"};
}

function checkGeneratedSource(projectFolder: string, generator: ProjectGenerator, generated: GeneratedSource): GeneratedFile {
    const path = join(projectFolder, generated.file);
    const existing = existsSync(path) ? readFileSync(path, "utf8") : undefined;
    return {generator, path, source: generated.source, ...stateOf(generator, existing, generated.source)};
}

export function checkGeneratedFiles(projectFolder: string, programHost: ProjectProgramHost = ONE_SHOT_PROGRAM_HOST): GeneratedFiles {
    const sources = ProjectSources.read(projectFolder, REPO_ROOT, programHost);
    const files: GeneratedFile[] = [];
    const warnings: string[] = [];
    for (const generator of PROJECT_GENERATORS) {
        const output = generator.generate(sources);
        warnings.push(...output.warnings);
        for (const generated of output.sources) files.push(checkGeneratedSource(sources.folder, generator, generated));
    }
    return {files, warnings};
}

export function writeGeneratedFiles(projectFolder: string, programHost: ProjectProgramHost = ONE_SHOT_PROGRAM_HOST): GeneratedFiles {
    const generated = checkGeneratedFiles(projectFolder, programHost);
    for (const file of generated.files.filter(each => each.state !== "upToDate")) {
        mkdirSync(dirname(file.path), {recursive: true});
        writeFileSync(file.path, file.source);
    }
    return generated;
}

export function describeGeneratedFileState(file: GeneratedFile): string {
    switch (file.state) {
        case "upToDate":
            return "is up to date";
        case "missing":
            return "is missing";
        case "stale":
            return "is stale";
        case "otherVersion":
            return `was written by ${file.generator.name} v${file.writtenByVersion}, this jsengine has v${file.generator.version}`;
    }
}
