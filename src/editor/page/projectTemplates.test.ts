import {describe, expect, test} from "../../engine/testing/harness";
import {parseSceneDocument} from "../../engine/scene/sceneDocument";
import {documentRootCount} from "./prefabInstancePaths";
import {DEFAULT_SCRIPT_NAME, prefabTemplateText, scriptComponentName, scriptTemplate} from "./projectTemplates";

describe("prefab template", () => {
    test("is a valid scene document with one named, empty root entity", () => {
        const document = parseSceneDocument(prefabTemplateText("Enemy"));
        expect(documentRootCount(document)).toBe(1);
        expect(document.entities).toEqual([{id: 1, name: "Enemy", enabled: true, components: {}}]);
    });
});

describe("script template", () => {
    test("names a component after the typed name and its system after the component", () => {
        const template = scriptTemplate("Spinner");
        expect([template.fileStem, template.componentName, template.systemName]).toEqual(["spinner", "Spinner", "SpinnerSystem"]);
    });

    test("exports a component and a system the toolchain discovers, importing the engine like project code does", () => {
        const text = scriptTemplate("enemy spawner").text;
        expect(text.startsWith(`import {Component, System} from "@jsengine/engine/core";`)).toBe(true);
        expect(text.includes("export class EnemySpawner extends Component {")).toBe(true);
        expect(text.includes("export class EnemySpawnerSystem extends System {")).toBe(true);
        expect(text.includes("this.requireAllForUpdate(this._enemySpawnerEntities);")).toBe(true);
        expect(text.includes("onUpdate(): void {")).toBe(true);
    });

    test("turns any typed name into a usable class name", () => {
        expect(scriptComponentName("move-system")).toBe("Move");
        expect(scriptComponentName("MoveSystem")).toBe("Move");
        expect(scriptComponentName("System")).toBe(DEFAULT_SCRIPT_NAME);
        expect(scriptComponentName("  ")).toBe(DEFAULT_SCRIPT_NAME);
        expect(scriptComponentName("3d camera")).toBe("Script3dCamera");
        expect(scriptComponentName("über_tool")).toBe("ÜberTool");
    });
});
