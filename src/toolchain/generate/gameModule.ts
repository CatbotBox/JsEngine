import type {ProjectResourceBinding} from "../../engine/project/projectManifest";
import {RENDER_BACKEND_KINDS} from "../../engine/rendering/renderBackend";
import type {RenderBackendKind} from "../../engine/rendering/renderBackend";
import {GENERATED_GAME_FILE, GENERATED_SCHEMAS_EXPORT, GENERATED_SCHEMAS_FILE, GENERATED_SYSTEMS_EXPORT, GENERATED_SYSTEMS_FILE, START_PROJECT_EXPORT} from "../projectLayout";
import {generatedFileHeader} from "./generatedHeader";
import type {GeneratorOutput, ProjectGenerator} from "./generatedHeader";
import {GENERATED_INDENT, generatedText, importLines} from "./generatedModule";
import type {ModuleImport} from "./generatedModule";
import type {ProjectSources} from "./projectSources";

export const GAME_GENERATOR_NAME = "game";
export const GAME_GENERATOR_VERSION = 1;
export const GAME_GENERATED_HEADER = generatedFileHeader(GAME_GENERATOR_NAME, GAME_GENERATOR_VERSION);

interface ModuleExport {
    readonly path: readonly string[];
    readonly name: string;
}

const BACKEND_SCHEMAS: Readonly<Record<RenderBackendKind, ModuleExport>> = {
    cells: {path: ["backends", "cells", "cellsComponentSchemas"], name: "registerCellsComponentSchemas"},
    pixels: {path: ["backends", "pixels", "pixelsComponentSchemas"], name: "registerPixelsComponentSchemas"},
    gpu: {path: ["backends", "gpu", "gpuComponentSchemas"], name: "registerGpuComponentSchemas"},
};
const RESOURCES_CONSTANT = "projectResources";
const START_SCENE_CONSTANT = "projectStartScene";
const BACKEND_SCHEMAS_CONSTANT = "projectBackendSchemas";
const NO_RESOURCES: readonly ProjectResourceBinding[] = [];

function resourceLines(resources: readonly ProjectResourceBinding[]): string[] {
    const declaration = `export const ${RESOURCES_CONSTANT}: readonly ProjectResourceBinding[] = [`;
    if (resources.length === 0) return [`${declaration}];`];
    return [
        declaration,
        ...resources.map(binding => `${GENERATED_INDENT}{type: ${JSON.stringify(binding.type)}, path: ${JSON.stringify(binding.path)}},`),
        "];",
    ];
}

function startSceneLine(startScene: string | undefined): string {
    return `export const ${START_SCENE_CONSTANT}: string | undefined = ${startScene === undefined ? "undefined" : JSON.stringify(startScene)};`;
}

function gameImports(sources: ProjectSources): ModuleImport[] {
    return [
        ...RENDER_BACKEND_KINDS.map(kind => ({names: [BACKEND_SCHEMAS[kind].name], module: sources.sourceModule(...BACKEND_SCHEMAS[kind].path)})),
        {names: ["World"], module: sources.engineModule("core"), typeOnly: true},
        {names: ["ProjectResourceBinding"], module: sources.engineModule("project", "projectManifest"), typeOnly: true},
        {names: ["SchemaRegistration"], module: sources.engineModule("project", "projectSchemas"), typeOnly: true},
        {names: ["startGame"], module: sources.engineModule("project", "startGame")},
        {names: ["ProjectHost", "StartedGame"], module: sources.engineModule("project", "startGame"), typeOnly: true},
        {names: [GENERATED_SCHEMAS_EXPORT], module: sources.projectModule(GENERATED_SCHEMAS_FILE)},
        {names: [GENERATED_SYSTEMS_EXPORT], module: sources.projectModule(GENERATED_SYSTEMS_FILE)},
    ];
}

function gameSource(sources: ProjectSources): string {
    const manifest = sources.manifest;
    const backendSchemas = RENDER_BACKEND_KINDS.map(kind => BACKEND_SCHEMAS[kind].name).join(", ");
    return generatedText([
        GAME_GENERATED_HEADER,
        ...importLines(sources, GENERATED_GAME_FILE, gameImports(sources)),
        "",
        `export const ${BACKEND_SCHEMAS_CONSTANT}: readonly SchemaRegistration[] = [${backendSchemas}];`,
        "",
        ...resourceLines(manifest?.resources ?? NO_RESOURCES),
        "",
        startSceneLine(manifest?.startScene),
        "",
        `export function ${START_PROJECT_EXPORT}(world: World, {backendSystems = [], ...host}: ProjectHost = {}): Promise<StartedGame> {`,
        `${GENERATED_INDENT}return startGame(world, {`,
        `${GENERATED_INDENT}${GENERATED_INDENT}...host,`,
        `${GENERATED_INDENT}${GENERATED_INDENT}schemas: ${GENERATED_SCHEMAS_EXPORT},`,
        `${GENERATED_INDENT}${GENERATED_INDENT}backendSchemas: ${BACKEND_SCHEMAS_CONSTANT},`,
        `${GENERATED_INDENT}${GENERATED_INDENT}systems: [...backendSystems, ...${GENERATED_SYSTEMS_EXPORT}],`,
        `${GENERATED_INDENT}${GENERATED_INDENT}resources: ${RESOURCES_CONSTANT},`,
        `${GENERATED_INDENT}${GENERATED_INDENT}startScene: ${START_SCENE_CONSTANT},`,
        `${GENERATED_INDENT}});`,
        "}",
    ]);
}

function gameOf(sources: ProjectSources): GeneratorOutput {
    return {sources: [{file: GENERATED_GAME_FILE, source: gameSource(sources)}], warnings: []};
}

export const GAME_GENERATOR: ProjectGenerator = {
    name: GAME_GENERATOR_NAME,
    version: GAME_GENERATOR_VERSION,
    files: [GENERATED_GAME_FILE],
    generate: gameOf,
};
