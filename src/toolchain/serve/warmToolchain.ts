import type {ProjectWorkerBuildReport} from "../../editor/desktop";
import type {BuildEditorOperation, GenerateOperation} from "../../editor/desktop/toolchainServerProtocol";
import type {GenerateProjectReport} from "../../editor/project/projectServerApi";
import {editorWorkerReport} from "../build/editorBuild";
import {generateReport} from "../commands/generate";
import type {GeneratedFiles} from "../generate/generatedFiles";
import {IncrementalGenerator} from "../generate/incrementalGenerator";
import {editorSimulationOf} from "../targets";
import type {ToolchainOperations} from "./toolchainServer";

export class WarmToolchain implements ToolchainOperations {
    private readonly generator = new IncrementalGenerator();

    public async buildEditor(operation: BuildEditorOperation): Promise<ProjectWorkerBuildReport> {
        return await editorWorkerReport(operation.project, editorSimulationOf(operation.simulate, operation.backend), folder => this.generateProject(folder));
    }

    public generate(operation: GenerateOperation): GenerateProjectReport {
        return generateReport(operation.project, folder => this.generateProject(folder));
    }

    private generateProject(folder: string): GeneratedFiles {
        return this.generator.writeGeneratedFiles([folder])[0];
    }
}
