import {join, resolve} from "path";
import {CliError} from "../cliArguments";
import {writeGeneratedFiles} from "../generate/generatedFiles";
import {reportGeneratedFiles} from "../generate/generatedFilesReport";
import {displayPath} from "../project";
import {TERMINAL_MAIN_FILE} from "../projectLayout";
import {featureDefines} from "../targets";
import type {RunTarget} from "../targets";
import {bundleInputsOf, requireMetafile} from "./bundleMetafile";
import type {MetafileBuildConfig, MetafileBuildOutput} from "./bundleMetafile";
import {ENGINE_IMPORTS} from "./editorBuild";
import {checkBundleFeatures, targetFeatureReport} from "./featureDetection";
import type {TargetFeatureReport} from "./featureDetection";

const TERMINAL_TARGET: RunTarget = "terminal";

export async function checkTerminalBuild(projectFolder: string): Promise<TargetFeatureReport> {
    const folder = resolve(projectFolder);
    reportGeneratedFiles(writeGeneratedFiles(folder), "regenerate");
    const entry = join(folder, TERMINAL_MAIN_FILE);
    const bundle = `${displayPath(folder)} ${TERMINAL_TARGET}`;
    const config: MetafileBuildConfig = {
        entrypoints: [entry],
        target: "bun",
        minify: true,
        metafile: true,
        throw: false,
        define: featureDefines(TERMINAL_TARGET),
        plugins: [ENGINE_IMPORTS],
    };
    const result: MetafileBuildOutput = await Bun.build(config);
    if (!result.success) throw new CliError(`bundling ${displayPath(entry)} for the ${TERMINAL_TARGET} failed:`, result.logs.map(String));
    const inputs = bundleInputsOf(entry, requireMetafile(result, bundle));
    return targetFeatureReport(TERMINAL_TARGET, checkBundleFeatures([{...inputs, name: bundle, target: TERMINAL_TARGET}]));
}
