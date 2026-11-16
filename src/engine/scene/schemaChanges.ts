export interface SchemaChange {
    readonly typeName: string;
    readonly addedKeys: readonly string[];
    readonly removedKeys: readonly string[];
}

export type SchemaChangePolicy = "strict" | "report";

export const DEFAULT_SCHEMA_CHANGE_POLICY: SchemaChangePolicy = "strict";

const KEY_SEPARATOR = ", ";
const PART_SEPARATOR = "; ";

export class SchemaChangeCollector {
    private readonly changes = new Map<string, {readonly added: Set<string>, readonly removed: Set<string>}>();

    public add(typeName: string, addedKeys: readonly string[], removedKeys: readonly string[]): void {
        if (addedKeys.length === 0 && removedKeys.length === 0) return;
        let change = this.changes.get(typeName);
        if (change === undefined) this.changes.set(typeName, change = {added: new Set(), removed: new Set()});
        for (const key of addedKeys) change.added.add(key);
        for (const key of removedKeys) change.removed.add(key);
    }

    public list(): SchemaChange[] {
        return [...this.changes.keys()].sort().map(typeName => {
            const change = this.changes.get(typeName)!;
            return {typeName, addedKeys: [...change.added].sort(), removedKeys: [...change.removed].sort()};
        });
    }
}

export function describeSchemaChange(change: SchemaChange): string {
    const parts: string[] = [];
    if (change.addedKeys.length > 0) parts.push(`new fields ${change.addedKeys.join(KEY_SEPARATOR)} start at their defaults`);
    if (change.removedKeys.length > 0) parts.push(`removed fields ${change.removedKeys.join(KEY_SEPARATOR)} were dropped`);
    return `${change.typeName} changed: ${parts.join(PART_SEPARATOR)}`;
}
