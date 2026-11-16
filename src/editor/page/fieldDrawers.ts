import type {EditorFieldTypeDescription} from "../editorProtocol";
import type {FieldEditorFactory} from "./fieldEditorBase";

export type FieldDrawerFactory = FieldEditorFactory;

export type UnregisterFieldDrawer = () => void;

export function fieldTypeNameOf(field: EditorFieldTypeDescription): string | undefined {
    return "typeName" in field ? field.typeName : undefined;
}

export class FieldDrawerRegistry {
    private readonly byTypeName = new Map<string, FieldDrawerFactory>();

    public get size(): number {
        return this.byTypeName.size;
    }

    public register(typeName: string, factory: FieldDrawerFactory): UnregisterFieldDrawer {
        if (typeName.length === 0) throw new Error("A field drawer needs a non-empty type name");
        if (typeof factory !== "function") throw new Error(`The field drawer for "${typeName}" must be a function that creates a field editor`);
        if (this.byTypeName.has(typeName)) throw new Error(`A field drawer for "${typeName}" is already registered`);
        this.byTypeName.set(typeName, factory);
        return () => {
            if (this.byTypeName.get(typeName) === factory) this.byTypeName.delete(typeName);
        };
    }

    public drawerFor(field: EditorFieldTypeDescription): FieldDrawerFactory | undefined {
        const typeName = fieldTypeNameOf(field);
        return typeName === undefined ? undefined : this.byTypeName.get(typeName);
    }
}

export const fieldDrawers = new FieldDrawerRegistry();

export function registerFieldDrawer(typeName: string, factory: FieldDrawerFactory): UnregisterFieldDrawer {
    return fieldDrawers.register(typeName, factory);
}
