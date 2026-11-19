import {EntityArchetypeMap} from "./entityArchetypeMap";
import {System, SystemCtor} from "./system";
import {EntityManager} from "./entityManager";
import {Entity} from "./entity";
import {SystemGroup} from "./systemGroup";
import {RootSystemGroup} from "./rootSystemGroup";
import {Time} from "./time";
import {PresentationBarriers} from "./presentationBarriers";
import {ActiveRenderers} from "./activeRenderers";
import {GcSystem} from "./gcSystem";
import {InputSystem} from "../input/inputSystem";
import {WorldSource} from "./worldSource";
import {ResourceManager} from "./resourceManager";
import type {Platform} from "../platform/platform";
import {ChangeStampCounter} from "./changeStampCounter";
import {EntityQuery} from "./entityQuery";
import {FrameLoopSettings, LoopTimingResolver} from "./frameLoopSettings";
import type {LoopTiming} from "./frameLoopSettings";
import {FrameRunner} from "./frameRunner";
import {timerFrameScheduler} from "../platform/timerFrameScheduler";
import {Event} from "../util/event";
import type {App} from "./app";

const NO_TICK_PROGRESS = 0;

export interface WorldOptions {
    readonly platform: Platform;
    readonly app?: App;
}

export interface WorldStoppedEvent {
    readonly error: unknown;
}

export class World extends WorldSource {
    public readonly platform: Platform;
    public readonly app: App | undefined;
    public readonly changeStamps: ChangeStampCounter = new ChangeStampCounter();
    public readonly onStopped: Event<WorldStoppedEvent> = new Event();
    private _archetypes: EntityArchetypeMap = new EntityArchetypeMap(this.changeStamps);
    private _resources: ResourceManager = new ResourceManager();
    protected _systems: Map<SystemCtor<System>, System> = new Map();
    protected _rootSystemGroup: RootSystemGroup;
    private _entityManager: EntityManager | undefined;
    public time: Time = new Time();
    public readonly presentationBarriers: PresentationBarriers = new PresentationBarriers();
    public readonly renderers: ActiveRenderers = new ActiveRenderers();

    get archetypes(): EntityArchetypeMap {
        return this._archetypes;
    }

    get resources(): ResourceManager {
        return this._resources;
    }

    get entityManager(): EntityManager {
        return this._entityManager ??= new EntityManager(this);
    }

    get rootSystemGroup(): SystemGroup | undefined {
        return this._rootSystemGroup;
    }

    private _frames: FrameRunner | undefined;
    private readonly _frameLoopSettingsQuery = new EntityQuery(this, [FrameLoopSettings]);
    private readonly _defaultFrameLoopSettings = new FrameLoopSettings();
    private readonly _loopTimingResolver = new LoopTimingResolver();

    constructor(options: WorldOptions) {
        super(undefined!);
        this.world = this;
        this.platform = options.platform;
        this.app = options.app;
        this._rootSystemGroup = this.createSystem(RootSystemGroup)
        this.ensureSystemExists(GcSystem)
        this.ensureSystemExists(InputSystem)
        options.app?.addWorld(this);
    }

    public ensureSystemExists<T extends System>(constructor: SystemCtor<T>): void {
        this.getOrCreateSystem<T>(constructor)
    }

    public getOrCreateSystem<T extends System>(constructor: SystemCtor<T>): T {
        const existing = this._systems.get(constructor);
        if (existing !== undefined) return existing as T;
        const system = new constructor();
        system.world = this;
        this._systems.set(constructor, system);
        system.create();
        return system;
    }

    public createSystem<T extends System>(systemClass: SystemCtor<T>): T {
        const existing = this._systems.get(systemClass);
        if (existing !== undefined) throw new Error("System {" + systemClass.name + "} already exists");
        const systemInstance = new systemClass();
        systemInstance.world = this;
        this._systems.set(systemClass, systemInstance);
        systemInstance.create();
        return systemInstance;
    }

    public createSystemNow<T extends System>(systemClass: SystemCtor<T>): T {
        const system = this.createSystem(systemClass);
        system.joinGroupNow();
        return system;
    }

    public removeSystem<T extends System>(systemClass: SystemCtor<T>): void {
        const system = this.tryGetSystem(systemClass);
        if (!system) return
        system.destroy();
        this._systems.delete(systemClass);
    }

    public tryGetSystem<T extends System>(systemClass: SystemCtor<T>): T | undefined {
        const existing = this._systems.get(systemClass);
        return existing as T | undefined;
    }

    public hasSystem<T extends System>(systemClass: SystemCtor<T>): boolean {
        return this._systems.has(systemClass);
    }

    public startLoop(): void {
        const frames = this._frames ??= this.createFrameRunner();
        if (frames.running) {
            console.warn("World loop already started");
            return;
        }
        frames.start();
    }

    public pause(): void {
        this._frames?.stop();
    }

    public stop(error?: unknown): void {
        this.pause();
        this._rootSystemGroup.destroy();
        this.onStopped.invoke({error});
    }

    public requestQuit(): void {
        const app = this.app;
        if (app === undefined) {
            throw new Error("World.requestQuit: this world has no App to quit; create it with App.createWorld or App.createDebugWorld, "
                + "or call world.stop() and end the process yourself");
        }
        app.requestQuit();
    }

    public get loopTiming(): LoopTiming {
        const settings = this._frameLoopSettingsQuery.tryGetSingleton({settings: FrameLoopSettings})?.settings ?? this._defaultFrameLoopSettings;
        return this._loopTimingResolver.resolve(settings, this.renderers.framesRenderedOnCpu);
    }

    public step(deltaTimeMs: number = this.loopTiming.tickDeltaMs): void {
        this.requirePaused("step");
        const time = this.time;
        time.deltaTimeMs = deltaTimeMs;
        time.tickDeltaTimeMs = deltaTimeMs;
        time.frameDeltaTimeMs = deltaTimeMs;
        time.tickAlpha = NO_TICK_PROGRESS;
        time.tickCount++;
        time.frameCount++;
        this._rootSystemGroup.update();
        this.finishFrame();
    }

    public stepSimulation(deltaTimeMs: number = this.loopTiming.tickDeltaMs): void {
        this.requirePaused("stepSimulation");
        this.simulateTick(deltaTimeMs);
    }

    public renderFrame(deltaTimeMs: number, tickAlpha: number = NO_TICK_PROGRESS): void {
        this.requirePaused("renderFrame");
        this.presentFrame(deltaTimeMs, tickAlpha);
    }

    private requirePaused(action: string): void {
        if (this._frames?.running === true) throw new Error(`World.${action}: the loop is running; pause() the world before stepping it`);
    }

    private simulateTick(tickDeltaMs: number): void {
        const time = this.time;
        time.deltaTimeMs = tickDeltaMs;
        time.tickDeltaTimeMs = tickDeltaMs;
        time.tickCount++;
        this._rootSystemGroup.updateSimulation();
    }

    private presentFrame(frameDeltaMs: number, tickAlpha: number): void {
        const time = this.time;
        time.deltaTimeMs = frameDeltaMs;
        time.frameDeltaTimeMs = frameDeltaMs;
        time.tickAlpha = tickAlpha;
        time.frameCount++;
        try {
            this._rootSystemGroup.updatePresentation();
        } finally {
            time.deltaTimeMs = time.tickDeltaTimeMs;
        }
    }

    private finishFrame(): void {
        if (this.app?.quitPending === true) this.app.quitAfterFrame();
    }

    private createFrameRunner(): FrameRunner {
        const platform = this.platform;
        const now = (): number => platform.now();
        return new FrameRunner({
            now,
            scheduler: platform.frameScheduler ?? timerFrameScheduler(now),
            barriers: this.presentationBarriers,
            loopTiming: () => this.loopTiming,
            simulate: tickDeltaMs => this.simulateTick(tickDeltaMs),
            present: (frameDeltaMs, tickAlpha) => this.presentFrame(frameDeltaMs, tickAlpha),
            finishFrame: () => this.finishFrame(),
        });
    }

    public* systems(): IterableIterator<System> {
        yield* this._systems.values();
    }

    public* entities(): IterableIterator<Entity> {
        for (const archetype of this._archetypes.values()) {
            for (let i = 0; i < archetype.enabledEntityCount; i++) {
                const entity = archetype.getEntityAtIndex(i);
                if (entity) yield entity;
            }
        }
    }

    public get systemCount(): number {
        return this._systems.size;
    }

    public get enabledEntityCount(): number {
        let count = 0;
        for (const archetype of this._archetypes.values()) {
            count += archetype.enabledEntityCount;
        }
        return count;
    }

}

