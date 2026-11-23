import {afterEach, describe, expect, test} from "../../engine/testing/harness";
import {NULL_ENTITY, QuitSystemGroup, System} from "../../engine/core";
import type {Entity, SystemCtor} from "../../engine/core";
import {LocalPosition} from "../../engine/translation/localPosition";
import {LocalToWorld} from "../../engine/translation/localToWorld";
import type {EditorMode, EditorServiceState, EditorView} from "../editorProtocol";
import {ask, disposeEditorWorlds, editorWorld, fieldsOf, waitUntil} from "./editorServiceTestHarness";
import type {Harnessed} from "./editorServiceTestHarness";

const EDIT_X = 1;
const PLAY_X = 9;
const QUIT_FAILURE = "failed right after requesting the quit";

class QuitRequestingSystem extends System {
    public quitOnNextUpdate = false;
    public failAfterQuitting = false;

    public onUpdate(): void {
        if (!this.quitOnNextUpdate) return;
        this.quitOnNextUpdate = false;
        this.world.requestQuit();
        if (this.failAfterQuitting) throw new Error(QUIT_FAILURE);
    }
}

class RecordPositionOnQuitSystem extends System {
    public watched: Entity = NULL_ENTITY;
    public readonly seenX: number[] = [];

    protected override systemGroup() {
        return QuitSystemGroup;
    }

    public onUpdate(): void {
        this.seenX.push(this.world.entityManager.getComponent<LocalPosition>(this.watched, LocalPosition)!.x);
    }
}

interface QuittingGameOptions {
    readonly gameplaySystems: readonly SystemCtor<System>[];
    readonly debugWorld?: boolean;
}

interface QuittingGame {
    readonly harnessed: Harnessed;
    readonly player: Entity;
    readonly quitter: QuitRequestingSystem;
    readonly recorder: RecordPositionOnQuitSystem;
}

const LISTED_QUIT_SYSTEMS: readonly SystemCtor<System>[] = [QuitRequestingSystem, RecordPositionOnQuitSystem];
const ONLY_QUIT_RECORDER_LISTED: readonly SystemCtor<System>[] = [RecordPositionOnQuitSystem];

afterEach(disposeEditorWorlds);

function quittingGame(options: QuittingGameOptions): QuittingGame {
    let player = NULL_ENTITY;
    const harnessed = editorWorld(world => {
        player = world.entityManager.createEntity("player", [new LocalPosition(EDIT_X, 0, 0), new LocalToWorld()]);
        world.getOrCreateSystem(QuitRequestingSystem);
        world.getOrCreateSystem(RecordPositionOnQuitSystem).watched = player;
    }, {gameplaySystems: options.gameplaySystems, debugWorld: options.debugWorld, drivenFrames: false});
    const world = harnessed.world;
    return {harnessed, player, quitter: world.tryGetSystem(QuitRequestingSystem)!, recorder: world.tryGetSystem(RecordPositionOnQuitSystem)!};
}

function runOneFrame(harnessed: Harnessed): void {
    harnessed.frameAfter(harnessed.world.loopTiming.tickDeltaMs);
}

function quitWithinNextFrame(game: QuittingGame): void {
    game.quitter.quitOnNextUpdate = true;
    runOneFrame(game.harnessed);
}

function serviceState(mode: EditorMode, gameplayTicks: number, view: EditorView): EditorServiceState {
    return {mode, gameplayTicks, view, worldStoppedError: null};
}

function modesReported(harnessed: Harnessed): EditorMode[] {
    return harnessed.events.flatMap(event => event.kind === "modeChanged" ? [event.mode] : []);
}

async function playerPosition(game: QuittingGame): Promise<unknown> {
    return fieldsOf(await ask(game.harnessed, {op: "getEntity", entity: game.player}), "LocalPosition");
}

describe("a game that requests quit in the editor", () => {
    test("during play its quit systems run on the play state, then play stops as Stop does: the edit snapshot returns, the editor keeps running and the next play can quit again", async () => {
        const game = quittingGame({gameplaySystems: LISTED_QUIT_SYSTEMS});
        const {harnessed, player, recorder} = game;
        const {counter, platform, probe, scheduler, service, world} = harnessed;
        await ask(harnessed, {op: "setMode", mode: "play"});
        await ask(harnessed, {op: "setField", entity: player, typeName: "LocalPosition", key: "xyz", value: [PLAY_X, 0, 0]});
        quitWithinNextFrame(game);

        expect(recorder.seenX).toEqual([PLAY_X]);
        expect([service.mode, service.view, service.gameplayTicks]).toEqual(["edit", "scene", 0]);
        expect(await waitUntil(() => modesReported(harnessed).length === 2)).toBe(true);
        expect(modesReported(harnessed)).toEqual(["play", "edit"]);
        expect(await playerPosition(game)).toEqual({xyz: [EDIT_X, 0, 0]});
        expect([platform.quitCount, world.app?.quitPending, scheduler.running]).toEqual([0, false, true]);
        expect(service.worldStoppedError).toBeUndefined();

        const framesBefore = probe.frames;
        const gameplayRunsBefore = counter.runs;
        runOneFrame(harnessed);
        expect([probe.frames, counter.runs]).toEqual([framesBefore + 1, gameplayRunsBefore]);

        expect(await ask(harnessed, {op: "setMode", mode: "play"})).toEqual(serviceState("play", 0, "game"));
        quitWithinNextFrame(game);
        expect(recorder.seenX).toEqual([PLAY_X, EDIT_X]);
        expect(service.mode).toBe("edit");
        expect(platform.quitCount).toBe(0);
    });

    test("during a Step, from paused play or from edit, the quit systems run and the step answers in edit mode with the snapshot restored", async () => {
        const game = quittingGame({gameplaySystems: LISTED_QUIT_SYSTEMS});
        const {harnessed, player, quitter, recorder} = game;
        const {platform, service} = harnessed;
        await ask(harnessed, {op: "setMode", mode: "play"});
        await ask(harnessed, {op: "setMode", mode: "paused"});
        await ask(harnessed, {op: "setField", entity: player, typeName: "LocalPosition", key: "xyz", value: [PLAY_X, 0, 0]});

        quitter.quitOnNextUpdate = true;
        expect(await ask(harnessed, {op: "step"})).toEqual(serviceState("edit", 0, "scene"));
        expect(recorder.seenX).toEqual([PLAY_X]);
        expect(await playerPosition(game)).toEqual({xyz: [EDIT_X, 0, 0]});
        expect(modesReported(harnessed)).toEqual(["play", "paused", "edit"]);

        quitter.quitOnNextUpdate = true;
        expect(await ask(harnessed, {op: "step"})).toEqual(serviceState("edit", 0, "scene"));
        expect(recorder.seenX).toEqual([PLAY_X, EDIT_X]);

        expect(await ask(harnessed, {op: "step"})).toEqual(serviceState("paused", 1, "scene"));
        expect(recorder.seenX).toEqual([PLAY_X, EDIT_X]);
        expect(platform.quitCount).toBe(0);
        expect(service.worldStoppedError).toBeUndefined();
    });

    test("while gameplay is suspended, in edit or paused mode, the request is cleared without running the gated quit systems or leaving the mode", async () => {
        const game = quittingGame({gameplaySystems: ONLY_QUIT_RECORDER_LISTED});
        const {harnessed, recorder} = game;
        const {platform, scheduler, service, world} = harnessed;
        quitWithinNextFrame(game);
        expect([service.mode, recorder.seenX.length, world.app?.quitPending, platform.quitCount, scheduler.running]).toEqual(["edit", 0, false, 0, true]);

        await ask(harnessed, {op: "setMode", mode: "play"});
        await ask(harnessed, {op: "setMode", mode: "paused"});
        quitWithinNextFrame(game);
        expect([service.mode, recorder.seenX.length, world.app?.quitPending, platform.quitCount]).toEqual(["paused", 0, false, 0]);

        await ask(harnessed, {op: "setMode", mode: "play"});
        quitWithinNextFrame(game);
        expect([service.mode, recorder.seenX]).toEqual(["edit", [EDIT_X]]);
    });

    test("in a frame whose system error stopped the world, play is left for the error report and the session does not quit", async () => {
        const game = quittingGame({gameplaySystems: LISTED_QUIT_SYSTEMS, debugWorld: true});
        const {harnessed, quitter, recorder} = game;
        const {platform, service, world} = harnessed;
        await ask(harnessed, {op: "setMode", mode: "play"});
        quitter.failAfterQuitting = true;
        quitWithinNextFrame(game);

        expect(service.worldStoppedError?.includes(QUIT_FAILURE)).toBe(true);
        expect([service.mode, recorder.seenX.length, world.app?.quitPending, platform.quitCount]).toEqual(["play", 0, false, 0]);
    });
});
