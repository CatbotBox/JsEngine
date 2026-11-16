import {describe, expect, test} from "../../engine/testing/harness";
import type {EditorExtensions, FieldDrawer} from "../project/editorExtensions";
import {FieldDrawerRegistry} from "../page/fieldDrawers";
import {EditorExtensionLoader} from "./editorExtensionLoader";

const GRADIENT_FIELD = {key: "gradient", kind: "custom", typeName: "Gradient"} as const;
const PERCENT_FIELD = {key: "chance", kind: "number", typeName: "Percent"} as const;
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

describe("editor extension loader", () => {
    test("the loader swaps the previous extension's drawers for the rebuilt one's and reports failures instead of throwing", async () => {
        const drawers = new FieldDrawerRegistry();
        const errors: string[] = [];
        const modules: Record<string, unknown> = {
            "first.js": drawerModule(["Gradient"], {shown: []}),
            "second.js": drawerModule(["Gradient", "Percent"], {shown: []}),
        };
        const loader = new EditorExtensionLoader({
            reportError: text => errors.push(text),
            drawers,
            importModule: async url => {
                const module = modules[url];
                if (module === undefined) throw new Error(`cannot fetch ${url}`);
                return module;
            },
        });
        await loader.load("first.js");
        expect([drawers.drawerFor(GRADIENT_FIELD) !== undefined, drawers.drawerFor(PERCENT_FIELD) !== undefined]).toEqual([true, false]);
        await loader.load("second.js");
        expect(drawers.size).toBe(2);
        await loader.load("missing.js");
        expect(drawers.size).toBe(0);
        expect(errors).toEqual(["The editor extensions did not load: cannot fetch missing.js"]);
        await loader.load("first.js");
        await loader.load(undefined);
        expect(drawers.size).toBe(0);
    });
});
