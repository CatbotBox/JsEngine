import {describe, expect, test} from "../../engine/testing/harness";
import type {EditorExtensions, FieldDrawer} from "../project/editorExtensions";
import type {FieldEditorContext} from "./fieldEditorBase";
import {FieldDrawerRegistry} from "./fieldDrawers";
import {registerEditorExtensionsOf} from "./editorExtensionSession";

const GRADIENT_FIELD = {key: "gradient", kind: "custom", typeName: "Gradient"} as const;
const NO_DOCUMENT = {} as Document;
const NO_ELEMENT = {} as HTMLElement;

interface ShownValues {
    readonly shown: unknown[][];
}

function drawerModule(typeNames: readonly string[], log: ShownValues): {registerEditorExtensions(editor: EditorExtensions): void} {
    return {
        registerEditorExtensions(editor: EditorExtensions): void {
            for (const typeName of typeNames) {
                editor.registerFieldDrawer(typeName, (): FieldDrawer => ({element: NO_ELEMENT, show: values => log.shown.push([...values])}));
            }
        },
    };
}

function contextFor(field: FieldEditorContext["field"]): FieldEditorContext {
    return {field} as FieldEditorContext;
}

describe("editor extensions", () => {
    test("registerEditorExtensions adds drawers keyed by type name, and disposing the session removes them", async () => {
        const drawers = new FieldDrawerRegistry();
        const log: ShownValues = {shown: []};
        const session = await registerEditorExtensionsOf(drawerModule(["Gradient", "Percent"], log), drawers);
        expect([session.drawerCount, drawers.size]).toEqual([2, 2]);
        const editor = drawers.drawerFor(GRADIENT_FIELD)!(NO_DOCUMENT, contextFor(GRADIENT_FIELD));
        editor.show([[1, 2]]);
        editor.showEntityChoices();
        expect(log.shown).toEqual([[[1, 2]]]);
        session.dispose();
        expect(drawers.size).toBe(0);
    });

    test("a module without the export, or a registration that throws, registers nothing", async () => {
        const drawers = new FieldDrawerRegistry();
        let failure = "";
        await registerEditorExtensionsOf({}, drawers).catch((error: Error) => failure = error.message);
        expect(failure).toBe("the editor extensions module does not export a registerEditorExtensions(editor) function");
        const throwing = {
            registerEditorExtensions(editor: EditorExtensions): void {
                drawerModule(["Gradient"], {shown: []}).registerEditorExtensions(editor);
                throw new Error("half done");
            },
        };
        await registerEditorExtensionsOf(throwing, drawers).catch((error: Error) => failure = error.message);
        expect([failure, drawers.size]).toEqual(["half done", 0]);
    });
});
