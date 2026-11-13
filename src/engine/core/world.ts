import {EntityArchetypeMap} from "./entityArchetypeMap";
import {System, SystemCtor} from "./system";
import {EntityManager} from "./entityManager";
import {Entity} from "./entity";
import {SystemGroup} from "./systemGroup";
import {RootSystemGroup} from "./rootSystemGroup";
import {GcSystem} from "./gcSystem";
import {InputSystem} from "../input/inputSystem";
import {WorldSource} from "./worldSource";
import {ResourceManager} from "./resourceManager";
import type {Platform} from "../platform/platform";

const MS_PER_SECOND = 1000;
const DEFAULT_TARGET_FPS = 60;
const LOOP_POLLS_PER_FRAME = 10;

class Time {
    public deltaTimeMs: number = 0;

    public get elapsedTimeMs(): number {
        return performance.now();
    }

}

export interface WorldOptions {
    readonly platform: Platform;
}

export class World extends WorldSource {
    public readonly platform: Platform;
    private _archetypes: EntityArchetypeMap = new EntityArchetypeMap();
    private _resources: ResourceManager = new ResourceManager();
    protected _systems: Map<SystemCtor<System>, System> = new Map();
    protected _rootSystemGroup: SystemGroup;
    private _entityManager: EntityManager | undefined;
    public time: Time = new Time();

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

    private _loopHandle: ReturnType<typeof setInterval> | null = null;
    protected _targetDeltaTimeMs: number = MS_PER_SECOND / DEFAULT_TARGET_FPS;

    constructor(options: WorldOptions) {
        super(undefined!);
        this.world = this;
        this.platform = options.platform;
        this._rootSystemGroup = this.createSystem(RootSystemGroup)
        this.ensureSystemExists(GcSystem)
        this.ensureSystemExists(InputSystem)
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
        if (this._loopHandle !== null) {
            console.warn("World loop already started");
            return;
        }
        const time = this.time
        let updateInProgress = false;
        let prevCycle = performance.now();
        this._loopHandle = setInterval(() => {
            if (updateInProgress) {
                console.warn("Update in progress, skipping current update cycle");
                return;
            }
            updateInProgress = true
            const now = performance.now();
            const delta = now - prevCycle;
            if (delta < this._targetDeltaTimeMs) {
                updateInProgress = false;
                return;
            }
            prevCycle = now;
            time.deltaTimeMs = delta;
            this.update();
            updateInProgress = false;

        }, this._targetDeltaTimeMs / LOOP_POLLS_PER_FRAME);
    }

    public pause(): void {
        if (this._loopHandle !== null) {
            clearInterval(this._loopHandle);
            this._loopHandle = null;
        }
    }

    public stop(): void {
        this.pause();
        this._rootSystemGroup.destroy();
    }

    public get targetDeltaTimeMs(): number {
        return this._targetDeltaTimeMs;
    }

    public set targetDeltaTimeMs(value: number) {
        if (value === this._targetDeltaTimeMs) return;
        this._targetDeltaTimeMs = value;
        if (this._loopHandle !== null) {
            this.pause();
            this.startLoop();
        }
    }

    public get targetFramerate(): number {
        return MS_PER_SECOND / this._targetDeltaTimeMs;
    }

    public set targetFramerate(value: number) {
        if (value <= 0) throw new Error("Framerate must be positive and non-zero");
        this.targetDeltaTimeMs = MS_PER_SECOND / value;
    }

    public step(deltaTimeMs: number = this._targetDeltaTimeMs): void {
        if (this._loopHandle !== null) throw new Error("World.step: the loop is running; pause() the world before stepping it");
        this.time.deltaTimeMs = deltaTimeMs;
        this.update();
    }

    private update(): void {
        this._rootSystemGroup.update();
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

