import {ComponentSchemaRegistry, registerEngineComponentSchemas} from "../../../src/engine/scene";
import {registerCellsComponentSchemas} from "../../../src/backends/cells/cellsComponentSchemas";
import {registerPixelsComponentSchemas} from "../../../src/backends/pixels/pixelsComponentSchemas";
import {runWorldWorker} from "../../../src/hosts/web/worldWorker";
import {attachEditorWorldService} from "../../../src/editor/world/editorWorldService";
import type {EditorServiceScope} from "../../../src/editor/world/editorWorldService";
import {createPixelWorld2d} from "./pixelWorld";

function editorComponentSchemas(): ComponentSchemaRegistry {
    const registry = new ComponentSchemaRegistry();
    registerEngineComponentSchemas(registry);
    registerCellsComponentSchemas(registry);
    registerPixelsComponentSchemas(registry);
    return registry;
}

runWorldWorker(page => {
    attachEditorWorldService(globalThis as unknown as EditorServiceScope, createPixelWorld2d(page), editorComponentSchemas());
});
