import {ComponentType, EntityQuery, persistentTrackComponent} from "../../src/engine/core";
import type {Component, ComponentCtor, Entity, EntityCommandBuffer, World} from "../../src/engine/core";
import {getEntityCreationOrder} from "../../src/engine/core/ownership";
import {Quaternions} from "../../src/engine/math/quaternions";
import type {Vec3, Vec4} from "../../src/engine/math/types/vec";
import {RenderMesh} from "../../src/engine/rendering/3d";
import {untrackedComponentOf} from "../../src/engine/scene";
import type {PrefabTemplate} from "../../src/engine/scene";
import {LocalPosition, LocalRotation, LocalScale} from "../../src/engine/translation";
import {GridModel} from "./components";
import type {ModelGrid} from "./components";

const PENDING_SPAWN_GRACE_TICKS = 1;
const HALF = 0.5;
const FIRST_SLOT = 0;
const NEXT_SLOT_STEP = 1;
const PLACED_MODEL_ROWS = {includeEntity: true, includeDisabled: true} as const;
const PLACED_MODEL_COMPONENTS = [GridModel, LocalPosition, LocalRotation, LocalScale, RenderMesh] as const;

interface GridEntry {
    readonly entity: Entity;
    readonly slot: number;
    readonly position: LocalPosition;
    readonly rotation: LocalRotation;
    readonly scale: LocalScale;
    readonly renderMesh: RenderMesh;
    pendingSinceTick: number | undefined;
}

function bySlotThenCreationOrder(a: GridEntry, b: GridEntry): number {
    return a.slot - b.slot || getEntityCreationOrder(a.entity)! - getEntityCreationOrder(b.entity)!;
}

function centeredCell(index: number, cells: number, spacing: number): number {
    return (index - (cells - 1) * HALF) * spacing;
}

export class GridModels {
    private entries: GridEntry[] = [];
    private readonly despawning = new Set<Entity>();
    private readonly placed: EntityQuery<typeof PLACED_MODEL_COMPONENTS>;

    public constructor(private readonly world: World) {
        this.placed = new EntityQuery(world, PLACED_MODEL_COMPONENTS);
    }

    public get count(): number {
        return this.entries.length;
    }

    public sourceTriangles(): number {
        let triangles = 0;
        for (const entry of this.entries) triangles += entry.renderMesh.mesh?.triangleCount ?? 0;
        return triangles;
    }

    public sync(): void {
        const entityManager = this.world.entityManager;
        for (const entity of [...this.despawning]) if (!entityManager.exists(entity)) this.despawning.delete(entity);
        let stale = false;
        for (const entry of this.entries) {
            if (entityManager.exists(entry.entity)) entry.pendingSinceTick = undefined;
            else if (!this.isPending(entry)) stale = true;
        }
        if (stale || this.hasUnlistedModel()) this.rebuild();
    }

    public spawn(template: PrefabTemplate, buffer: EntityCommandBuffer, grid: ModelGrid): void {
        const spawned = template.spawn(buffer);
        const entity = spawned.root;
        const slot = this.nextSlot();
        spawned.rootComponent(GridModel).slot = slot;
        const entry: GridEntry = {
            entity,
            slot,
            position: persistentTrackComponent(entity, spawned.rootComponent(LocalPosition)),
            rotation: persistentTrackComponent(entity, spawned.rootComponent(LocalRotation)),
            scale: persistentTrackComponent(entity, spawned.rootComponent(LocalScale)),
            renderMesh: spawned.rootComponent(RenderMesh),
            pendingSinceTick: this.world.time.tickCount,
        };
        entry.rotation.xyzw = Quaternions.eulerToQuat(grid.rotationRad);
        entry.scale.xyz = grid.scale;
        this.entries.push(entry);
        this.layout(grid.spacingUnits);
    }

    public despawnLast(buffer: EntityCommandBuffer, grid: ModelGrid): void {
        const last = this.entries.pop();
        if (last === undefined) return;
        buffer.destroyEntity(last.entity);
        this.despawning.add(last.entity);
        this.layout(grid.spacingUnits);
    }

    public rotateAll(rotation: Vec4): void {
        for (const entry of this.entries) entry.rotation.xyzw = rotation;
    }

    public scaleAll(scale: Vec3): void {
        for (const entry of this.entries) entry.scale.xyz = scale;
    }

    private layout(spacing: number): void {
        const count = this.entries.length;
        if (count === 0) return;
        const columns = Math.ceil(Math.cbrt(count));
        const rows = Math.ceil(Math.sqrt(count / columns));
        const layers = Math.ceil(count / (columns * rows));
        this.entries.forEach((entry, index) => {
            const column = index % columns;
            const row = Math.floor(index / columns) % rows;
            const layer = Math.floor(index / (columns * rows));
            entry.position.x = centeredCell(column, columns, spacing);
            entry.position.y = centeredCell(row, rows, spacing);
            entry.position.z = centeredCell(layer, layers, spacing);
        });
    }

    private nextSlot(): number {
        let slot = FIRST_SLOT;
        for (const entry of this.entries) slot = Math.max(slot, entry.slot + NEXT_SLOT_STEP);
        return slot;
    }

    private isPending(entry: GridEntry): boolean {
        return entry.pendingSinceTick !== undefined && this.world.time.tickCount - entry.pendingSinceTick <= PENDING_SPAWN_GRACE_TICKS;
    }

    private hasUnlistedModel(): boolean {
        const listed = new Set(this.entries.map(entry => entry.entity));
        let unlisted = false;
        this.placed.stream({read: {model: GridModel}}, PLACED_MODEL_ROWS).consume(({entity}) => {
            if (!listed.has(entity) && !this.despawning.has(entity)) unlisted = true;
        });
        return unlisted;
    }

    private rebuild(): void {
        const pending = this.entries.filter(entry => !this.world.entityManager.exists(entry.entity) && this.isPending(entry));
        const slots = new Map<Entity, number>();
        this.placed.stream({read: {model: GridModel}}, PLACED_MODEL_ROWS).consume(({entity, model}) => {
            if (!this.despawning.has(entity)) slots.set(entity, model.slot);
        });
        const placed = [...slots].map(([entity, slot]): GridEntry => ({
            entity,
            slot,
            position: persistentTrackComponent(entity, this.componentOf<LocalPosition>(entity, LocalPosition)),
            rotation: persistentTrackComponent(entity, this.componentOf<LocalRotation>(entity, LocalRotation)),
            scale: persistentTrackComponent(entity, this.componentOf<LocalScale>(entity, LocalScale)),
            renderMesh: this.componentOf<RenderMesh>(entity, RenderMesh),
            pendingSinceTick: undefined,
        }));
        this.entries = [...placed.sort(bySlotThenCreationOrder), ...pending];
    }

    private componentOf<T extends Component>(entity: Entity, ctor: ComponentCtor<T>): T {
        return untrackedComponentOf<T>(this.world, entity, ComponentType.of(ctor))!;
    }
}
