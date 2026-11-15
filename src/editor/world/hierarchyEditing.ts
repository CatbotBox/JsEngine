import type {Entity, World} from "../../engine/core";
import {ComponentType} from "../../engine/core/componentType";
import {Parent, ParentTransform} from "../../engine/translation/parent";
import {Children} from "../../engine/translation/children";
import {LocalPosition} from "../../engine/translation/localPosition";
import {LocalRotation} from "../../engine/translation/localRotation";
import {LocalScale} from "../../engine/translation/localScale";
import {LocalToWorld} from "../../engine/translation/localToWorld";
import {ReadonlyVec3, ReadonlyVec4, Vec, Vec16, Vec3, Vec4} from "../../engine/math/types/vec";
import {
    childEntitiesOf,
    instantiateDocument,
    serializeEntities,
    setSceneRootOrder,
    untrackedComponentOf,
} from "../../engine/scene";
import type {ComponentSchemaRegistry, SceneAssetLoader} from "../../engine/scene";
import {entitiesInCreationOrder, isSceneEntityHandle, parentOf, requireSceneEntity, sceneRoots, siblingIndexOf} from "./entityInspection";

const IDENTITY_ROTATION: ReadonlyVec4 = Vec.alloc4(0, 0, 0, 1);
const UNIT_SCALE: ReadonlyVec3 = Vec.alloc3(1, 1, 1);
const DECOMPOSITION_TOLERANCE = 1e-5;

function childrenByParent(world: World): Map<Entity, Set<Entity>> {
    const byParent = new Map<Entity, Set<Entity>>();
    const link = (parent: Entity, child: Entity) => {
        let children = byParent.get(parent);
        if (children === undefined) byParent.set(parent, children = new Set());
        children.add(child);
    };
    for (const entity of entitiesInCreationOrder(world)) {
        for (const child of childEntitiesOf(world, entity)) link(entity, child);
        const parentLink = untrackedComponentOf<Parent>(world, entity, ComponentType.of(Parent));
        if (parentLink !== undefined) link(parentLink.entity, entity);
    }
    return byParent;
}

export function subtreeOf(world: World, root: Entity): Entity[] {
    const byParent = childrenByParent(world);
    const subtree = [root];
    const seen = new Set<Entity>(subtree);
    for (let i = 0; i < subtree.length; i++) {
        for (const child of byParent.get(subtree[i]) ?? []) {
            if (seen.has(child) || !isSceneEntityHandle(world, child)) continue;
            seen.add(child);
            subtree.push(child);
        }
    }
    return subtree;
}

export function requireNoCycle(world: World, child: Entity, parent: Entity): void {
    if (subtreeOf(world, child).includes(parent)) {
        throw new Error(`Entity ${parent} is entity ${child} or one of its descendants, so it cannot become its parent`);
    }
}

export function childrenComponent(world: World, parent: Entity): Children {
    const entityManager = world.entityManager;
    const existing = entityManager.getComponent<Children>(parent, Children);
    if (existing !== undefined) return existing;
    entityManager.addComponent(parent, new Children());
    return entityManager.getComponent<Children>(parent, Children)!;
}

// Editing keeps Children in step itself: HierarchySyncSystem would otherwise revert a re-parent or re-add a removed Parent.
export function linkChild(world: World, child: Entity, parent: Entity, index?: number): void {
    const children = childrenComponent(world, parent);
    children.insertChild(child, index ?? children.children.length);
}

export function unlinkChild(world: World, child: Entity, parent: Entity): void {
    if (!world.entityManager.exists(parent)) return;
    world.entityManager.getComponent<Children>(parent, Children)?.removeChildKeepingOrder(child);
}

export function reparentKeepingLocals(world: World, child: Entity, link: Parent, parent: Entity): void {
    requireNoCycle(world, child, parent);
    const previous = link.entity;
    if (previous === parent) return;
    unlinkChild(world, child, previous);
    link.entity = parent;
    linkChild(world, child, parent);
}

export function worldMatrixOf(world: World, entity: Entity, out: Vec16 = Vec16.alloc(), visited: Set<Entity> = new Set()): Vec16 {
    const entityManager = world.entityManager;
    visited.add(entity);
    const position = untrackedComponentOf<LocalPosition>(world, entity, ComponentType.of(LocalPosition));
    if (position === undefined) {
        const localToWorld = untrackedComponentOf<LocalToWorld>(world, entity, ComponentType.of(LocalToWorld));
        return localToWorld === undefined ? LocalToWorld.identity(out) : Vec.copy(out, localToWorld.matrix);
    }
    const rotation = untrackedComponentOf<LocalRotation>(world, entity, ComponentType.of(LocalRotation))?.xyzw ?? IDENTITY_ROTATION;
    const scale = untrackedComponentOf<LocalScale>(world, entity, ComponentType.of(LocalScale))?.xyz ?? UNIT_SCALE;
    LocalToWorld.fromTRS(out, position.xyz, rotation, scale);
    const link = untrackedComponentOf<Parent>(world, entity, ComponentType.of(Parent));
    if (link === undefined || visited.has(link.entity) || !entityManager.exists(link.entity)) return out;
    const parentMatrix = worldMatrixOf(world, link.entity, Vec16.alloc(), visited);
    return LocalToWorld.mul(parentMatrix, out, out);
}

function isNear(a: number, b: number): boolean {
    return Math.abs(a - b) <= DECOMPOSITION_TOLERANCE;
}

function nearlyEqual(a: ReadonlyVec4 | ReadonlyVec3, b: ReadonlyVec4 | ReadonlyVec3): boolean {
    const left = Vec.toArray(a), right = Vec.toArray(b);
    return left.length === right.length && left.every((value, index) => isNear(value, right[index]));
}

function setLocalsFromMatrix(world: World, entity: Entity, local: Vec16): void {
    const entityManager = world.entityManager;
    const position = entityManager.getComponent<LocalPosition>(entity, LocalPosition);
    if (position === undefined) return;
    const decomposed = new LocalToWorld();
    decomposed.matrix = local;
    position.xyz = Vec3.alloc(Vec.x(decomposed.position), Vec.y(decomposed.position), Vec.z(decomposed.position));

    const rotation = decomposed.rotationInto(Vec4.alloc());
    const currentRotation = entityManager.getComponent<LocalRotation>(entity, LocalRotation);
    if (currentRotation !== undefined) currentRotation.xyzw = nearlyEqual(rotation, IDENTITY_ROTATION) ? Vec4.alloc(0, 0, 0, 1) : rotation;
    else if (!nearlyEqual(rotation, IDENTITY_ROTATION)) {
        const added = new LocalRotation();
        added.xyzw = rotation;
        entityManager.addComponent(entity, added);
    }

    const scale = decomposed.decomposeScaleInto(Vec3.alloc());
    const currentScale = entityManager.getComponent<LocalScale>(entity, LocalScale);
    if (currentScale !== undefined) currentScale.xyz = nearlyEqual(scale, UNIT_SCALE) ? Vec3.alloc(1, 1, 1) : scale;
    else if (!nearlyEqual(scale, UNIT_SCALE)) {
        const added = new LocalScale();
        added.xyz = scale;
        entityManager.addComponent(entity, added);
    }
}

function placeRoot(world: World, entity: Entity, index: number | undefined): void {
    const others = sceneRoots(world).filter(root => root !== entity);
    const at = index === undefined ? others.length : Math.max(0, Math.min(index, others.length));
    setSceneRootOrder(world, [...others.slice(0, at), entity, ...others.slice(at)]);
}

export function setParent(world: World, entity: Entity, parent: Entity | null, siblingIndex: number | undefined): void {
    requireSceneEntity(world, entity);
    if (parent !== null) {
        requireSceneEntity(world, parent);
        requireNoCycle(world, entity, parent);
    }
    const entityManager = world.entityManager;
    const previous = parentOf(world, entity) ?? null;
    if (previous === parent) {
        if (siblingIndex === undefined) return;
        if (parent === null) placeRoot(world, entity, siblingIndex);
        else childrenComponent(world, parent).insertChild(entity, siblingIndex);
        return;
    }

    const worldMatrix = worldMatrixOf(world, entity);
    const local = parent === null ? worldMatrix : LocalToWorld.mul(LocalToWorld.invertAffine(worldMatrixOf(world, parent)), worldMatrix);
    if (previous !== null) unlinkChild(world, entity, previous);
    const link = entityManager.getComponent<Parent>(entity, Parent);
    if (parent === null) {
        if (link !== undefined) {
            entityManager.removeComponent(entity, ParentTransform);
            entityManager.removeComponent(entity, Parent);
        }
        placeRoot(world, entity, siblingIndex);
    } else {
        if (link !== undefined) link.entity = parent;
        else entityManager.addComponent(entity, new Parent(parent));
        linkChild(world, entity, parent, siblingIndex);
    }
    setLocalsFromMatrix(world, entity, local);
}

function topmostOf(world: World, entities: readonly Entity[]): Entity[] {
    const listed = new Set(entities);
    const topmost: Entity[] = [];
    for (const entity of entities) {
        if (topmost.includes(entity)) continue;
        let ancestor = parentOf(world, entity);
        let nested = false;
        const visited = new Set<Entity>([entity]);
        while (ancestor !== undefined && !visited.has(ancestor)) {
            if (listed.has(ancestor)) {
                nested = true;
                break;
            }
            visited.add(ancestor);
            ancestor = parentOf(world, ancestor);
        }
        if (!nested) topmost.push(entity);
    }
    return topmost;
}

export function duplicateEntities(world: World, registry: ComponentSchemaRegistry, assets: SceneAssetLoader, entities: readonly Entity[]): Entity[] {
    for (const entity of entities) requireSceneEntity(world, entity);
    return topmostOf(world, entities).map(original => {
        const document = serializeEntities(world, registry, [original]).document;
        const parent = parentOf(world, original) ?? null;
        const created = instantiateDocument(world, registry, document, {assets, parent, siblingIndex: siblingIndexOf(world, original) + 1});
        return created.roots[0];
    });
}
