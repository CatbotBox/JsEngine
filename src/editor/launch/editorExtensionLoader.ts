import {registerEditorExtensionsOf} from "../page/editorExtensionSession";
import type {EditorExtensionSession} from "../page/editorExtensionSession";
import {fieldDrawers} from "../page/fieldDrawers";
import type {FieldDrawerRegistry} from "../page/fieldDrawers";

export type ModuleImporter = (url: string) => Promise<unknown>;

export interface EditorExtensionLoaderOptions {
    readonly reportError: (text: string) => void;
    readonly importModule?: ModuleImporter;
    readonly drawers?: FieldDrawerRegistry;
}

function describeError(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

function importFromUrl(url: string): Promise<unknown> {
    return import(url);
}

export class EditorExtensionLoader {
    private session: EditorExtensionSession | undefined;
    private loading: Promise<void> = Promise.resolve();

    public constructor(private readonly options: EditorExtensionLoaderOptions) {
    }

    public load(url: string | undefined): Promise<void> {
        this.loading = this.loading.then(() => this.replace(url));
        return this.loading;
    }

    private async replace(url: string | undefined): Promise<void> {
        this.session?.dispose();
        this.session = undefined;
        if (url === undefined) return;
        try {
            const module = await (this.options.importModule ?? importFromUrl)(url);
            this.session = await registerEditorExtensionsOf(module, this.options.drawers ?? fieldDrawers);
        } catch (error) {
            this.options.reportError(`The editor extensions did not load: ${describeError(error)}`);
        }
    }
}
