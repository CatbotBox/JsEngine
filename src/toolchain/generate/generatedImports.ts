import {compareText} from "./projectSources";
import type {ExportReference} from "./projectSources";

const LOCAL_NAME_SEPARATOR = "_";
const FIRST_DUPLICATE_SUFFIX = 2;

function referenceKey(reference: ExportReference): string {
    return `${reference.fileName}\0${reference.exportName}`;
}

export class ImportTable {
    private readonly localNames = new Map<string, string>();
    private readonly usedLocalNames: Set<string>;
    private readonly references: ExportReference[] = [];

    public constructor(private readonly specifierOf: (reference: ExportReference) => string, reservedLocalNames: Iterable<string>) {
        this.usedLocalNames = new Set(reservedLocalNames);
    }

    public add(reference: ExportReference): void {
        const key = referenceKey(reference);
        if (this.localNames.has(key)) return;
        let localName = reference.exportName;
        for (let suffix = FIRST_DUPLICATE_SUFFIX; this.usedLocalNames.has(localName); suffix++) localName = `${reference.exportName}${LOCAL_NAME_SEPARATOR}${suffix}`;
        this.usedLocalNames.add(localName);
        this.localNames.set(key, localName);
        this.references.push(reference);
    }

    public localName(reference: ExportReference): string {
        const localName = this.localNames.get(referenceKey(reference));
        if (localName === undefined) throw new Error(`No import registered for ${reference.exportName} from ${reference.fileName}`);
        return localName;
    }

    public importLines(): string[] {
        const bySpecifier = new Map<string, string[]>();
        for (const reference of this.references) {
            const specifier = this.specifierOf(reference);
            const localName = this.localName(reference);
            const binding = localName === reference.exportName ? localName : `${reference.exportName} as ${localName}`;
            bySpecifier.set(specifier, [...(bySpecifier.get(specifier) ?? []), binding]);
        }
        return [...bySpecifier.keys()].sort(compareText)
            .map(specifier => `import {${bySpecifier.get(specifier)!.sort(compareText).join(", ")}} from ${JSON.stringify(specifier)};`);
    }
}
