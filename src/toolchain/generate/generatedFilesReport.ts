import {displayPath} from "../project";
import {describeGeneratedFileState} from "./generatedFiles";
import type {GeneratedFiles} from "./generatedFiles";

export type GeneratedFilesReportMode = "generate" | "check" | "regenerate";

export function reportGeneratedFiles(generated: GeneratedFiles, mode: GeneratedFilesReportMode): string[] {
    for (const warning of generated.warnings) console.warn(`warning: ${warning}`);
    const problems: string[] = [];
    for (const file of generated.files) {
        const path = displayPath(file.path);
        if (file.state === "upToDate") {
            if (mode !== "regenerate") console.log(`${path} is up to date`);
        } else if (mode === "check") {
            problems.push(`${path} ${describeGeneratedFileState(file)}`);
        } else {
            console.log(`wrote ${path}`);
        }
    }
    return problems;
}
