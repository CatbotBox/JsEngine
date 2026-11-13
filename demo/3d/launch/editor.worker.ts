import {ComponentSchemaRegistry, registerEngineComponentSchemas} from "../../../src/engine/scene";
import {registerCellsComponentSchemas} from "../../../src/backends/cells/cellsComponentSchemas";
import {registerPixelsComponentSchemas} from "../../../src/backends/pixels/pixelsComponentSchemas";
import {runWorldWorker} from "../../../src/hosts/web/worldWorker";
import {attachEditorWorldService} from "../../../src/editor/world/editorWorldService";
import type {EditorServiceScope} from "../../../src/editor/world/editorWorldService";
import {createPixelWorld3d} from "./pixelWorld";
import {manifestFilesForAssets} from "./webAssets";

function editorComponentSchemas(): ComponentSchemaRegistry {
    const registry = new ComponentSchemaRegistry();
    registerEngineComponentSchemas(registry);
    registerCellsComponentSchemas(registry);
    registerPixelsComponentSchemas(registry);
    return registry;
}

runWorldWorker(async (page, files) => {
    const {world, manifest} = await createPixelWorld3d(page, files);
    attachEditorWorldService(globalThis as unknown as EditorServiceScope, world, editorComponentSchemas(), {
        preloadAssets: paths => files.ensureLoaded(manifestFilesForAssets(manifest, paths)),
    });
});
