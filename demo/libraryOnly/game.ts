import {Component, System} from "@jsengine/engine/core";
import type {World} from "@jsengine/engine/core";
import {Input, Key} from "@jsengine/engine/input";
import {startGame} from "@jsengine/engine/project";
import {componentSchema, ENGINE_SCHEMAS} from "@jsengine/engine/scene";
import type {SceneActivation, SchemaEntry} from "@jsengine/engine/scene";
import {LocalPosition} from "@jsengine/engine/translation";

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

const LIBRARY_ONLY_SCHEMAS: readonly SchemaEntry[] = [...ENGINE_SCHEMAS, {kind: "componentClass", ctor: Drift}];
const LIBRARY_ONLY_SYSTEMS = [DriftSystem, QuitOnKeySystem];
const START_SCENE_ACTIVATION: SceneActivation = "immediate";

export async function startLibraryOnlyGame(world: World, host: LibraryOnlyHost): Promise<void> {
    world.resources.getOrCreate(Input);
    await startGame(world, {
        directory: host.directory,
        schemas: LIBRARY_ONLY_SCHEMAS,
        systems: LIBRARY_ONLY_SYSTEMS,
        startScene: LIBRARY_ONLY_START_SCENE,
        startSceneActivation: START_SCENE_ACTIVATION,
    });
}
