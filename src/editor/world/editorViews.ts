import {NULL_ENTITY} from "../../engine/core";
import type {Component, Entity, World} from "../../engine/core";
import {ComponentType} from "../../engine/core/componentType";
import type {CellPresenter} from "../../backends/cells/cellPresenter";
import {CellPresenterResource, CellRenderTargets} from "../../backends/cells/cellPresenterResource";
import type {CellRenderTarget} from "../../backends/cells/cellPresenterResource";
import type {PixelPresenter} from "../../backends/pixels/pixelPresenter";
import {PixelPresenterResource, PixelRenderTargets} from "../../backends/pixels/pixelPresenterResource";
import type {PixelRenderTarget} from "../../backends/pixels/pixelPresenterResource";
import {getEntityCreationOrder} from "../../engine/core/ownership";
import {Vec, Vec4} from "../../engine/math/types/vec";
import type {ReadonlyVec16, ReadonlyVec3} from "../../engine/math/types/vec";
import {MAT4_TRANSLATION_Z} from "../../engine/math/mat4Layout";
import {LocalToWorld} from "../../engine/translation/localToWorld";
import {Camera} from "../../engine/rendering/camera";
import {ScreenSize} from "../../engine/rendering/screenSize";
import {HudElement} from "../../engine/rendering/hudElement";
import {WorldSpaceRenderBounds} from "../../engine/rendering/worldSpaceRenderBounds";
import {FieldOfView} from "../../engine/rendering/3d/fieldOfView";
import {EditorOnly, untrackedComponentOf} from "../../engine/scene";
import {GAME_VIEW} from "../editorProtocol";
import type {EditorCameraPose, EditorEntityBounds, EditorQuaternion, EditorVec3, EditorView, EditorViewInfo} from "../editorProtocol";
import {FIRST_SCENE_VIEW} from "../project/dockPanelIds";
import type {SceneViewId} from "../project/dockPanelIds";
import {isSceneEntityHandle} from "./entityInspection";
import {worldMatrixOf} from "./hierarchyEditing";
import {mat4FromVec16, orthographicWorldToScreen, perspectiveWorldToScreen, rayBoxDistance, screenRay, translationOf} from "./viewMath";
import type {Mat4, Point3} from "./viewMath";

export const EDITOR_CAMERA_NAME = "Editor Camera";

const HALF = 0.5;
const DEGREES_PER_RADIAN = 180 / Math.PI;
const DISABLED = false;
const DEFAULT_EDITOR_CAMERA_DISTANCE = -10;
const UNIT_SCALE: ReadonlyVec3 = Vec.alloc3(1, 1, 1);

interface PickCandidate {
    readonly entity: Entity;
    readonly distance: number;
    readonly area: number;
    readonly creationOrder: number;
}

interface ScreenExtent {
    readonly width: number;
    readonly height: number;
}

type MatrixSource = (world: World, entity: Entity) => ReadonlyVec16;

const NOTHING_SELECTED: readonly Entity[] = [];

function drawnMatrixOf(world: World, entity: Entity): ReadonlyVec16 {
    const localToWorld = world.entityManager.isEnabled(entity) ? untrackedComponentOf<LocalToWorld>(world, entity, ComponentType.of(LocalToWorld)) : undefined;
    return localToWorld === undefined ? worldMatrixOf(world, entity) : localToWorld.matrix;
}

export interface SceneViewFrames {
    presentedFrames(): number;
}

export type SceneViewPresenter = SceneViewFrames & (
    | {readonly kind: "cells", readonly presenter: CellPresenter}
    | {readonly kind: "pixels", readonly presenter: PixelPresenter});

function quaternionOf(matrix: Mat4): EditorQuaternion {
    const decomposed = new LocalToWorld();
    Vec.copy(decomposed.matrix, matrix);
    const rotation = decomposed.rotationInto(Vec4.alloc());
    return [Vec.x(rotation), Vec.y(rotation), Vec.z(rotation), Vec.w(rotation)];
}

interface SceneViewSlot {
    camera: Entity | undefined;
    presenter: SceneViewPresenter | undefined;
}

class SceneViewTarget<Presenter> {
    public constructor(private readonly views: EditorViews, private readonly slot: SceneViewSlot, public readonly presenter: Presenter) {
    }

    public get camera(): Entity {
        return this.views.liveCamera(this.slot) ?? NULL_ENTITY;
    }
}

function emptySlot(): SceneViewSlot {
    return {camera: undefined, presenter: undefined};
}

function noSuchSceneView(view: SceneViewId): Error {
    return new Error(`The editor has no Scene view ${view}`);
}

export class EditorViews {
    private readonly slots = new Map<SceneViewId, SceneViewSlot>([[FIRST_SCENE_VIEW, emptySlot()]]);
    private sceneTargets: CellRenderTargets | PixelRenderTargets | undefined;
    private selection: readonly Entity[] = NOTHING_SELECTED;

    public constructor(private readonly world: World) {
    }

    public get editorCamera(): Entity | undefined {
        return this.editorCameraOf(FIRST_SCENE_VIEW);
    }

    public get sceneViews(): SceneViewId[] {
        return [...this.slots].filter(([, slot]) => slot.presenter !== undefined).map(([view]) => view);
    }

    public editorCameraOf(view: SceneViewId): Entity | undefined {
        const slot = this.slots.get(view);
        return slot === undefined ? undefined : this.liveCamera(slot);
    }

    public liveCamera(slot: SceneViewSlot): Entity | undefined {
        return slot.camera !== undefined && this.world.entityManager.exists(slot.camera) ? slot.camera : undefined;
    }

    public showScene(view: SceneViewId, presenter: SceneViewPresenter): void {
        let slot = this.slots.get(view);
        if (slot === undefined) this.slots.set(view, slot = emptySlot());
        slot.presenter = presenter;
        this.placeSceneTargets();
        this.apply();
    }

    public closeScene(view: SceneViewId): void {
        const slot = this.slots.get(view);
        if (slot === undefined) return;
        slot.presenter = undefined;
        if (view !== FIRST_SCENE_VIEW) {
            this.destroyCamera(slot);
            this.slots.delete(view);
        }
        this.placeSceneTargets();
    }

    public apply(): void {
        for (const slot of this.slots.values()) this.ensureEditorCamera(slot);
    }

    public dispose(): void {
        this.removeSceneTargets();
        for (const slot of this.slots.values()) this.destroyCamera(slot);
        this.slots.clear();
        this.slots.set(FIRST_SCENE_VIEW, emptySlot());
        this.selection = NOTHING_SELECTED;
    }

    public setSelection(entities: readonly Entity[]): readonly Entity[] {
        this.selection = [...new Set(entities)];
        return this.selection;
    }

    public setEditorCamera(view: SceneViewId, position: EditorVec3, rotation: EditorQuaternion, fieldOfViewDegrees: number | undefined): void {
        const slot = this.slotOf(view);
        const editorCamera = this.ensureEditorCamera(slot) ?? this.createEditorCamera(slot, undefined, fieldOfViewDegrees !== undefined);
        const fieldOfView = untrackedComponentOf<FieldOfView>(this.world, editorCamera, ComponentType.of(FieldOfView));
        if (fieldOfViewDegrees !== undefined && fieldOfView === undefined) {
            throw new Error("The editor camera is orthographic (the game camera has no FieldOfView), so it takes no field of view");
        }
        const pose = untrackedComponentOf<LocalToWorld>(this.world, editorCamera, ComponentType.of(LocalToWorld))!;
        pose.setTRS(Vec.alloc3(position[0], position[1], position[2]), Vec.alloc4(rotation[0], rotation[1], rotation[2], rotation[3]), UNIT_SCALE);
        if (fieldOfView !== undefined && fieldOfViewDegrees !== undefined) fieldOfView.degrees = fieldOfViewDegrees;
        this.apply();
    }

    public gameCameras(): Entity[] {
        const cameraType = ComponentType.of(Camera);
        const editorOnlyType = ComponentType.of(EditorOnly);
        const cameras: Entity[] = [];
        for (const archetype of this.world.archetypes.values()) {
            if (archetype.getColumn(cameraType) === undefined || archetype.getColumn(editorOnlyType) !== undefined) continue;
            const count = archetype.entityCountIncludingDisabled;
            for (let row = 0; row < count; row++) cameras.push(archetype.getEntityAtIndex(row));
        }
        return cameras.sort((a, b) => getEntityCreationOrder(a)! - getEntityCreationOrder(b)!);
    }

    public hasGameCamera(): boolean {
        const cameraType = ComponentType.of(Camera);
        const editorOnlyType = ComponentType.of(EditorOnly);
        for (const archetype of this.world.archetypes.values()) {
            if (archetype.getColumn(cameraType) === undefined || archetype.getColumn(editorOnlyType) !== undefined) continue;
            if (archetype.entityCountIncludingDisabled > 0) return true;
        }
        return false;
    }

    public primaryGameCamera(): Entity | undefined {
        const cameras = this.gameCameras();
        return cameras.find(camera => this.world.entityManager.isEnabled(camera)) ?? cameras[0];
    }

    public cameraFor(view: EditorView): Entity {
        if (view === GAME_VIEW) {
            const camera = this.primaryGameCamera();
            if (camera === undefined) throw new Error("The world has no game camera (an entity with Camera)");
            return camera;
        }
        const camera = this.ensureEditorCamera(this.slotOf(view));
        if (camera === undefined) throw new Error("The Scene view has no camera yet: the world has no game camera to start it from; set one with setEditorCamera");
        return camera;
    }

    public viewInfo(view: EditorView, entities: readonly Entity[]): EditorViewInfo {
        return this.viewInfoThrough(view, this.cameraFor(view), entities, worldMatrixOf);
    }

    public frameInfo(view: SceneViewId): EditorViewInfo | undefined {
        const slot = this.slots.get(view);
        const camera = slot === undefined ? undefined : this.liveCamera(slot);
        return camera === undefined ? undefined : this.viewInfoThrough(view, camera, this.selection, drawnMatrixOf);
    }

    private viewInfoThrough(view: EditorView, camera: Entity, entities: readonly Entity[], matrixOf: MatrixSource): EditorViewInfo {
        const cameraMatrix = mat4FromVec16(matrixOf(this.world, camera));
        const screen = this.screenExtent(camera);
        const fieldOfView = untrackedComponentOf<FieldOfView>(this.world, camera, ComponentType.of(FieldOfView));
        const pose: EditorCameraPose = fieldOfView === undefined
            ? {position: translationOf(cameraMatrix), rotation: quaternionOf(cameraMatrix)}
            : {position: translationOf(cameraMatrix), rotation: quaternionOf(cameraMatrix), fieldOfViewDegrees: fieldOfView.radians * DEGREES_PER_RADIAN};
        const presenter = view === GAME_VIEW ? undefined : this.slots.get(view)?.presenter;
        return {
            view,
            projection: fieldOfView === undefined ? "orthographic" : "perspective",
            worldToScreen: fieldOfView === undefined
                ? orthographicWorldToScreen(translationOf(cameraMatrix), screen.width, screen.height)
                : perspectiveWorldToScreen(cameraMatrix, fieldOfView.radians, screen.width, screen.height),
            screenWidth: screen.width,
            screenHeight: screen.height,
            camera: pose,
            bounds: this.boundsOf(entities, matrixOf),
            sceneViews: this.sceneViews,
            ...(presenter === undefined ? {} : {presentedFrames: presenter.presentedFrames()}),
        };
    }

    public pick(x: number, y: number, view: EditorView): Entity[] {
        const camera = this.cameraFor(view);
        const cameraMatrix = mat4FromVec16(worldMatrixOf(this.world, camera));
        const screen = this.screenExtent(camera);
        if (screen.width <= 0 || screen.height <= 0) return [];
        const fieldOfView = untrackedComponentOf<FieldOfView>(this.world, camera, ComponentType.of(FieldOfView));
        const candidates: PickCandidate[] = [];
        if (fieldOfView === undefined) {
            const [cameraX, cameraY] = translationOf(cameraMatrix);
            const worldX = cameraX - screen.width * HALF + x;
            const worldY = cameraY - screen.height * HALF + y;
            this.forEachPickable((entity, bounds, localToWorld) => {
                if (worldX < bounds.xMin || worldX > bounds.xMax || worldY < bounds.yMin || worldY > bounds.yMax) return;
                const depth = localToWorld === undefined ? (bounds.zMin + bounds.zMax) * HALF : Vec.toArray(localToWorld.matrix)[MAT4_TRANSLATION_Z];
                candidates.push({entity, distance: depth, area: (bounds.xMax - bounds.xMin) * (bounds.yMax - bounds.yMin), creationOrder: getEntityCreationOrder(entity)!});
            });
        } else {
            const ray = screenRay(cameraMatrix, fieldOfView.radians, screen.width, screen.height, x, y);
            this.forEachPickable((entity, bounds) => {
                const box = {min: [bounds.xMin, bounds.yMin, bounds.zMin] as Point3, max: [bounds.xMax, bounds.yMax, bounds.zMax] as Point3};
                const distance = rayBoxDistance(ray, box);
                if (distance === undefined) return;
                const extent = (bounds.xMax - bounds.xMin) * (bounds.yMax - bounds.yMin) * (bounds.zMax - bounds.zMin);
                candidates.push({entity, distance, area: extent, creationOrder: getEntityCreationOrder(entity)!});
            });
        }
        candidates.sort((a, b) => (a.distance - b.distance) || (a.area - b.area) || (a.creationOrder - b.creationOrder));
        return candidates.map(candidate => candidate.entity);
    }

    private forEachPickable(visit: (entity: Entity, bounds: WorldSpaceRenderBounds, localToWorld: LocalToWorld | undefined) => void): void {
        const boundsType = ComponentType.of(WorldSpaceRenderBounds);
        const hudType = ComponentType.of(HudElement);
        const editorOnlyType = ComponentType.of(EditorOnly);
        const localToWorldType = ComponentType.of(LocalToWorld);
        for (const archetype of this.world.archetypes.values()) {
            const boundsColumn = archetype.getColumn(boundsType);
            if (boundsColumn === undefined || archetype.getColumn(hudType) !== undefined || archetype.getColumn(editorOnlyType) !== undefined) continue;
            const localToWorldColumn = archetype.getColumn(localToWorldType);
            const count = archetype.enabledEntityCount;
            for (let row = 0; row < count; row++) {
                visit(archetype.getEntityAtIndex(row), boundsColumn.get(row) as WorldSpaceRenderBounds, localToWorldColumn?.get(row) as LocalToWorld | undefined);
            }
        }
    }

    private boundsOf(entities: readonly Entity[], matrixOf: MatrixSource): EditorEntityBounds[] {
        const boundsType = ComponentType.of(WorldSpaceRenderBounds);
        const result: EditorEntityBounds[] = [];
        const seen = new Set<Entity>();
        for (const entity of entities) {
            if (seen.has(entity) || !isSceneEntityHandle(this.world, entity)) continue;
            seen.add(entity);
            const worldMatrix = mat4FromVec16(matrixOf(this.world, entity));
            const pivot = translationOf(worldMatrix);
            const rotation = quaternionOf(worldMatrix);
            const bounds = untrackedComponentOf<WorldSpaceRenderBounds>(this.world, entity, boundsType);
            if (bounds !== undefined) {
                result.push({entity, min: [bounds.xMin, bounds.yMin, bounds.zMin], max: [bounds.xMax, bounds.yMax, bounds.zMax], pivot, rotation});
                continue;
            }
            result.push({entity, min: pivot, max: pivot, pivot, rotation});
        }
        return result;
    }

    private screenExtent(camera: Entity): ScreenExtent {
        const screenSizeType = ComponentType.of(ScreenSize);
        for (const candidate of [camera, this.primaryGameCamera()]) {
            if (candidate === undefined || !this.world.entityManager.exists(candidate)) continue;
            const size = untrackedComponentOf<ScreenSize>(this.world, candidate, screenSizeType);
            if (size !== undefined && size.x > 0 && size.y > 0) return {width: size.x, height: size.y};
        }
        return {width: 0, height: 0};
    }

    private slotOf(view: SceneViewId): SceneViewSlot {
        const slot = this.slots.get(view);
        if (slot === undefined) throw noSuchSceneView(view);
        return slot;
    }

    private cellTargets(): CellRenderTarget[] {
        return [...this.slots.values()].flatMap(slot => slot.presenter?.kind === "cells" ? [new SceneViewTarget(this, slot, slot.presenter.presenter)] : []);
    }

    private pixelTargets(): PixelRenderTarget[] {
        return [...this.slots.values()].flatMap(slot => slot.presenter?.kind === "pixels" ? [new SceneViewTarget(this, slot, slot.presenter.presenter)] : []);
    }

    private placeSceneTargets(): void {
        this.removeSceneTargets();
        const world = this.world;
        const cells = this.cellTargets();
        const pixels = this.pixelTargets();
        let targets: CellRenderTargets | PixelRenderTargets;
        if (cells.length > 0) targets = new CellRenderTargets([...cells, {camera: undefined, presenter: CellPresenterResource.presenterOf(world)}]);
        else if (pixels.length > 0) targets = new PixelRenderTargets([...pixels, {camera: undefined, presenter: PixelPresenterResource.presenterOf(world)}]);
        else return;
        world.resources.insert(targets);
        this.sceneTargets = targets;
    }

    private removeSceneTargets(): void {
        const targets = this.sceneTargets;
        if (targets === undefined) return;
        this.sceneTargets = undefined;
        const resources = this.world.resources;
        if (targets instanceof CellRenderTargets) {
            if (resources.tryGet(CellRenderTargets) === targets) resources.remove(CellRenderTargets);
        } else if (resources.tryGet(PixelRenderTargets) === targets) {
            resources.remove(PixelRenderTargets);
        }
    }

    private hasFieldOfView(entity: Entity): boolean {
        return untrackedComponentOf(this.world, entity, ComponentType.of(FieldOfView)) !== undefined;
    }

    private destroyCamera(slot: SceneViewSlot): void {
        const camera = this.liveCamera(slot);
        if (camera !== undefined) this.world.entityManager.destroyEntity(camera);
        slot.camera = undefined;
    }

    private ensureEditorCamera(slot: SceneViewSlot): Entity | undefined {
        const existing = this.liveCamera(slot);
        const gameCamera = this.primaryGameCamera();
        if (existing !== undefined && (gameCamera === undefined || this.hasFieldOfView(gameCamera) === this.hasFieldOfView(existing))) return existing;
        if (gameCamera === undefined) return undefined;
        const created = this.createEditorCamera(slot, gameCamera, this.hasFieldOfView(gameCamera));
        if (existing !== undefined) this.world.entityManager.destroyEntity(existing);
        return created;
    }

    private createEditorCamera(slot: SceneViewSlot, gameCamera: Entity | undefined, perspective: boolean): Entity {
        const gamePose = new LocalToWorld();
        if (gameCamera !== undefined) gamePose.matrix = worldMatrixOf(this.world, gameCamera);
        else gamePose.position = Vec.alloc3(0, 0, perspective ? DEFAULT_EDITOR_CAMERA_DISTANCE : 0);
        const localToWorld = new LocalToWorld();
        localToWorld.setTRS(gamePose.position, gamePose.rotationInto(Vec4.alloc()), UNIT_SCALE);
        const camera = new Camera();
        const gameCameraComponent = gameCamera === undefined ? undefined : untrackedComponentOf<Camera>(this.world, gameCamera, ComponentType.of(Camera));
        if (gameCameraComponent !== undefined) {
            camera.nearPlaneDistance = gameCameraComponent.nearPlaneDistance;
            camera.farPlaneDistance = gameCameraComponent.farPlaneDistance;
        }
        const screenSize = new ScreenSize();
        const gameScreenSize = gameCamera === undefined ? undefined : untrackedComponentOf<ScreenSize>(this.world, gameCamera, ComponentType.of(ScreenSize));
        if (gameScreenSize !== undefined) {
            screenSize.x = gameScreenSize.x;
            screenSize.y = gameScreenSize.y;
        }
        const components: Component[] = [
            new EditorOnly(),
            camera,
            localToWorld,
            screenSize,
        ];
        if (perspective) {
            const fieldOfView = new FieldOfView();
            const gameFieldOfView = gameCamera === undefined ? undefined : untrackedComponentOf<FieldOfView>(this.world, gameCamera, ComponentType.of(FieldOfView));
            if (gameFieldOfView !== undefined) fieldOfView.radians = gameFieldOfView.radians;
            components.push(fieldOfView);
        }
        const entity = this.world.entityManager.createEntity(EDITOR_CAMERA_NAME, components);
        this.world.entityManager.setEnabledState(entity, DISABLED);
        slot.camera = entity;
        return entity;
    }
}
