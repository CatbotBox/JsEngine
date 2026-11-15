import {afterEach, describe, expect, test} from "../../engine/testing/harness";
import {EntityCommandBufferSystem, Resource, System} from "../../engine/core";
import type {Entity} from "../../engine/core";
import {LocalPosition} from "../../engine/translation/localPosition";
import {RenderingSystemGroup} from "../../engine/rendering/renderingSystemGroup";
import {resourceSchema} from "../../engine/scene";
import type {ComponentSchemaRegistry} from "../../engine/scene";
import type {EditorEvent} from "../editorProtocol";
import {ask, byName, disposeEditorWorlds, editorWorld, failureOf, fieldsOf, framesPass, SETTLE_FRAMES, sleep, TICK_MS, waitUntil} from "./editorServiceTestHarness";
import type {Harnessed} from "./editorServiceTestHarness";

const SLOW_TICK_MS = 60_000;
const SAVED_WAVE = 4;
const PLAY_WAVE = 6;

class Scoreboard extends Resource {
    public static readonly schema = resourceSchema(Scoreboard, "Scoreboard").integer("wave").build();
    public wave = 1;
}

class FailingGameplaySystem extends System {
    public static failNext = false;

    public onUpdate(): void {
        if (FailingGameplaySystem.failNext) {
            FailingGameplaySystem.failNext = false;
            throw new Error("gameplay exploded");
        }
    }
}

class FailingRenderSystem extends System {
    public static failNext = false;

    override systemGroup() {
        return RenderingSystemGroup;
    }

    public onUpdate(): void {
        if (FailingRenderSystem.failNext) {
            FailingRenderSystem.failNext = false;
            throw new Error("render exploded");
        }
    }
}

afterEach(disposeEditorWorlds);

function registerScoreboard(registry: ComponentSchemaRegistry): void {
    registry.registerResourceClass(Scoreboard);
}

function eventsOfKind<K extends EditorEvent["kind"]>(harnessed: Harnessed, kind: K): Extract<EditorEvent, {kind: K}>[] {
    return harnessed.events.filter((event): event is Extract<EditorEvent, {kind: K}> => event.kind === kind);
}

describe("editor events", () => {
    test("console output in the world is forwarded with its level until the service detaches", async () => {
        const harnessed = editorWorld();
        console.warn("hello", {wave: 2});
        console.debug("quiet");
        expect(await waitUntil(() => eventsOfKind(harnessed, "console").length >= 2)).toBe(true);
        const forwarded = eventsOfKind(harnessed, "console").map(event => [event.level, event.text]);
        expect(forwarded).toEqual([["warn", 'hello {"wave":2}'], ["debug", "quiet"]]);
        expect(eventsOfKind(harnessed, "console").every(event => event.timeMs > 0)).toBe(true);
        harnessed.service.detach();
        console.info("after detach");
        await sleep(TICK_MS * SETTLE_FRAMES);
        expect(eventsOfKind(harnessed, "console").length).toBe(2);
    });

    test("mode changes are announced", async () => {
        const harnessed = editorWorld();
        await ask(harnessed, {op: "setMode", mode: "play"});
        await ask(harnessed, {op: "setMode", mode: "edit"});
        expect(await waitUntil(() => eventsOfKind(harnessed, "modeChanged").length >= 2)).toBe(true);
        expect(eventsOfKind(harnessed, "modeChanged").map(event => event.mode)).toEqual(["play", "edit"]);
    });
});

describe("editor robustness", () => {
    test("a DebugWorld system error posts worldStopped and blocks play and step until a scene loads", async () => {
        const harnessed = editorWorld(world => {
            world.getOrCreateSystem(FailingGameplaySystem);
            world.entityManager.createEntity("only", [new LocalPosition()]);
        }, {debugWorld: true});
        const sceneText = (await ask(harnessed, {op: "saveScene"})).sceneText;
        FailingGameplaySystem.failNext = true;
        await ask(harnessed, {op: "setMode", mode: "play"});
        expect(await waitUntil(() => eventsOfKind(harnessed, "worldStopped").length > 0)).toBe(true);
        expect(eventsOfKind(harnessed, "worldStopped")[0].error).toBe("error while running system: FailingGameplaySystem Error: Error: gameplay exploded");
        expect(harnessed.service.worldStoppedError).toBeDefined();

        expect(await failureOf(ask(harnessed, {op: "setMode", mode: "play"})))
            .toBe('Editor request "setMode" failed: Cannot play: the world stopped (error while running system: FailingGameplaySystem Error: Error: gameplay exploded); load a scene or import a snapshot to reset it');
        expect((await failureOf(ask(harnessed, {op: "step"}))).startsWith('Editor request "step" failed: Cannot step: the world stopped')).toBe(true);
        const stopped = await ask(harnessed, {op: "setMode", mode: "edit"});
        expect(stopped.worldStoppedError).toBe("error while running system: FailingGameplaySystem Error: Error: gameplay exploded");

        await ask(harnessed, {op: "loadScene", sceneText});
        expect(harnessed.service.worldStoppedError).toBeUndefined();
        expect((await ask(harnessed, {op: "setMode", mode: "play"})).worldStoppedError).toBe(null);
    });

    test("an error thrown out of a plain World's tick stops ticking and posts worldStopped", async () => {
        const harnessed = editorWorld(world => {
            world.getOrCreateSystem(FailingRenderSystem);
        });
        expect(await framesPass(harnessed)).toBe(true);
        FailingRenderSystem.failNext = true;
        expect(await waitUntil(() => eventsOfKind(harnessed, "worldStopped").length > 0)).toBe(true);
        expect(eventsOfKind(harnessed, "worldStopped")[0].error).toBe("render exploded");
        const frames = harnessed.probe.frames;
        expect(await waitUntil(() => eventsOfKind(harnessed, "console").some(event => event.level === "error"))).toBe(true);
        expect(harnessed.probe.frames).toBe(frames);
    });

    test("stopping discards command-buffer work queued during play", async () => {
        const harnessed = editorWorld(() => undefined, {tickMs: SLOW_TICK_MS});
        await ask(harnessed, {op: "setMode", mode: "play"});
        const buffer = harnessed.world.getOrCreateSystem(EntityCommandBufferSystem).getEntityCommandBuffer();
        const late = buffer.createEntity("late", [new LocalPosition()]);
        expect(buffer.isEmpty).toBe(false);
        await ask(harnessed, {op: "setMode", mode: "edit"});
        expect(buffer.isEmpty).toBe(true);
        expect(harnessed.world.entityManager.exists(late)).toBe(false);
        harnessed.world.step();
        expect((await ask(harnessed, {op: "listEntities"})).entities.map(entity => entity.name)).toEqual([]);
    });
});

describe("editor snapshots", () => {
    test("an edit-mode snapshot moves the scene and its registered resources into another world", async () => {
        const source = editorWorld(world => {
            world.entityManager.createEntity("kept", [new LocalPosition(1, 2, 3)]);
            world.resources.getOrCreate(Scoreboard).wave = SAVED_WAVE;
        }, {register: registerScoreboard});
        const exported = await ask(source, {op: "exportSnapshot"});
        expect([exported.mode, exported.gameplayTicks, exported.editSnapshotText]).toEqual(["edit", 0, undefined]);
        expect(exported.entities.length).toBe(1);

        const target = editorWorld(world => {
            world.entityManager.createEntity("replaced", [new LocalPosition()]);
        }, {register: registerScoreboard});
        const imported = await ask(target, {op: "importSnapshot", documentText: exported.documentText, mode: "edit"});
        expect(imported.entities.length).toBe(1);
        const listed = (await ask(target, {op: "listEntities"})).entities;
        expect(listed.map(entity => entity.name)).toEqual(["kept"]);
        expect(listed[0].entity).toBe(imported.entities[0]);
        expect(target.world.resources.get(Scoreboard).wave).toBe(SAVED_WAVE);
    });

    test("a play-mode snapshot keeps playing after import and stop restores the edit snapshot onto the imported handles", async () => {
        const source = editorWorld(world => {
            world.entityManager.createEntity("mover", [new LocalPosition(1, 1, 1)]);
            world.entityManager.createEntity("spawnedLater", [new LocalPosition()]);
            world.resources.getOrCreate(Scoreboard).wave = SAVED_WAVE;
        }, {register: registerScoreboard});
        const moverHandle = byName((await ask(source, {op: "listEntities"})).entities, "mover")!.entity;
        await ask(source, {op: "setMode", mode: "play"});
        await ask(source, {op: "setField", entity: moverHandle, typeName: "LocalPosition", key: "xyz", value: [9, 9, 9]});
        source.world.resources.get(Scoreboard).wave = PLAY_WAVE;
        await ask(source, {op: "createEntity", name: "fromPlay"});
        const exported = await ask(source, {op: "exportSnapshot"});
        expect(exported.mode).toBe("play");
        expect(exported.editSnapshotRecords).toEqual([0, 1]);

        const target = editorWorld(() => undefined, {register: registerScoreboard});
        const imported = await ask(target, {
            op: "importSnapshot",
            documentText: exported.documentText,
            editSnapshotText: exported.editSnapshotText,
            editSnapshotRecords: exported.editSnapshotRecords,
            mode: "play",
            gameplayTicks: exported.gameplayTicks,
        });
        expect(target.service.mode).toBe("play");
        expect(target.service.gameplayTicks >= exported.gameplayTicks).toBe(true);
        const importedMover = imported.entities[0];
        expect(fieldsOf(await ask(target, {op: "getEntity", entity: importedMover}), "LocalPosition")).toEqual({xyz: [9, 9, 9]});
        expect(target.world.resources.get(Scoreboard).wave).toBe(PLAY_WAVE);

        await ask(target, {op: "setMode", mode: "edit"});
        const restored = (await ask(target, {op: "listEntities"})).entities;
        expect(restored.map(entity => entity.name)).toEqual(["mover", "spawnedLater"]);
        expect(byName(restored, "mover")?.entity).toBe(importedMover);
        expect(fieldsOf(await ask(target, {op: "getEntity", entity: importedMover}), "LocalPosition")).toEqual({xyz: [1, 1, 1]});
        expect(target.world.resources.get(Scoreboard).wave).toBe(SAVED_WAVE);
    });

    test("importing reports schema changes and skips unknown types instead of failing", async () => {
        const target = editorWorld();
        const documentText = JSON.stringify({
            format: "jsengine-scene",
            version: 1,
            entities: [{id: 1, name: "old", enabled: true, components: {LocalPosition: {xyz: [1, 2, 3], retired: true}, Gone: {}}}],
            resources: {Vanished: {count: 1}},
        });
        const imported = await ask(target, {op: "importSnapshot", documentText, mode: "edit"});
        expect(imported.report.changedSchemas).toEqual([{typeName: "LocalPosition", addedKeys: [], removedKeys: ["retired"]}]);
        expect(imported.report.skippedComponentTypes).toEqual([{typeName: "Gone", entityCount: 1}]);
        expect(imported.report.skippedResourceTypes).toEqual(["Vanished"]);
        expect(fieldsOf(await ask(target, {op: "getEntity", entity: imported.entities[0] as Entity}), "LocalPosition")).toEqual({xyz: [1, 2, 3]});
    });

    test("describeSchemas lists registered resources", async () => {
        const harnessed = editorWorld(() => undefined, {register: registerScoreboard});
        expect((await ask(harnessed, {op: "describeSchemas"})).resources).toEqual([
            {typeName: "ActiveScene", fields: [{key: "sceneId", kind: "integer"}, {key: "path", kind: "string", nullable: true}]},
            {typeName: "Scoreboard", fields: [{key: "wave", kind: "integer"}]},
        ]);
    });
});
