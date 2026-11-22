import type {Component, Entity, World} from "../../engine/core";
import {ComponentType} from "../../engine/core/componentType";
import {getEntityCreationOrder} from "../../engine/core/ownership";
import {Vec, Vec4} from "../../engine/math/types/vec";
import {MAT4_TRANSLATION_Z} from "../../engine/math/mat4Layout";
import {LocalPosition} from "../../engine/translation/localPosition";
import {LocalRotation} from "../../engine/translation/localRotation";
import {LocalToWorld} from "../../engine/translation/localToWorld";
import {Camera} from "../../engine/rendering/camera";
import {ScreenSize} from "../../engine/rendering/screenSize";
import {HudElement} from "../../engine/rendering/hudElement";
import {WorldSpaceRenderBounds} from "../../engine/rendering/worldSpaceRenderBounds";
import {FieldOfView} from "../../engine/rendering/3d/fieldOfView";
import {EditorOnly, untrackedComponentOf} from "../../engine/scene";
import type {EditorCameraPose, EditorEntityBounds, EditorQuaternion, EditorVec3, EditorView, EditorViewInfo} from "../editorProtocol";
import {isSceneEntityHandle} from "./entityInspection";
import {worldMatrixOf} from "./hierarchyEditing";
import {mat4FromVec16, orthographicWorldToScreen, perspectiveWorldToScreen, rayBoxDistance, screenRay, translationOf} from "./viewMath";
import type {Mat4, Point3} from "./viewMath";

export const EDITOR_CAMERA_NAME = "Editor Camera";

const HALF = 0.5;
const DEGREES_PER_RADIAN = 180 / Math.PI;
const ENABLED = true;
const DISABLED = false;
const DEFAULT_EDITOR_CAMERA_DISTANCE = -10;

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

function quaternionOf(matrix: Mat4): EditorQuaternion {
    const decomposed = new LocalToWorld();
    Vec.copy(decomposed.matrix, matrix);
    const rotation = decomposed.rotationInto(Vec4.alloc());
    return [Vec.x(rotation), Vec.y(rotation), Vec.z(rotation), Vec.w(rotation)];
}

export class EditorViews {
    private _view: EditorView = "scene";
    private _editorCamera: Entity | undefined;
    private readonly hiddenCameras = new Map<Entity, Camera>();
    private gameViewDepth = 0;
    private renderingCamera: Entity | undefined;

    public constructor(private readonly world: World) {
    }

    public get view(): EditorView {
        return this._view;
    }

    public get editorCamera(): Entity | undefined {
        return this._editorCamera !== undefined && this.world.entityManager.exists(this._editorCamera) ? this._editorCamera : undefined;
    }

    public setView(view: EditorView): void {
        this._view = view;
        this.apply();
    }

    public withGameView<T>(action: () => T): T {
        this.gameViewDepth++;
        if (this.gameViewDepth === 1) this.showGameCameras();
        try {
            return action();
        } finally {
            this.gameViewDepth--;
            if (this.gameViewDepth === 0) this.apply();
        }
    }

    public apply(): void {
        if (this.gameViewDepth > 0) return;
        const editorCamera = this.ensureEditorCamera();
        const previous = this.renderingCamera;
        if (this._view === "scene" && editorCamera !== undefined) {
            this.hideGameCameras();
            this.setEnabled(editorCamera, ENABLED);
            this.renderingCamera = editorCamera;
        } else {
            this.showGameCameras();
            if (editorCamera !== undefined) this.setEnabled(editorCamera, DISABLED);
            this.renderingCamera = this.primaryGameCamera();
        }
        if (previous !== undefined && previous !== this.renderingCamera) this.copyScreenSize(previous, this.renderingCamera);
    }

    public dispose(): void {
        this.showGameCameras();
        const editorCamera = this.editorCamera;
        if (editorCamera !== undefined) this.world.entityManager.destroyEntity(editorCamera);
        this._editorCamera = undefined;
        this.renderingCamera = undefined;
    }

    public setEditorCamera(position: EditorVec3, rotation: EditorQuaternion, fieldOfViewDegrees: number | undefined): void {
        const entityManager = this.world.entityManager;
        const editorCamera = this.ensureEditorCamera() ?? this.createEditorCamera(undefined, fieldOfViewDegrees !== undefined);
        const fieldOfView = entityManager.getComponent<FieldOfView>(editorCamera, FieldOfView);
        if (fieldOfViewDegrees !== undefined && fieldOfView === undefined) {
            throw new Error("The editor camera is orthographic (the game camera has no FieldOfView), so it takes no field of view");
        }
        entityManager.getComponent<LocalPosition>(editorCamera, LocalPosition)!.xyz = Vec.alloc3(position[0], position[1], position[2]);
        entityManager.getComponent<LocalRotation>(editorCamera, LocalRotation)!.xyzw = Vec.alloc4(rotation[0], rotation[1], rotation[2], rotation[3]);
        if (fieldOfView !== undefined && fieldOfViewDegrees !== undefined) fieldOfView.degrees = fieldOfViewDegrees;
        this.apply();
    }

    public gameCameras(): Entity[] {
        const cameraType = ComponentType.of(Camera);
        const editorOnlyType = ComponentType.of(EditorOnly);
        const cameras = new Set<Entity>();
        for (const entity of this.hiddenCameras.keys()) if (isSceneEntityHandle(this.world, entity)) cameras.add(entity);
        for (const archetype of this.world.archetypes.values()) {
            if (archetype.getColumn(cameraType) === undefined || archetype.getColumn(editorOnlyType) !== undefined) continue;
            const count = archetype.entityCountIncludingDisabled;
            for (let row = 0; row < count; row++) cameras.add(archetype.getEntityAtIndex(row));
        }
        return [...cameras].sort((a, b) => getEntityCreationOrder(a)! - getEntityCreationOrder(b)!);
    }

    public primaryGameCamera(): Entity | undefined {
        const cameras = this.gameCameras();
        return cameras.find(camera => this.world.entityManager.isEnabled(camera)) ?? cameras[0];
    }

    public cameraFor(view: EditorView): Entity {
        if (view === "game") {
            const camera = this.primaryGameCamera();
            if (camera === undefined) throw new Error("The world has no game camera (an entity with Camera)");
            return camera;
        }
        const camera = this.ensureEditorCamera();
        if (camera === undefined) throw new Error("The Scene view has no camera yet: the world has no game camera to start it from; set one with setEditorCamera");
        return camera;
    }

    public viewInfo(view: EditorView, entities: readonly Entity[]): EditorViewInfo {
        const camera = this.cameraFor(view);
        const cameraMatrix = mat4FromVec16(worldMatrixOf(this.world, camera));
        const screen = this.screenExtent(camera);
        const fieldOfView = untrackedComponentOf<FieldOfView>(this.world, camera, ComponentType.of(FieldOfView));
        const pose: EditorCameraPose = fieldOfView === undefined
            ? {position: translationOf(cameraMatrix), rotation: quaternionOf(cameraMatrix)}
            : {position: translationOf(cameraMatrix), rotation: quaternionOf(cameraMatrix), fieldOfViewDegrees: fieldOfView.radians * DEGREES_PER_RADIAN};
        return {
            view,
            projection: fieldOfView === undefined ? "orthographic" : "perspective",
            worldToScreen: fieldOfView === undefined
                ? orthographicWorldToScreen(translationOf(cameraMatrix), screen.width, screen.height)
                : perspectiveWorldToScreen(cameraMatrix, fieldOfView.radians, screen.width, screen.height),
            screenWidth: screen.width,
            screenHeight: screen.height,
            camera: pose,
            bounds: this.boundsOf(entities),
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

    private boundsOf(entities: readonly Entity[]): EditorEntityBounds[] {
        const boundsType = ComponentType.of(WorldSpaceRenderBounds);
        const result: EditorEntityBounds[] = [];
        const seen = new Set<Entity>();
        for (const entity of entities) {
            if (seen.has(entity) || !isSceneEntityHandle(this.world, entity)) continue;
            seen.add(entity);
            const worldMatrix = mat4FromVec16(worldMatrixOf(this.world, entity));
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
        for (const candidate of [this.renderingCamera, camera]) {
            if (candidate === undefined || !this.world.entityManager.exists(candidate)) continue;
            const size = untrackedComponentOf<ScreenSize>(this.world, candidate, screenSizeType);
            if (size !== undefined && size.x > 0 && size.y > 0) return {width: size.x, height: size.y};
        }
        return {width: 0, height: 0};
    }

    private setEnabled(entity: Entity, enabled: boolean): void {
        const entityManager = this.world.entityManager;
        if (entityManager.isEnabled(entity) !== enabled) entityManager.setEnabledState(entity, enabled);
    }

    private copyScreenSize(from: Entity, to: Entity | undefined): void {
        if (to === undefined || !this.world.entityManager.exists(from)) return;
        const screenSizeType = ComponentType.of(ScreenSize);
        const source = untrackedComponentOf<ScreenSize>(this.world, from, screenSizeType);
        const target = this.world.entityManager.getComponent<ScreenSize>(to, screenSizeType);
        if (source === undefined || target === undefined || source.x <= 0 || source.y <= 0) return;
        if (target.x !== source.x) target.x = source.x;
        if (target.y !== source.y) target.y = source.y;
    }

    private hideGameCameras(): void {
        const entityManager = this.world.entityManager;
        const cameraType = ComponentType.of(Camera);
        for (const entity of this.gameCameras()) {
            if (this.hiddenCameras.has(entity)) continue;
            const camera = untrackedComponentOf<Camera>(this.world, entity, cameraType)!;
            entityManager.removeComponent(entity, cameraType);
            this.hiddenCameras.set(entity, camera);
        }
    }

    private showGameCameras(): void {
        const entityManager = this.world.entityManager;
        for (const [entity, camera] of this.hiddenCameras) {
            if (isSceneEntityHandle(this.world, entity) && !entityManager.hasComponent(entity, ComponentType.of(Camera))) entityManager.addComponent(entity, camera);
        }
        this.hiddenCameras.clear();
    }

    private cameraComponentOf(entity: Entity): Camera | undefined {
        return this.hiddenCameras.get(entity) ?? untrackedComponentOf<Camera>(this.world, entity, ComponentType.of(Camera));
    }

    private hasFieldOfView(entity: Entity): boolean {
        return untrackedComponentOf(this.world, entity, ComponentType.of(FieldOfView)) !== undefined;
    }

    private ensureEditorCamera(): Entity | undefined {
        const existing = this.editorCamera;
        const gameCamera = this.primaryGameCamera();
        if (existing !== undefined) {
            if (gameCamera === undefined || this.hasFieldOfView(gameCamera) === this.hasFieldOfView(existing)) return existing;
            if (this.renderingCamera === existing) this.renderingCamera = undefined;
            this.world.entityManager.destroyEntity(existing);
            this._editorCamera = undefined;
        }
        if (gameCamera === undefined) return undefined;
        return this.createEditorCamera(gameCamera, this.hasFieldOfView(gameCamera));
    }

    private createEditorCamera(gameCamera: Entity | undefined, perspective: boolean): Entity {
        const pose = new LocalToWorld();
        if (gameCamera !== undefined) pose.matrix = worldMatrixOf(this.world, gameCamera);
        else pose.position = Vec.alloc3(0, 0, perspective ? DEFAULT_EDITOR_CAMERA_DISTANCE : 0);
        const position = pose.position;
        const rotation = new LocalRotation();
        rotation.xyzw = pose.rotationInto(Vec4.alloc());
        const camera = new Camera();
        const gameCameraComponent = gameCamera === undefined ? undefined : this.cameraComponentOf(gameCamera);
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
        const localToWorld = new LocalToWorld();
        localToWorld.matrix = pose.matrix;
        const components: Component[] = [
            new EditorOnly(),
            camera,
            new LocalPosition(Vec.x(position), Vec.y(position), Vec.z(position)),
            rotation,
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
        this._editorCamera = entity;
        return entity;
    }
}
