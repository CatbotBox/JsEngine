import {EntityArchetypeMap} from "./entityArchetypeMap";
import {System, SystemCtor} from "./system";
import {EntityManager} from "./entityManager";
import {Entity} from "./entity";
import {SystemGroup} from "./systemGroup";
import {RootSystemGroup} from "./rootSystemGroup";
import {GcSystem} from "./gcSystem";
import {WorldSource} from "./worldSource";
import {performance} from "node:perf_hooks";
import {clearInterval} from "node:timers";
import {ResourceManager} from "./resourceManager";


class Time {
    /**
     * time from last tick (in milliseconds)
     */
    public deltaTime: number = 0;

    public get elapsedTime(): number {
        return performance.now();
    }

}

export class World extends WorldSource {
    get timeout(): unknown | null {
        return this._timeout;
    }

    set timeout(value: unknown | null) {
        this._timeout = value;
    }

    private _archetypes: EntityArchetypeMap = new EntityArchetypeMap();
    private _resources: ResourceManager = new ResourceManager();
    protected _systems: Map<SystemCtor<System>, System> = new Map();
    protected _rootSystemGroup: SystemGroup;
    public time: Time = new Time();

    get archetypes(): EntityArchetypeMap {
        return this._archetypes;
    }

    get resources(): ResourceManager {
        return this._resources;
    }

    get entityManager(): EntityManager {
        return new EntityManager(this)
    }


    //update loop settings
    private _timeout: unknown | null = null;
    protected _targetDeltaTime: number = 1000 / 60; // default to 60 FPS

    constructor() {
        super(undefined!);
        this.world = this;
        this._archetypes.onCreateArchetype.add((_archetype) => { /* hook point */
        });
        this._rootSystemGroup = this.createSystem(RootSystemGroup)
        this.ensureSystemExists(GcSystem)
    }

    // alias for getOrCreateSystem as it can be used another way
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
        if (this._timeout !== null) {
            console.warn("World loop already started");
            return;
        }
        const time = this.time
        let updateInProgress = false;
        let prevCycle = performance.now();
        this._timeout = setInterval(() => {
            if (updateInProgress) {
                console.warn("Update in progress, skipping current update cycle");
                return;
            }
            updateInProgress = true
            const now = performance.now();
            const delta = now - prevCycle;
            if (delta < this._targetDeltaTime) {
                updateInProgress = false;
                return; // skip update if not enough time has passed
            }
            prevCycle = now;
            time.deltaTime = delta;
            // time.elapsedTime = now;
            this.update();
            updateInProgress = false;

        }, this._targetDeltaTime / 10);
    }

    public pause(): void {
        if (this._timeout !== null) {
            clearInterval(this._timeout as any);
            this._timeout = null;
        }
    }

    public stop(): void {
        this.pause();
        this._rootSystemGroup.destroy();
    }

    public get targetDeltaTime(): number {
        return this._targetDeltaTime;
    }

    public set targetDeltaTime(value: number) {
        if (value === this._targetDeltaTime) return;
        this._targetDeltaTime = value;
        if (this._timeout !== null) {
            this.pause();
            this.startLoop();
        }
    }

    public get targetFramerate(): number {
        return 1000 / this._targetDeltaTime;
    }

    public set targetFramerate(value: number) {
        if (value <= 0) throw new Error("Framerate must be positive and non-zero");
        this.targetDeltaTime = 1000 / value;
    }


    private update(): void {
        this._rootSystemGroup.update();
    }

    public* systems(): Iterator<System> {
        return this._systems.values();
    }

    public* entities(): Iterator<Entity> {
        for (const archetype of this._archetypes.values()) {
            for (let i = 0; i < archetype.entityCount; i++) {
                const entity = archetype.getEntityAtIndex(i);
                if (entity) yield entity;
            }
        }
    }

    public get systemCount(): number {
        return this._systems.size;
    }

    public get entityCount(): number {
        let count = 0;
        for (const archetype of this._archetypes.values()) {
            count += archetype.entityCount;
        }
        return count;
    }

}

