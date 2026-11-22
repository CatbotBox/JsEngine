import type {Entity} from "../../engine/core";
import {isSceneJsonObject} from "../../engine/scene/sceneDocument";
import type {SceneJsonObject, SceneJsonValue} from "../../engine/scene";
import type {EditorFieldEdit, EditorFieldTypeDescription, EditorRequest, EditorResultOf, EditorSceneRef, InstantiateEntitiesRequest} from "../editorProtocol";
import type {ProjectFileOperations} from "./fileUndo";
import {planRestore} from "./hierarchyDrop";
import type {MovePlan, ReadonlySiblingLists, SiblingKey, SiblingLists} from "./hierarchyDrop";

export interface EditorRequester {
    request<R extends EditorRequest>(request: R): Promise<EditorResultOf<R>>;
}

interface MutableEntityRef {
    handle: Entity;
    alive: boolean;
}

export type EntityRef = Readonly<MutableEntityRef>;

export class DeadEntityRefError extends Error {
    public override readonly name = "DeadEntityRefError";

    public constructor(handle: Entity) {
        super(`Entity ${handle} no longer exists, so this step cannot be undone or redone`);
    }
}

export class EntityRefs {
    private readonly byHandle = new Map<Entity, MutableEntityRef>();

    public get size(): number {
        return this.byHandle.size;
    }

    public refOf(handle: Entity): EntityRef {
        const existing = this.byHandle.get(handle);
        if (existing !== undefined) return existing;
        const created: MutableEntityRef = {handle, alive: true};
        this.byHandle.set(handle, created);
        return created;
    }

    public rebind(ref: EntityRef, handle: Entity): void {
        const mutable = ref as MutableEntityRef;
        if (this.byHandle.get(mutable.handle) === mutable) this.byHandle.delete(mutable.handle);
        mutable.handle = handle;
        mutable.alive = true;
        this.byHandle.set(handle, mutable);
    }

    public markDead(ref: EntityRef): void {
        const mutable = ref as MutableEntityRef;
        if (this.byHandle.get(mutable.handle) === mutable) this.byHandle.delete(mutable.handle);
        mutable.alive = false;
    }

    public remap(remap: ReadonlyMap<Entity, Entity>): void {
        const alive = [...this.byHandle.values()];
        this.byHandle.clear();
        for (const ref of alive) {
            const handle = remap.get(ref.handle);
            if (handle === undefined) {
                ref.alive = false;
                continue;
            }
            ref.handle = handle;
            this.byHandle.set(handle, ref);
        }
    }

    public clear(): void {
        this.byHandle.clear();
    }
}

export function handleOf(ref: EntityRef): Entity {
    if (!ref.alive) throw new DeadEntityRefError(ref.handle);
    return ref.handle;
}

export interface ListEntityShape {
    readonly element: EntityValueShape;
}

export interface StructEntityShape {
    readonly members: ReadonlyMap<string, EntityValueShape>;
}

export type EntityValueShape = boolean | ListEntityShape | StructEntityShape;

export const HOLDS_NO_ENTITIES: EntityValueShape = false;
export const IS_ENTITY: EntityValueShape = true;

export type EntityValueShapes = ReadonlyMap<string, EntityValueShape>;

export function entityValueShapeOf(type: EditorFieldTypeDescription): EntityValueShape {
    switch (type.kind) {
        case "entity":
            return IS_ENTITY;
        case "list": {
            const element = entityValueShapeOf(type.element);
            return element === HOLDS_NO_ENTITIES ? HOLDS_NO_ENTITIES : {element};
        }
        case "struct": {
            const members = new Map<string, EntityValueShape>();
            for (const field of type.fields) {
                const shape = entityValueShapeOf(field);
                if (shape !== HOLDS_NO_ENTITIES) members.set(field.key, shape);
            }
            return members.size === 0 ? HOLDS_NO_ENTITIES : {members};
        }
        default:
            return HOLDS_NO_ENTITIES;
    }
}

export type StoredValue =
    | {readonly kind: "json", readonly value: SceneJsonValue}
    | {readonly kind: "entity", readonly ref: EntityRef | null}
    | {readonly kind: "list", readonly items: readonly StoredValue[]}
    | {readonly kind: "struct", readonly value: SceneJsonObject, readonly members: StoredValues};

export type StoredValues = ReadonlyMap<string, StoredValue>;

function storedEntityOf(refs: EntityRefs, value: SceneJsonValue): StoredValue {
    if (typeof value === "number") return {kind: "entity", ref: refs.refOf(value as Entity)};
    if (value === null) return {kind: "entity", ref: null};
    return {kind: "json", value};
}

export function storedValueOf(refs: EntityRefs, value: SceneJsonValue, shape: EntityValueShape): StoredValue {
    if (typeof shape === "boolean") return shape === IS_ENTITY ? storedEntityOf(refs, value) : {kind: "json", value};
    if ("element" in shape) {
        return Array.isArray(value) ? {kind: "list", items: value.map(item => storedValueOf(refs, item, shape.element))} : {kind: "json", value};
    }
    if (!isSceneJsonObject(value)) return {kind: "json", value};
    const members = new Map<string, StoredValue>();
    for (const [key, memberShape] of shape.members) {
        const member = value[key];
        if (member !== undefined) members.set(key, storedValueOf(refs, member, memberShape));
    }
    return {kind: "struct", value, members};
}

export function jsonOfStoredValue(stored: StoredValue): SceneJsonValue {
    switch (stored.kind) {
        case "json":
            return stored.value;
        case "entity":
            return stored.ref === null ? null : handleOf(stored.ref);
        case "list":
            return stored.items.map(jsonOfStoredValue);
        case "struct":
            return {...stored.value, ...jsonOfStoredValues(stored.members)};
    }
}

export function storedValuesOf(refs: EntityRefs, values: Readonly<Record<string, SceneJsonValue>>, shapes: EntityValueShapes): StoredValues {
    const stored = new Map<string, StoredValue>();
    for (const [key, value] of Object.entries(values)) stored.set(key, storedValueOf(refs, value, shapes.get(key) ?? HOLDS_NO_ENTITIES));
    return stored;
}

export function jsonOfStoredValues(values: StoredValues): SceneJsonObject {
    const json: SceneJsonObject = {};
    for (const [key, stored] of values) json[key] = jsonOfStoredValue(stored);
    return json;
}

export interface UndoContext {
    readonly client: EditorRequester;
    readonly refs: EntityRefs;
    readonly files: ProjectFileOperations;
}

export interface UndoCommand {
    readonly label: string;

    undo(context: UndoContext): Promise<void>;

    redo(context: UndoContext): Promise<void>;
}

export interface FieldChange {
    readonly entity: Entity;
    readonly typeName: string;
    readonly key: string;
    readonly before: SceneJsonValue;
    readonly after: SceneJsonValue;
    readonly entityShape: EntityValueShape;
}

interface StoredFieldChange {
    readonly ref: EntityRef;
    readonly typeName: string;
    readonly key: string;
    readonly before: StoredValue;
    readonly after: StoredValue;
}

type ChangeSide = "before" | "after";

export const PARENT_TYPE_NAME = "Parent";

export class FieldsCommand implements UndoCommand {
    public constructor(public readonly label: string, public readonly changes: readonly StoredFieldChange[]) {
    }

    public static record(refs: EntityRefs, label: string, changes: readonly FieldChange[]): FieldsCommand {
        return new FieldsCommand(label, changes.map(change => ({
            ref: refs.refOf(change.entity),
            typeName: change.typeName,
            key: change.key,
            before: storedValueOf(refs, change.before, change.entityShape),
            after: storedValueOf(refs, change.after, change.entityShape),
        })));
    }

    public undo(context: UndoContext): Promise<void> {
        return this.apply(context, "before");
    }

    public redo(context: UndoContext): Promise<void> {
        return this.apply(context, "after");
    }

    public merged(later: FieldsCommand): FieldsCommand {
        const changes = [...this.changes];
        for (const change of later.changes) {
            const index = changes.findIndex(existing => existing.ref === change.ref && existing.typeName === change.typeName && existing.key === change.key);
            if (index >= 0) changes[index] = {...changes[index], after: change.after};
            else changes.push(change);
        }
        return new FieldsCommand(this.label, changes);
    }

    private async apply(context: UndoContext, side: ChangeSide): Promise<void> {
        const batched: EditorFieldEdit[] = [];
        const separate: EditorFieldEdit[] = [];
        for (const change of this.changes) {
            const edit: EditorFieldEdit = {entity: handleOf(change.ref), typeName: change.typeName, key: change.key, value: jsonOfStoredValue(change[side])};
            (change.typeName === PARENT_TYPE_NAME ? separate : batched).push(edit);
        }
        if (batched.length > 0) await context.client.request({op: "setFields", edits: batched});
        for (const edit of separate) await context.client.request({op: "setField", ...edit});
    }
}

export class RenameCommand implements UndoCommand {
    public constructor(public readonly label: string, private readonly ref: EntityRef, private readonly before: string | null, private readonly after: string | null) {
    }

    public async undo(context: UndoContext): Promise<void> {
        await context.client.request({op: "renameEntity", entity: handleOf(this.ref), name: this.before});
    }

    public async redo(context: UndoContext): Promise<void> {
        await context.client.request({op: "renameEntity", entity: handleOf(this.ref), name: this.after});
    }
}

export class EnabledCommand implements UndoCommand {
    public constructor(public readonly label: string, private readonly ref: EntityRef, private readonly before: boolean, private readonly after: boolean) {
    }

    public async undo(context: UndoContext): Promise<void> {
        await context.client.request({op: "setEnabled", entity: handleOf(this.ref), enabled: this.before});
    }

    public async redo(context: UndoContext): Promise<void> {
        await context.client.request({op: "setEnabled", entity: handleOf(this.ref), enabled: this.after});
    }
}

export class ComponentPresenceCommand implements UndoCommand {
    public constructor(
        public readonly label: string,
        private readonly ref: EntityRef,
        private readonly typeName: string,
        private readonly values: StoredValues,
        private readonly presentAfter: boolean,
    ) {
    }

    public undo(context: UndoContext): Promise<void> {
        return this.presentAfter ? this.remove(context) : this.add(context);
    }

    public redo(context: UndoContext): Promise<void> {
        return this.presentAfter ? this.add(context) : this.remove(context);
    }

    private async add(context: UndoContext): Promise<void> {
        await context.client.request({op: "addComponent", entity: handleOf(this.ref), typeName: this.typeName, values: jsonOfStoredValues(this.values)});
    }

    private async remove(context: UndoContext): Promise<void> {
        await context.client.request({op: "removeComponent", entity: handleOf(this.ref), typeName: this.typeName});
    }
}

export interface RecordedSubtree {
    readonly root: EntityRef;
    readonly entities: readonly EntityRef[];
    readonly documentText: string;
    readonly parent: EntityRef | null;
    readonly siblingIndex: number;
    readonly scene?: EditorSceneRef;
}

export interface SubtreeRecord {
    readonly root: Entity;
    readonly entitiesInCreationOrder: readonly Entity[];
    readonly documentText: string;
    readonly parent: Entity | null;
    readonly siblingIndex: number;
    readonly scene?: EditorSceneRef;
}

export function recordSubtree(refs: EntityRefs, record: SubtreeRecord): RecordedSubtree {
    const recorded: RecordedSubtree = {
        root: refs.refOf(record.root),
        entities: record.entitiesInCreationOrder.map(entity => refs.refOf(entity)),
        documentText: record.documentText,
        parent: record.parent === null ? null : refs.refOf(record.parent),
        siblingIndex: record.siblingIndex,
    };
    return record.scene === undefined ? recorded : {...recorded, scene: record.scene};
}

export class ExistenceCommand implements UndoCommand {
    public constructor(public readonly label: string, private readonly subtrees: readonly RecordedSubtree[], private readonly presentAfter: boolean) {
    }

    public undo(context: UndoContext): Promise<void> {
        return this.presentAfter ? this.destroy(context) : this.instantiate(context);
    }

    public redo(context: UndoContext): Promise<void> {
        return this.presentAfter ? this.instantiate(context) : this.destroy(context);
    }

    private async destroy(context: UndoContext): Promise<void> {
        for (const subtree of this.subtrees) {
            await context.client.request({op: "destroyEntity", entity: handleOf(subtree.root)});
            for (const ref of subtree.entities) context.refs.markDead(ref);
            context.refs.markDead(subtree.root);
        }
    }

    private async instantiate(context: UndoContext): Promise<void> {
        const ordered = [...this.subtrees].sort((a, b) => a.siblingIndex - b.siblingIndex);
        for (const subtree of ordered) {
            const parent = subtree.parent === null ? null : handleOf(subtree.parent);
            const request: InstantiateEntitiesRequest = parent === null && subtree.scene !== undefined
                ? {op: "instantiateEntities", documentText: subtree.documentText, parent, siblingIndex: subtree.siblingIndex, scene: subtree.scene}
                : {op: "instantiateEntities", documentText: subtree.documentText, parent, siblingIndex: subtree.siblingIndex};
            const created = await context.client.request(request);
            if (created.entities.length === subtree.entities.length) {
                subtree.entities.forEach((ref, index) => context.refs.rebind(ref, created.entities[index]));
                continue;
            }
            const root = created.roots[0];
            if (root !== undefined) context.refs.rebind(subtree.root, root);
        }
    }
}

export interface StoredSiblingList {
    readonly parent: EntityRef | null;
    readonly children: readonly EntityRef[];
}

function storedSiblingLists(refs: EntityRefs, lists: ReadonlySiblingLists): StoredSiblingList[] {
    return [...lists].map(([parent, children]) => ({
        parent: parent === null ? null : refs.refOf(parent),
        children: children.map(child => refs.refOf(child)),
    }));
}

function resolvedSiblingLists(lists: readonly StoredSiblingList[]): SiblingLists {
    const resolved: SiblingLists = new Map();
    for (const list of lists) {
        const key: SiblingKey = list.parent === null ? null : handleOf(list.parent);
        resolved.set(key, list.children.filter(child => child.alive).map(handleOf));
    }
    return resolved;
}

export class SiblingOrderCommand implements UndoCommand {
    public constructor(public readonly label: string, private readonly before: readonly StoredSiblingList[], private readonly after: readonly StoredSiblingList[]) {
    }

    public static record(refs: EntityRefs, label: string, plan: MovePlan): SiblingOrderCommand {
        return new SiblingOrderCommand(label, storedSiblingLists(refs, plan.before), storedSiblingLists(refs, plan.after));
    }

    public undo(context: UndoContext): Promise<void> {
        return this.restore(context, this.after, this.before);
    }

    public redo(context: UndoContext): Promise<void> {
        return this.restore(context, this.before, this.after);
    }

    private async restore(context: UndoContext, current: readonly StoredSiblingList[], target: readonly StoredSiblingList[]): Promise<void> {
        for (const move of planRestore(resolvedSiblingLists(current), resolvedSiblingLists(target))) {
            await context.client.request({op: "setParent", entity: move.entity, parent: move.parent, siblingIndex: move.siblingIndex});
        }
    }
}

export class CompositeCommand implements UndoCommand {
    public constructor(public readonly label: string, public readonly commands: readonly UndoCommand[]) {
    }

    public async undo(context: UndoContext): Promise<void> {
        for (let i = this.commands.length - 1; i >= 0; i--) await this.commands[i].undo(context);
    }

    public async redo(context: UndoContext): Promise<void> {
        for (const command of this.commands) await command.redo(context);
    }
}

export function mergeCommands(earlier: UndoCommand, later: UndoCommand): UndoCommand {
    if (earlier instanceof FieldsCommand && later instanceof FieldsCommand) return earlier.merged(later);
    const parts = earlier instanceof CompositeCommand ? [...earlier.commands] : [earlier];
    const last = parts[parts.length - 1];
    if (last instanceof FieldsCommand && later instanceof FieldsCommand) parts[parts.length - 1] = last.merged(later);
    else parts.push(later);
    return new CompositeCommand(earlier.label, parts);
}

export const MAX_UNDO_ENTRIES = 200;

interface UndoEntry {
    command: UndoCommand;
    coalesceKey: string | undefined;
}

export interface UndoHistory {
    readonly doneOldestFirst: readonly string[];
    readonly undoneNextFirst: readonly string[];
}

const INITIAL_DEPTH = 0;

export class UndoStack {
    private readonly done: UndoEntry[] = [];
    private readonly undone: UndoEntry[] = [];
    private readonly listeners = new Set<() => void>();

    public constructor(private readonly context: UndoContext, private readonly limit: number = MAX_UNDO_ENTRIES) {
    }

    public get canUndo(): boolean {
        return this.done.length > 0;
    }

    public get canRedo(): boolean {
        return this.undone.length > 0;
    }

    public get undoLabel(): string | undefined {
        return this.done[this.done.length - 1]?.command.label;
    }

    public get redoLabel(): string | undefined {
        return this.undone[this.undone.length - 1]?.command.label;
    }

    public get depth(): number {
        return this.done.length;
    }

    public get history(): UndoHistory {
        return {
            doneOldestFirst: this.done.map(entry => entry.command.label),
            undoneNextFirst: this.undone.map(entry => entry.command.label).reverse(),
        };
    }

    public async jumpTo(depth: number): Promise<void> {
        const target = Math.min(Math.max(depth, INITIAL_DEPTH), this.done.length + this.undone.length);
        while (this.done.length > target) {
            if (!(await this.undo())) return;
        }
        while (this.done.length < target) {
            if (!(await this.redo())) return;
        }
    }

    public push(command: UndoCommand, coalesceKey?: string): void {
        const top = this.done[this.done.length - 1];
        if (coalesceKey !== undefined && top !== undefined && top.coalesceKey === coalesceKey) {
            top.command = mergeCommands(top.command, command);
        } else {
            this.done.push({command, coalesceKey});
            if (this.done.length > this.limit) this.done.splice(0, this.done.length - this.limit);
        }
        this.undone.length = 0;
        this.changed();
    }

    public closeCoalescing(coalesceKey: string): void {
        const top = this.done[this.done.length - 1];
        if (top !== undefined && top.coalesceKey === coalesceKey) top.coalesceKey = undefined;
    }

    public async undo(): Promise<boolean> {
        const entry = this.done.pop();
        if (entry === undefined) return false;
        entry.coalesceKey = undefined;
        try {
            await entry.command.undo(this.context);
        } catch (error) {
            this.changed();
            throw error;
        }
        this.undone.push(entry);
        this.changed();
        return true;
    }

    public async redo(): Promise<boolean> {
        const entry = this.undone.pop();
        if (entry === undefined) return false;
        try {
            await entry.command.redo(this.context);
        } catch (error) {
            this.changed();
            throw error;
        }
        this.done.push(entry);
        this.changed();
        return true;
    }

    public clear(): void {
        this.done.length = 0;
        this.undone.length = 0;
        this.context.refs.clear();
        this.changed();
    }

    public onChange(listener: () => void): () => void {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    private changed(): void {
        for (const listener of this.listeners) listener();
    }
}
