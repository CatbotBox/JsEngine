import {Resource} from "../core";
import type {Component, Entity, World} from "../core";
import {ComponentType} from "../core/componentType";
import {getOwner} from "../core/ownership";
import type {AnyCT} from "../util/tokenUtils";
import {Parent} from "../translation/parent";
import {Children} from "../translation/children";

export class SceneRootOrder extends Resource {
    public roots: Entity[] = [];
}

export interface SiblingOrder {
    readonly parentOf: ReadonlyMap<Entity, Entity>;
    readonly childrenOf: ReadonlyMap<Entity, readonly Entity[]>;
    readonly roots: readonly Entity[];
    readonly siblingIndexOf: ReadonlyMap<Entity, number>;
}

const NO_CHILDREN: readonly Entity[] = [];

export function untrackedComponentOf<T extends Component>(world: World, entity: Entity, type: AnyCT): T | undefined {
    const archetype = getOwner(world, entity);
    if (archetype === undefined) return undefined;
    const row = archetype.getIndexOfEntity(entity);
    if (row === undefined) return undefined;
    return archetype.getColumn(type)?.get(row) as T | undefined;
}

export function parentEntityOf(world: World, entity: Entity): Entity | undefined {
    const link = untrackedComponentOf<Parent>(world, entity, ComponentType.of(Parent));
    if (link === undefined || link.entity === entity || !world.entityManager.exists(link.entity)) return undefined;
    return link.entity;
}

export function childEntitiesOf(world: World, entity: Entity): readonly Entity[] {
    return untrackedComponentOf<Children>(world, entity, ComponentType.of(Children))?.children ?? NO_CHILDREN;
}

export function orderedSceneRoots(world: World, rootsInCreationOrder: readonly Entity[], explicitOrder?: readonly Entity[]): Entity[] {
    const listed = explicitOrder ?? world.resources.tryGet(SceneRootOrder)?.roots ?? NO_CHILDREN;
    if (listed.length === 0) return [...rootsInCreationOrder];
    const isRoot = new Set(rootsInCreationOrder);
    const ordered: Entity[] = [];
    const placed = new Set<Entity>();
    for (const root of listed) {
        if (!isRoot.has(root) || placed.has(root)) continue;
        placed.add(root);
        ordered.push(root);
    }
    for (const root of rootsInCreationOrder) if (!placed.has(root)) ordered.push(root);
    return ordered;
}

export function setSceneRootOrder(world: World, roots: readonly Entity[]): void {
    world.resources.getOrCreate(SceneRootOrder).roots = [...roots];
}

export function siblingOrderOf(world: World, entitiesInCreationOrder: readonly Entity[], explicitRootOrder?: readonly Entity[]): SiblingOrder {
    const members = new Set(entitiesInCreationOrder);
    const parentOf = new Map<Entity, Entity>();
    const linkedChildren = new Map<Entity, Entity[]>();
    for (const entity of entitiesInCreationOrder) {
        const parent = parentEntityOf(world, entity);
        if (parent === undefined || !members.has(parent)) continue;
        parentOf.set(entity, parent);
        let linked = linkedChildren.get(parent);
        if (linked === undefined) linkedChildren.set(parent, linked = []);
        linked.push(entity);
    }

    const childrenOf = new Map<Entity, readonly Entity[]>();
    for (const [parent, linked] of linkedChildren) {
        const ordered: Entity[] = [];
        const placed = new Set<Entity>();
        for (const child of childEntitiesOf(world, parent)) {
            if (parentOf.get(child) !== parent || placed.has(child)) continue;
            placed.add(child);
            ordered.push(child);
        }
        for (const child of linked) if (!placed.has(child)) ordered.push(child);
        childrenOf.set(parent, ordered);
    }

    const roots = orderedSceneRoots(world, entitiesInCreationOrder.filter(entity => !parentOf.has(entity)), explicitRootOrder);
    const siblingIndexOf = new Map<Entity, number>();
    roots.forEach((root, index) => siblingIndexOf.set(root, index));
    for (const children of childrenOf.values()) children.forEach((child, index) => siblingIndexOf.set(child, index));
    return {parentOf, childrenOf, roots, siblingIndexOf};
}
