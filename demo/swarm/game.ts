import {System} from "@jsengine/engine/core";
import type {World} from "@jsengine/engine/core";
import {Input} from "@jsengine/engine/input";
import {Camera, RenderPasses, ScreenSize, worldViewRectInto} from "@jsengine/engine/rendering";
import {LocalToWorld} from "@jsengine/engine/translation";
import {Vec} from "@jsengine/engine/math";
import {DataAssets, dataAssetPathOf, SceneLoadCancelledError, SceneLoader} from "@jsengine/engine/scene";
import {LifetimeSystem, MotionSystem} from "@jsengine/engine/motion";
import {swarmActionsOf} from "./actions";
import type {SwarmActions} from "./actions";
import {Bullet, Enemy, Spark, SwarmSettingsMenu} from "./components";
import {ARENA_PRIORITY, CONTROL_PRIORITY, LIFETIME_PRIORITY, MOTION_PRIORITY} from "./frameOrder";
import {SwarmPhase, SwarmState} from "./resources";
import {commandBufferOf, HALF, simulationStepMs, SwarmArena} from "./simulation";
import {SwarmConfig} from "./config";

const STATE_FILE = "assets/state.asset.json";
const GAMEPLAY_SCENE_FILE = "scenes/main.scene.json";
const ORIGIN = 0;

function startNewGame(world: World, state: SwarmState): void {
    const path = dataAssetPathOf(state);
    if (path === undefined || world.resources.get(DataAssets).reload(path) === undefined) {
        throw new Error(`SwarmState has no starting values to reload: load it from ${STATE_FILE} through "resources" in jsengine.project.json`);
    }
    const config = world.resources.get(SwarmConfig);
    state.phase = SwarmPhase.Playing;
    state.wave = config.waves.firstWave;
    state.lives = config.ship.startLives;
    state.bombs = config.bomb.startBombs;
    state.invulnerableRemainingMs = config.ship.startInvulnerabilityMs;
    state.intermissionRemainingMs = config.waves.intermissionMs;
}

export class SwarmArenaSystem extends System {
    private _cameraQuery = this.createEntityQuery([Camera, ScreenSize, LocalToWorld]);

    override priority(): number {
        return ARENA_PRIORITY;
    }

    protected onCreate(): void {
        this.world.resources.getOrCreate(SwarmArena);
        this.requireResourceForUpdate(SwarmConfig);
    }

    onUpdate(): void {
        const arena = this.world.resources.get(SwarmArena);
        const fallback = this.world.resources.get(SwarmConfig).arena;
        const camera = this._cameraQuery.tryGetSingleton({screenSize: ScreenSize, localToWorld: LocalToWorld});
        const screenWidth = camera !== undefined && camera.screenSize.x > 0 ? camera.screenSize.x : fallback.fallbackWidthUnits;
        const screenHeight = camera !== undefined && camera.screenSize.y > 0 ? camera.screenSize.y : fallback.fallbackHeightUnits;
        const position = camera?.localToWorld.position;
        const cameraX = position === undefined ? ORIGIN : Vec.x(position);
        const cameraY = position === undefined ? ORIGIN : Vec.y(position);
        const view = worldViewRectInto(arena.view, cameraX, cameraY, screenWidth, screenHeight);
        arena.halfWidthUnits = view.widthUnits * HALF;
        arena.halfHeightUnits = view.heightUnits * HALF;
    }
}

export class SwarmControlSystem extends System {
    private _enemies = this.createEntityQuery([Enemy]);
    private _bullets = this.createEntityQuery([Bullet]);
    private _sparks = this.createEntityQuery([Spark]);
    private _settingsMenus = this.createEntityQuery([SwarmSettingsMenu]);
    private _actions!: SwarmActions;
    private _gameplaySceneLoading = false;

    override priority(): number {
        return CONTROL_PRIORITY;
    }

    protected onCreate(): void {
        this.requireResourceForUpdate(SwarmState);
        this.requireResourceForUpdate(SwarmConfig);
        this._actions = swarmActionsOf(this.world);
    }

    onUpdate(): void {
        const input = this.world.resources.get(Input);
        const state = this.world.resources.get(SwarmState);
        const settingsOpen = this._settingsMenus.hasEntity();
        const settingsClosing = settingsOpen && input.actionPressed(this._actions.CloseSettings);
        if (!settingsClosing && input.actionPressed(this._actions.Quit)) {
            this.world.requestQuit();
            return;
        }
        if (input.actionPressed(this._actions.ToggleHud)) this.world.resources.tryGet(RenderPasses)?.toggle("hudText");
        // Starting lasts until the gameplay scene is active and at least one frame: the ECB destroyed the old entities at the end of the frame that queued it, so reset only then.
        if (state.phase === SwarmPhase.Starting) {
            if (this.gameplaySceneReady()) startNewGame(this.world, state);
            return;
        }
        if (state.phase === SwarmPhase.Title && !settingsOpen && input.actionPressed(this._actions.Start)) {
            this.clearField(state);
            this.loadGameplayScene();
            return;
        }
        if (state.phase === SwarmPhase.GameOver && input.actionPressed(this._actions.Restart)) this.clearField(state);
    }

    private gameplaySceneReady(): boolean {
        return !this._gameplaySceneLoading && this.world.resources.get(SceneLoader).active()?.path === GAMEPLAY_SCENE_FILE;
    }

    private loadGameplayScene(): void {
        this._gameplaySceneLoading = true;
        void this.world.resources.get(SceneLoader).load(GAMEPLAY_SCENE_FILE)
            .catch(error => {
                if (!(error instanceof SceneLoadCancelledError)) console.error(`Swarm could not load the gameplay scene ${GAMEPLAY_SCENE_FILE}`, error);
            })
            .finally(() => {
                this._gameplaySceneLoading = false;
            });
    }

    private clearField(state: SwarmState): void {
        const buffer = commandBufferOf(this.world);
        buffer.destroyQuery(this._enemies);
        buffer.destroyQuery(this._bullets);
        buffer.destroyQuery(this._sparks);
        state.phase = SwarmPhase.Starting;
    }
}

export class SwarmMotionSystem extends MotionSystem {
    override priority(): number {
        return MOTION_PRIORITY;
    }

    protected override onCreate(): void {
        this.requireResourceForUpdate(SwarmConfig);
        super.onCreate();
    }

    protected override stepMs(): number {
        return simulationStepMs(this.world);
    }
}

export class SwarmLifetimeSystem extends LifetimeSystem {
    override priority(): number {
        return LIFETIME_PRIORITY;
    }

    protected override onCreate(): void {
        this.requireResourceForUpdate(SwarmConfig);
        super.onCreate();
    }

    protected override stepMs(): number {
        return simulationStepMs(this.world);
    }
}
