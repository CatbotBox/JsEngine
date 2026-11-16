import type {SceneJsonValue} from "../../engine/scene/sceneDocument";

export const EDITOR_EXTENSIONS_EXPORT = "registerEditorExtensions";
export const EDITOR_EXTENSIONS_BUNDLE_FILE = "editor-extensions.js";

export interface ExtensionFieldDescription {
    readonly key: string;
    readonly kind: string;
    readonly typeName?: string;
}

export interface FieldDrawerServices {
    reportInvalid(message: string): void;

    isReadOnly(): boolean;

    endGesture(coalesceKey: string): void;
}

export interface FieldDrawerContext {
    readonly typeName: string;
    readonly field: ExtensionFieldDescription;
    readonly label: HTMLElement;
    readonly services: FieldDrawerServices;

    commit(before: readonly unknown[], after: readonly SceneJsonValue[], coalesceKey?: string): Promise<readonly unknown[] | undefined>;
}

export interface FieldDrawer {
    readonly element: HTMLElement;

    show(values: readonly unknown[]): void;

    showEntityChoices?(): void;
}

export type FieldDrawerFactory = (document: Document, context: FieldDrawerContext) => FieldDrawer;

export interface EditorExtensions {
    registerFieldDrawer(typeName: string, factory: FieldDrawerFactory): void;
}

export interface EditorExtensionsModule {
    registerEditorExtensions(editor: EditorExtensions): void | Promise<void>;
}
