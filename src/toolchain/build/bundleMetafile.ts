import {resolve} from "path";
import type {BuildConfig, BuildOutput} from "bun";
import {CliError} from "../cliArguments";

interface MetafileImport {
    readonly path: string;
}

interface MetafileInput {
    readonly imports?: readonly MetafileImport[];
}

interface MetafileOutputInput {
    readonly bytesInOutput: number;
}

interface MetafileOutput {
    readonly inputs: Readonly<Record<string, MetafileOutputInput>>;
}

export interface BundleMetafile {
    readonly inputs: Readonly<Record<string, MetafileInput>>;
    readonly outputs: Readonly<Record<string, MetafileOutput>>;
}

export type MetafileBuildConfig = BuildConfig & {readonly metafile: boolean};
export type MetafileBuildOutput = BuildOutput & {readonly metafile?: BundleMetafile};

export interface BundleInputs {
    readonly entry: string;
    readonly modules: readonly string[];
    readonly imports: ReadonlyMap<string, readonly string[]>;
}

export function requireMetafile(result: MetafileBuildOutput, bundle: string): BundleMetafile {
    if (result.metafile === undefined) throw new CliError(`bundling ${bundle} produced no metafile; this bun does not support Bun.build({metafile: true})`);
    return result.metafile;
}

function contributingModules(metafile: BundleMetafile): string[] {
    const modules = new Set<string>();
    for (const output of Object.values(metafile.outputs)) {
        for (const [path, input] of Object.entries(output.inputs)) {
            if (input.bytesInOutput > 0) modules.add(resolve(path));
        }
    }
    return [...modules];
}

function importGraph(metafile: BundleMetafile): Map<string, string[]> {
    return new Map(Object.entries(metafile.inputs).map(([path, input]) => [resolve(path), (input.imports ?? []).map(imported => resolve(imported.path))]));
}

export function bundleInputsOf(entry: string, metafile: BundleMetafile): BundleInputs {
    return {entry: resolve(entry), modules: contributingModules(metafile), imports: importGraph(metafile)};
}
