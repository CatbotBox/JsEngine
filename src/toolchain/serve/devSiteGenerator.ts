import {reportGeneratedFiles} from "../generate/generatedFilesReport";
import {IncrementalGenerator} from "../generate/incrementalGenerator";
import {siteProjectFolders} from "../projectSites";

export class DevSiteGenerator {
    private readonly generator = new IncrementalGenerator();
    private readonly folders: readonly string[];

    public constructor(project: string | undefined) {
        this.folders = siteProjectFolders(project);
    }

    public regenerate(reportFiles: boolean): boolean {
        try {
            const generated = this.generator.writeGeneratedFiles(this.folders);
            if (reportFiles) for (const files of generated) reportGeneratedFiles(files, "regenerate");
            return true;
        } catch (error) {
            console.warn(`regenerating in the dev server failed, so the build regenerates instead: ${error instanceof Error ? error.message : String(error)}`);
            return false;
        }
    }
}
