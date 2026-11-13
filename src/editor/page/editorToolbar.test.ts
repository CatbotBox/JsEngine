import {describe, expect, test} from "../../engine/testing/harness";
import {playStateText, sceneLoadStatus, sceneSaveStatus} from "./editorToolbar";

describe("editor toolbar status text", () => {
    test("a clean save names the file only", () => {
        expect(sceneSaveStatus({skippedComponentTypes: [], danglingEntityRefs: [], unsavedAssets: []})).toBe("Saved scene.json");
    });

    test("save warnings list skipped types and at most three paths each", () => {
        expect(sceneSaveStatus({
            skippedComponentTypes: [{typeName: "Spin", entityCount: 1}, {typeName: "Fade", entityCount: 4}],
            danglingEntityRefs: [],
            unsavedAssets: ["entities[1].RenderMesh.mesh", "entities[2].RenderMesh.mesh", "entities[3].RenderMesh.mesh", "entities[4].RenderMesh.mesh"],
        })).toBe("Saved scene.json; skipped Spin (1 entity), Fade (4 entities); "
            + "4 assets without a file saved as null: entities[1].RenderMesh.mesh, entities[2].RenderMesh.mesh, entities[3].RenderMesh.mesh and 1 more");
    });

    test("load status counts entities and lists what was dropped", () => {
        expect(sceneLoadStatus({entityCount: 1, report: {skippedComponentTypes: [], danglingEntityRefs: [], droppedComponents: []}})).toBe("Loaded 1 entity");
        expect(sceneLoadStatus({
            entityCount: 12,
            report: {skippedComponentTypes: [], danglingEntityRefs: ["entities[2].Parent.entity"], droppedComponents: ["entities[2].Parent"]},
        })).toBe("Loaded 12 entities; 1 dangling reference loaded as null: entities[2].Parent.entity; 1 dropped component: entities[2].Parent");
    });

    test("the play state shows the gameplay tick outside edit mode", () => {
        expect(playStateText({mode: "edit", gameplayTicks: 0})).toBe("Editing");
        expect(playStateText({mode: "play", gameplayTicks: 3})).toBe("Playing (tick 3)");
        expect(playStateText({mode: "paused", gameplayTicks: 4})).toBe("Paused (tick 4)");
    });
});
