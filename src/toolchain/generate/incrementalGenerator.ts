import {resolve} from "path";
import {checkGeneratedFiles, writeGeneratedFiles} from "./generatedFiles";
import type {GeneratedFiles} from "./generatedFiles";
import {FileSystemProbes, IncrementalProjectProgram, SourceFileCache} from "./incrementalProgram";
import type {ProjectProgramHost} from "./projectSources";

export interface GenerationRound {
    readonly parsedFiles: number;
    readonly reusedPrograms: number;
    readonly extractedFiles: readonly string[];
}

type ProjectGeneration = (projectFolder: string, programHost: ProjectProgramHost) => GeneratedFiles;

const NO_ROUND: GenerationRound = {parsedFiles: 0, reusedPrograms: 0, extractedFiles: []};

export class IncrementalGenerator {
    private readonly sourceFiles = new SourceFileCache();
    private readonly probes = new FileSystemProbes();
    private readonly projects = new Map<string, IncrementalProjectProgram>();
    private round = NO_ROUND;

    public get lastRound(): GenerationRound {
        return this.round;
    }

    public checkGeneratedFiles(projectFolders: readonly string[]): GeneratedFiles[] {
        return this.generateRound(projectFolders, checkGeneratedFiles);
    }

    public writeGeneratedFiles(projectFolders: readonly string[]): GeneratedFiles[] {
        return this.generateRound(projectFolders, writeGeneratedFiles);
    }

    private generateRound(projectFolders: readonly string[], generate: ProjectGeneration): GeneratedFiles[] {
        this.sourceFiles.beginRound();
        this.probes.revalidate();
        const programs = projectFolders.map(folder => this.programOf(folder));
        const generated = projectFolders.map((folder, index) => generate(folder, programs[index]));
        this.round = {
            parsedFiles: this.sourceFiles.parsedFiles,
            reusedPrograms: programs.filter(program => program.reusedPreviousProgram).length,
            extractedFiles: programs.flatMap(program => program.extractedFiles),
        };
        return generated;
    }

    private programOf(projectFolder: string): IncrementalProjectProgram {
        const folder = resolve(projectFolder);
        const known = this.projects.get(folder);
        if (known !== undefined) return known;
        const program = new IncrementalProjectProgram(this.sourceFiles, this.probes);
        this.projects.set(folder, program);
        return program;
    }
}
