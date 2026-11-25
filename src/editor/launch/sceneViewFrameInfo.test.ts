import {afterEach, describe, expect, test} from "../../engine/testing/harness";
import {Component, System} from "../../engine/core";
import type {Entity, World} from "../../engine/core";
import {LocalPosition} from "../../engine/translation/localPosition";
import {LocalToWorld} from "../../engine/translation/localToWorld";
import {InterpolatedTransform} from "../../engine/translation/interpolatedTransform";
import {Camera} from "../../engine/rendering/camera";
import {ScreenSize} from "../../engine/rendering/screenSize";
import {RenderBounds} from "../../engine/rendering/renderBounds";
import {WorldSpaceRenderBounds} from "../../engine/rendering/worldSpaceRenderBounds";
import {RenderCameraOverride} from "../../engine/rendering/renderCameraOverride";
import {MAT4_TRANSLATION_X, MAT4_TRANSLATION_Y, MAT4_TRANSLATION_Z} from "../../engine/math/mat4Layout";
import {Vec} from "../../engine/math/types/vec";
import {MemoryPixelPresenter} from "../../backends/pixels/memoryPixelPresenter";
import {PixelPresenterResource} from "../../backends/pixels/pixelPresenterResource";
import {PixelRenderSystemGroup} from "../../backends/pixels/pixelRenderSystemGroup";
import type {PixelSurfaceSize} from "../../hosts/web/worldWorkerProtocol";
import type {EditorEntityBounds, EditorVec3, EditorViewInfo} from "../editorProtocol";
import {FIRST_SCENE_VIEW} from "../project/dockPanelIds";
import type {SceneViewId} from "../project/dockPanelIds";
import {ask, disposeEditorWorlds, editorWorld} from "../world/editorServiceTestHarness";
import type {Harnessed} from "../world/editorServiceTestHarness";
import type {EditorWorldService} from "../world/editorWorldService";
import {SceneViewChannel} from "./sceneViewChannel";
import type {SceneViewHost, SceneViewScope} from "./sceneViewChannel";
import {SCENE_VIEW_MESSAGE_TYPE} from "./sceneViewProtocol";
import type {SceneViewPixelFrameMessage, SceneViewWorkerMessage} from "./sceneViewProtocol";

const SCENE_SURFACE: PixelSurfaceSize = {kind: "pixels", widthPx: 160, heightPx: 96};
const HOST_SIZE = {widthPx: 160, heightPx: 96};
const SCREEN_WIDTH = 20;
const SCREEN_HEIGHT = 10;
const STEP_X = 2;
const EDIT_STEP_X = 3;
const HALF_TICK = 0.5;
const EDIT_FRAMES = 6;
const PLAY_FRAMES = 8;
const CAMERA_FRAME = 3;
const MOVED_CAMERA: EditorVec3 = [4, 1, 0];
const IDENTITY_ROTATION: readonly [number, number, number, number] = [0, 0, 0, 1];
const PLAIN_START_X = 1;
const INTERPOLATED_START_X = -3;

class StepsRight extends Component {
}

class StepRightSystem extends System {
    private readonly movers = this.createEntityQuery([StepsRight, LocalPosition]);

    public onUpdate(): void {
        this.movers.stream({write: {position: LocalPosition}}).forEach(({position}) => {
            position.x += STEP_X;
        });
    }
}

interface Drawn {
    readonly camera: EditorVec3;
    readonly bounds: readonly EditorEntityBounds[];
    readonly simulatedX: readonly number[];
}

function translationOf(world: World, entity: Entity): EditorVec3 {
    const matrix = Vec.toArray(world.entityManager.getComponent<LocalToWorld>(entity, LocalToWorld)!.matrix);
    return [matrix[MAT4_TRANSLATION_X], matrix[MAT4_TRANSLATION_Y], matrix[MAT4_TRANSLATION_Z]];
}

class DrawnSceneProbe extends System {
    public readonly drawn: Drawn[] = [];
    public sceneCamera: () => Entity | undefined = () => undefined;
    public entities: readonly Entity[] = [];

    override systemGroup() {
        return PixelRenderSystemGroup;
    }

    public onUpdate(): void {
        const camera = this.world.resources.tryGet(RenderCameraOverride)?.camera;
        if (camera === undefined || camera !== this.sceneCamera()) return;
        const entityManager = this.world.entityManager;
        this.drawn.push({
            camera: translationOf(this.world, camera),
            bounds: this.entities.map(entity => {
                const box = entityManager.getComponent<WorldSpaceRenderBounds>(entity, WorldSpaceRenderBounds)!;
                const pivot = translationOf(this.world, entity);
                return {entity, min: [box.xMin, box.yMin, box.zMin], max: [box.xMax, box.yMax, box.zMax], pivot, rotation: [...IDENTITY_ROTATION]};
            }),
            simulatedX: this.entities.map(entity => entityManager.getComponent<LocalPosition>(entity, LocalPosition)!.x),
        });
    }
}

interface MovingScene {
    plain: Entity;
    interpolated: Entity;
}

function unitBox(): RenderBounds {
    const box = new RenderBounds();
    box.xMin = -1;
    box.yMin = -1;
    box.xMax = 1;
    box.yMax = 1;
    return box;
}

function sizedScreen(): ScreenSize {
    const size = new ScreenSize();
    size.x = SCREEN_WIDTH;
    size.y = SCREEN_HEIGHT;
    return size;
}

function movingScene(world: World, scene: MovingScene): void {
    const entityManager = world.entityManager;
    entityManager.createEntity("gameCamera", [new Camera(), new LocalPosition(0, 0, 0), new LocalToWorld(), sizedScreen()]);
    scene.plain = entityManager.createEntity("plain", [new LocalPosition(PLAIN_START_X, 0, 0), new LocalToWorld(), unitBox(), new StepsRight()]);
    scene.interpolated = entityManager.createEntity("interpolated", [new LocalPosition(INTERPOLATED_START_X, 0, 0), new LocalToWorld(), unitBox(), new InterpolatedTransform(), new StepsRight()]);
    world.resources.insert(new PixelPresenterResource(new MemoryPixelPresenter(HOST_SIZE)));
    world.getOrCreateSystem(PixelRenderSystemGroup);
    world.getOrCreateSystem(DrawnSceneProbe);
    world.getOrCreateSystem(StepRightSystem);
}

class PageEnd implements SceneViewScope {
    public readonly frames: SceneViewPixelFrameMessage[] = [];
    private readonly listeners: ((event: {readonly data: unknown}) => void)[] = [];

    public postMessage(message: SceneViewWorkerMessage): void {
        if (message.kind === "pixelFrame") this.frames.push(message);
    }

    public addEventListener(_type: "message", listener: (event: {readonly data: unknown}) => void): void {
        this.listeners.push(listener);
    }

    public send(data: unknown): void {
        for (const listener of this.listeners) listener({data});
    }

    public acknowledge(view: SceneViewId): void {
        this.send({type: SCENE_VIEW_MESSAGE_TYPE, view, kind: "presented"});
    }
}

function hostOver(service: EditorWorldService): SceneViewHost {
    return {
        backend: "pixels",
        open: (view, presenter) => service.showSceneView(view, presenter),
        close: view => service.closeSceneView(view),
        frameInfo: view => service.sceneFrameInfo(view),
    };
}

function runFrame(harnessed: Harnessed, page: PageEnd): void {
    harnessed.frameAfter(harnessed.world.loopTiming.tickDeltaMs * HALF_TICK);
    page.acknowledge(FIRST_SCENE_VIEW);
}

function reported(info: EditorViewInfo | undefined): Omit<Drawn, "simulatedX"> | undefined {
    if (info === undefined) return undefined;
    return {camera: info.camera.position, bounds: info.bounds.map(bounds => ({...bounds, rotation: [...IDENTITY_ROTATION]}))};
}

afterEach(disposeEditorWorlds);

describe("scene view frames carry their view info", () => {
    test("every presented frame reports the selection's bounds, pivots and camera exactly as that frame drew them, while editing, playing interpolated and moving the camera", async () => {
        const scene = {} as MovingScene;
        const harnessed = editorWorld(world => movingScene(world, scene), {drivenFrames: false, gameplaySystems: [StepRightSystem]});
        const {world, service} = harnessed;
        const probe = world.getOrCreateSystem(DrawnSceneProbe);
        probe.sceneCamera = () => service.sceneCameraOf(FIRST_SCENE_VIEW);
        probe.entities = [scene.plain, scene.interpolated];
        const page = new PageEnd();
        new SceneViewChannel(page).attach(hostOver(service));
        page.send({type: SCENE_VIEW_MESSAGE_TYPE, view: FIRST_SCENE_VIEW, kind: "open", surface: SCENE_SURFACE});
        expect((await ask(harnessed, {op: "setSelection", entities: [scene.plain, scene.interpolated]})).entities).toEqual([scene.plain, scene.interpolated]);
        runFrame(harnessed, page);
        const settled = page.frames.length;

        for (let frame = 0; frame < EDIT_FRAMES; frame++) {
            const position = world.entityManager.getComponent<LocalPosition>(scene.plain, LocalPosition)!;
            await ask(harnessed, {op: "setFields", edits: [{entity: scene.plain, typeName: "LocalPosition", key: "xyz", value: [position.x + EDIT_STEP_X, 0, 0]}]});
            runFrame(harnessed, page);
        }
        await ask(harnessed, {op: "setMode", mode: "play"});
        for (let frame = 0; frame < PLAY_FRAMES; frame++) {
            if (frame === CAMERA_FRAME) await ask(harnessed, {op: "setEditorCamera", view: FIRST_SCENE_VIEW, position: MOVED_CAMERA, rotation: IDENTITY_ROTATION});
            runFrame(harnessed, page);
        }

        const drawn = probe.drawn.slice(-(page.frames.length - settled));
        const sent = page.frames.slice(settled);
        expect(sent.length).toBe(EDIT_FRAMES + PLAY_FRAMES);
        expect(sent.map(message => reported(message.info))).toEqual(drawn.map(({camera, bounds}) => ({camera, bounds})));
        expect(sent.map(message => message.info?.presentedFrames)).toEqual(sent.map((_, index) => settled + index + 1));
        const lagsAnEdit = drawn.some(frame => frame.bounds[0].pivot[0] !== frame.simulatedX[0]);
        const blends = drawn.some(frame => frame.bounds[1].pivot[0] !== frame.simulatedX[1]);
        expect([lagsAnEdit, blends]).toEqual([true, true]);
        expect(sent.some(message => message.info?.camera.position.join() === MOVED_CAMERA.join())).toBe(true);
    });

    test("a hidden scene view presents nothing, so it computes no view info", async () => {
        const scene = {} as MovingScene;
        const harnessed = editorWorld(world => movingScene(world, scene), {drivenFrames: false});
        const page = new PageEnd();
        let computed = 0;
        const host = hostOver(harnessed.service);
        new SceneViewChannel(page).attach({...host, frameInfo: view => {
            computed++;
            return host.frameInfo(view);
        }});
        page.send({type: SCENE_VIEW_MESSAGE_TYPE, view: FIRST_SCENE_VIEW, kind: "open", surface: {kind: "pixels", widthPx: 0, heightPx: 0}});
        for (let frame = 0; frame < EDIT_FRAMES; frame++) runFrame(harnessed, page);
        expect([page.frames.length, computed]).toEqual([0, 0]);
        page.send({type: SCENE_VIEW_MESSAGE_TYPE, view: FIRST_SCENE_VIEW, kind: "resize", surface: SCENE_SURFACE});
        for (let frame = 0; frame < EDIT_FRAMES; frame++) runFrame(harnessed, page);
        expect(page.frames.length).toBe(EDIT_FRAMES);
        expect(computed).toBe(EDIT_FRAMES);
        expect(page.frames.every(message => message.info?.bounds.length === 0)).toBe(true);
    });
});
