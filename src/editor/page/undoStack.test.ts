import {beforeEach, describe, expect, test} from "../../engine/testing/harness";
import type {Entity} from "../../engine/core";
import type {SceneJsonValue} from "../../engine/scene";
import type {EditorRequest, EditorResultOf} from "../editorProtocol";
import {planMoves, siblingListsOf} from "./hierarchyDrop";
import {
    ComponentPresenceCommand,
    DeadEntityRefError,
    EntityRefs,
    ExistenceCommand,
    FieldsCommand,
    recordSubtree,
    RenameCommand,
    SiblingOrderCommand,
    storedValuesOf,
    UndoStack,
} from "./undoStack";
import type {EditorRequester, FieldChange, UndoContext} from "./undoStack";

const FIRST_NEW_HANDLE = 100;
const ENTITY = 1 as Entity;
const OTHER = 2 as Entity;
const NO_ENTITY_KEYS: ReadonlySet<string> = new Set();

class FakeWorld implements EditorRequester {
    public readonly requests: string[] = [];
    public readonly fields = new Map<string, SceneJsonValue>();
    public readonly live = new Set<Entity>([ENTITY, OTHER]);
    private nextHandle = FIRST_NEW_HANDLE;

    public request<R extends EditorRequest>(request: R): Promise<EditorResultOf<R>> {
        return Promise.resolve(this.perform(request) as EditorResultOf<R>);
    }

    private perform(request: EditorRequest): unknown {
        switch (request.op) {
            case "setFields":
                for (const edit of request.edits) this.set(edit.entity, `${edit.typeName}.${edit.key}`, edit.value);
                this.requests.push(`setFields ${request.edits.map(edit => `${edit.entity}:${edit.typeName}.${edit.key}=${JSON.stringify(edit.value)}`).join(" ")}`);
                return {values: []};
            case "renameEntity":
                this.set(request.entity, "@name", request.name);
                this.requests.push(`rename ${request.entity} ${request.name}`);
                return {};
            case "addComponent":
                this.requests.push(`add ${request.entity} ${request.typeName} ${JSON.stringify(request.values)}`);
                return {};
            case "removeComponent":
                this.requests.push(`remove ${request.entity} ${request.typeName}`);
                return {};
            case "destroyEntity":
                this.requireLive(request.entity);
                this.live.delete(request.entity);
                this.requests.push(`destroy ${request.entity}`);
                return {destroyed: [request.entity]};
            case "instantiateEntities": {
                const count = (JSON.parse(request.documentText) as {entities: unknown[]}).entities.length;
                const entities = Array.from({length: count}, () => this.nextHandle++ as Entity);
                for (const entity of entities) this.live.add(entity);
                this.requests.push(`instantiate ${entities.join(",")} under ${request.parent} at ${request.siblingIndex}`);
                return {roots: [entities[0]], entities, report: {}};
            }
            case "setParent":
                this.requests.push(`setParent ${request.entity} ${request.parent} ${request.siblingIndex}`);
                return {};
            default:
                throw new Error(`The fake world does not handle ${request.op}`);
        }
    }

    private set(entity: Entity, path: string, value: SceneJsonValue): void {
        this.requireLive(entity);
        this.fields.set(`${entity}/${path}`, value);
    }

    private requireLive(entity: Entity): void {
        if (!this.live.has(entity)) throw new Error(`No entity ${entity}`);
    }
}

function change(entity: Entity, before: SceneJsonValue, after: SceneJsonValue, key = "xyz"): FieldChange {
    return {entity, typeName: "LocalPosition", key, before, after, entityValued: false};
}

describe("undo stack", () => {
    let world: FakeWorld;
    let refs: EntityRefs;
    let stack: UndoStack;

    beforeEach(() => {
        world = new FakeWorld();
        refs = new EntityRefs();
        const context: UndoContext = {client: world, refs};
        stack = new UndoStack(context);
    });

    test("a field change undoes to its old value and redoes to its new one", async () => {
        stack.push(FieldsCommand.record(refs, "Move", [change(ENTITY, [0, 0, 0], [1, 2, 3])]));
        expect(stack.canUndo).toBe(true);
        expect(await stack.undo()).toBe(true);
        expect(world.fields.get("1/LocalPosition.xyz")).toEqual([0, 0, 0]);
        expect(stack.canRedo).toBe(true);
        await stack.redo();
        expect(world.fields.get("1/LocalPosition.xyz")).toEqual([1, 2, 3]);
        expect(await stack.redo()).toBe(false);
    });

    test("pushes with the same coalesce key merge into one entry that keeps the first old value", async () => {
        stack.push(FieldsCommand.record(refs, "Scrub", [change(ENTITY, 0, 1, "x")]), "scrub:1");
        stack.push(FieldsCommand.record(refs, "Scrub", [change(ENTITY, 1, 2, "x")]), "scrub:1");
        stack.push(FieldsCommand.record(refs, "Scrub", [change(OTHER, 5, 6, "x")]), "scrub:1");
        expect(stack.depth).toBe(1);
        await stack.undo();
        expect(world.fields.get("1/LocalPosition.x")).toBe(0);
        expect(world.fields.get("2/LocalPosition.x")).toBe(5);
        await stack.redo();
        expect(world.fields.get("1/LocalPosition.x")).toBe(2);
    });

    test("closing a coalesce key starts a new entry for the next gesture, and a push clears redo", async () => {
        stack.push(FieldsCommand.record(refs, "Drag", [change(ENTITY, 0, 1, "x")]), "drag:1");
        stack.closeCoalescing("drag:1");
        stack.push(FieldsCommand.record(refs, "Drag", [change(ENTITY, 1, 2, "x")]), "drag:1");
        expect(stack.depth).toBe(2);
        await stack.undo();
        expect(stack.canRedo).toBe(true);
        stack.push(new RenameCommand("Rename", refs.refOf(ENTITY), null, "Ship"));
        expect(stack.canRedo).toBe(false);
    });

    test("undoing a destroy instantiates new handles that every older entry follows", async () => {
        stack.push(FieldsCommand.record(refs, "Move", [change(ENTITY, [0, 0, 0], [5, 5, 5])]));
        const documentText = JSON.stringify({entities: [{}]});
        const subtree = recordSubtree(refs, {root: ENTITY, entitiesInCreationOrder: [ENTITY], documentText, parent: null, siblingIndex: 3});
        await world.request({op: "destroyEntity", entity: ENTITY});
        stack.push(new ExistenceCommand("Delete", [subtree], false));
        refs.markDead(subtree.root);

        await stack.undo();
        expect(world.requests[world.requests.length - 1]).toBe("instantiate 100 under null at 3");
        await stack.undo();
        expect(world.fields.get("100/LocalPosition.xyz")).toEqual([0, 0, 0]);
        await stack.redo();
        await stack.redo();
        expect(world.requests[world.requests.length - 1]).toBe("destroy 100");
        expect(world.live.has(100 as Entity)).toBe(false);
    });

    test("a remap after a session swap moves live references and kills the rest", async () => {
        stack.push(FieldsCommand.record(refs, "Move", [change(OTHER, 0, 1, "x")]));
        stack.push(FieldsCommand.record(refs, "Move", [change(ENTITY, 0, 1, "x")]));
        world.live.add(7 as Entity);
        refs.remap(new Map([[ENTITY, 7 as Entity]]));
        await stack.undo();
        expect(world.fields.get("7/LocalPosition.x")).toBe(0);
        let failure: unknown;
        try {
            await stack.undo();
        } catch (error) {
            failure = error;
        }
        expect(failure).toBeInstanceOf(DeadEntityRefError);
        expect(stack.canUndo).toBe(false);
        expect(stack.canRedo).toBe(true);
    });

    test("entity-valued fields store references, so they follow remaps too", async () => {
        stack.push(FieldsCommand.record(refs, "Target", [{entity: ENTITY, typeName: "Follow", key: "target", before: OTHER, after: null, entityValued: true}]));
        world.live.add(8 as Entity);
        world.live.add(9 as Entity);
        refs.remap(new Map([[ENTITY, 8 as Entity], [OTHER, 9 as Entity]]));
        await stack.undo();
        expect(world.fields.get("8/Follow.target")).toBe(9);
    });

    test("removing a component undoes by adding it back with its values", async () => {
        const values = storedValuesOf(refs, {tint: "#ff0000", opacity: 0.5}, NO_ENTITY_KEYS);
        stack.push(new ComponentPresenceCommand("Remove Sprite", refs.refOf(ENTITY), "Sprite", values, false));
        await stack.undo();
        expect(world.requests).toEqual([`add 1 Sprite {"tint":"#ff0000","opacity":0.5}`]);
        await stack.redo();
        expect(world.requests[1]).toBe("remove 1 Sprite");
    });

    test("a reorder undoes by restoring the old sibling lists", async () => {
        const A = 11 as Entity, B = 12 as Entity, C = 13 as Entity;
        const lists = siblingListsOf([{entity: A, parent: null, siblingIndex: 0}, {entity: B, parent: null, siblingIndex: 1}, {entity: C, parent: null, siblingIndex: 2}]);
        const plan = planMoves(lists, [A], {parent: null, before: null});
        stack.push(SiblingOrderCommand.record(refs, "Reorder", plan));
        await stack.undo();
        expect(world.requests).toEqual(["setParent 11 null 0"]);
        await stack.redo();
        expect(world.requests[1]).toBe("setParent 12 null 0");
    });

    test("the oldest entries are dropped past the limit", () => {
        const small = new UndoStack({client: world, refs}, 2);
        for (let i = 0; i < 5; i++) small.push(new RenameCommand(`Rename ${i}`, refs.refOf(ENTITY), null, `name ${i}`));
        expect(small.depth).toBe(2);
        expect(small.undoLabel).toBe("Rename 4");
    });
});
