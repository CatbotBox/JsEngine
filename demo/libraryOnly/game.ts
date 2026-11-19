import {Component, System} from "../../src/engine/core";
import type {World} from "../../src/engine/core";
import {Input, Key} from "../../src/engine/input";
import {directoryFileSource} from "../../src/engine/platform/directoryFileSource";
import {ComponentSchemaRegistry, componentSchema, registerEngineComponentSchemas, SceneManager} from "../../src/engine/scene";
import {LocalPosition} from "../../src/engine/translation";

export const LIBRARY_ONLY_START_SCENE = "scenes/main.scene.json";

const MS_PER_SECOND = 1000;
const QUIT_KEYS: readonly Key[] = [Key.Escape, Key.Q];

export interface LibraryOnlyHost {
    readonly directory: string;
}

export class Drift extends Component {
    public static readonly schema = componentSchema(Drift, "Drift").number("unitsPerSecondX").number("unitsPerSecondY").build();
    public unitsPerSecondX = 0;
    public unitsPerSecondY = 0;
}

class DriftSystem extends System {
    private drifting = this.createEntityQuery([Drift, LocalPosition]);

    protected onCreate(): void {
        this.requireAnyForUpdate(this.drifting);
    }

    public onUpdate(): void {
        const seconds = this.world.time.deltaTimeMs / MS_PER_SECOND;
        this.drifting.stream({read: {drift: Drift}, write: {position: LocalPosition}}).forEach(({drift, position}) => {
            position.x += drift.unitsPerSecondX * seconds;
            position.y += drift.unitsPerSecondY * seconds;
        });
    }
}

class QuitOnKeySystem extends System {
    public onUpdate(): void {
        const input = this.world.resources.get(Input);
        if (QUIT_KEYS.some(key => input.keyPressed(key))) this.world.requestQuit();
    }
}

export function createLibraryOnlyRegistry(): ComponentSchemaRegistry {
    const registry = new ComponentSchemaRegistry();
    registerEngineComponentSchemas(registry);
    registry.registerComponentClass(Drift);
    return registry;
}

export async function startLibraryOnlyGame(world: World, host: LibraryOnlyHost): Promise<void> {
    world.resources.getOrCreate(Input);
    const scenes = new SceneManager(world, createLibraryOnlyRegistry(), {files: directoryFileSource(world.platform.files, host.directory)});
    await scenes.load(LIBRARY_ONLY_START_SCENE);
    world.ensureSystemExists(DriftSystem);
    world.ensureSystemExists(QuitOnKeySystem);
}
