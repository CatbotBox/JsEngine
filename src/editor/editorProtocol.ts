import type {Entity} from "../engine/core";
import type {ComponentPersistence, NumberFieldOptions, PlainFieldKind, SceneJsonObject, SceneJsonValue, SceneLoadReport, SceneSaveReport} from "../engine/scene";
import {GAME_VIEW_ID, isSceneViewId} from "./project/dockPanelIds";
import type {EditorViewportId, SceneViewId} from "./project/dockPanelIds";

export const EDITOR_MESSAGE_TYPE = "jsengine-editor";

// Handles are 32-bit (20-bit index, 12-bit generation); anything at or above 2^32 is not a handle.
export const ENTITY_HANDLE_LIMIT = 2 ** 32;

export const MAX_FIELD_OF_VIEW_DEGREES = 180;

const VEC3_LENGTH = 3;
const QUATERNION_LENGTH = 4;

export type EditorMode = "edit" | "play" | "paused";

export const EDITOR_MODES: readonly EditorMode[] = ["edit", "play", "paused"];

export type EditorView = EditorViewportId;

export const GAME_VIEW = GAME_VIEW_ID;

export type EditorProjection = "orthographic" | "perspective";

export type EditorConsoleLevel = "log" | "info" | "warn" | "error" | "debug";

export const EDITOR_CONSOLE_LEVELS: readonly EditorConsoleLevel[] = ["log", "info", "warn", "error", "debug"];

export type EditorVec3 = readonly [number, number, number];

export type EditorQuaternion = readonly [number, number, number, number];

export type EditorComponentValues = {readonly [typeName: string]: SceneJsonObject};

export interface DescribeSchemasRequest {
    readonly op: "describeSchemas";
}

export interface ListEntitiesRequest {
    readonly op: "listEntities";
}

export interface GetEntityRequest {
    readonly op: "getEntity";
    readonly entity: Entity;
}

export interface GetFieldRequest {
    readonly op: "getField";
    readonly entity: Entity;
    readonly typeName: string;
    readonly key: string;
}

export interface SetFieldRequest {
    readonly op: "setField";
    readonly entity: Entity;
    readonly typeName: string;
    readonly key: string;
    readonly value: SceneJsonValue;
}

export interface EditorFieldEdit {
    readonly entity: Entity;
    readonly typeName: string;
    readonly key: string;
    readonly value: SceneJsonValue;
}

export interface SetFieldsRequest {
    readonly op: "setFields";
    readonly edits: readonly EditorFieldEdit[];
}

export interface AddComponentRequest {
    readonly op: "addComponent";
    readonly entity: Entity;
    readonly typeName: string;
    readonly values?: SceneJsonObject;
}

export interface RemoveComponentRequest {
    readonly op: "removeComponent";
    readonly entity: Entity;
    readonly typeName: string;
}

export interface CreateEntityRequest {
    readonly op: "createEntity";
    readonly name?: string;
    readonly parent?: Entity;
    readonly components?: EditorComponentValues;
}

export interface DestroyEntityRequest {
    readonly op: "destroyEntity";
    readonly entity: Entity;
}

export interface SetEnabledRequest {
    readonly op: "setEnabled";
    readonly entity: Entity;
    readonly enabled: boolean;
}

export interface RenameEntityRequest {
    readonly op: "renameEntity";
    readonly entity: Entity;
    readonly name: string | null;
}

export interface SetParentRequest {
    readonly op: "setParent";
    readonly entity: Entity;
    readonly parent: Entity | null;
    readonly siblingIndex?: number;
}

export interface DuplicateEntitiesRequest {
    readonly op: "duplicateEntities";
    readonly entities: readonly Entity[];
}

export interface SerializeEntitiesRequest {
    readonly op: "serializeEntities";
    readonly entities: readonly Entity[];
}

export interface EditorSceneRef {
    readonly id: number;
    readonly path: string | null;
}

export interface InstantiateEntitiesRequest {
    readonly op: "instantiateEntities";
    readonly documentText: string;
    readonly parent?: Entity | null;
    readonly siblingIndex?: number;
    readonly prefabSourcePath?: string;
    readonly scene?: EditorSceneRef;
}

export interface GetPrefabOverridesRequest {
    readonly op: "getPrefabOverrides";
    readonly entity: Entity;
}

export interface RevertPrefabInstanceRequest {
    readonly op: "revertPrefabInstance";
    readonly entity: Entity;
    readonly paths?: readonly string[];
}

export interface ApplyPrefabInstanceRequest {
    readonly op: "applyPrefabInstance";
    readonly entity: Entity;
}

export interface UpdatePrefabInstancesRequest {
    readonly op: "updatePrefabInstances";
    readonly sourcePath: string;
    readonly documentText: string;
}

export interface PickEntitiesRequest {
    readonly op: "pickEntities";
    readonly x: number;
    readonly y: number;
    readonly view: EditorView;
}

export interface SetEditorCameraRequest {
    readonly op: "setEditorCamera";
    readonly view: SceneViewId;
    readonly position: EditorVec3;
    readonly rotation: EditorQuaternion;
    readonly fieldOfViewDegrees?: number;
}

export interface GetViewInfoRequest {
    readonly op: "getViewInfo";
    readonly view: EditorView;
    readonly entities?: readonly Entity[];
}

export interface SetSelectionRequest {
    readonly op: "setSelection";
    readonly entities: readonly Entity[];
}

export interface SaveSceneRequest {
    readonly op: "saveScene";
    readonly scene?: EditorSceneRef;
}

export interface LoadSceneRequest {
    readonly op: "loadScene";
    readonly sceneText: string;
    readonly path?: string;
    readonly additive?: boolean;
}

export interface UnloadSceneRequest {
    readonly op: "unloadScene";
    readonly sceneId: number;
}

export interface SetActiveSceneRequest {
    readonly op: "setActiveScene";
    readonly scene: EditorSceneRef;
}

export interface ExportSnapshotRequest {
    readonly op: "exportSnapshot";
}

export interface ImportSnapshotRequest {
    readonly op: "importSnapshot";
    readonly documentText: string;
    readonly editSnapshotText?: string;
    readonly editSnapshotRecords?: readonly number[];
    readonly mode: EditorMode;
    readonly gameplayTicks?: number;
}

export interface SetModeRequest {
    readonly op: "setMode";
    readonly mode: EditorMode;
}

export interface StepRequest {
    readonly op: "step";
}

export interface DescribeAssetTypesRequest {
    readonly op: "describeAssetTypes";
}

export interface GetTickStatsRequest {
    readonly op: "getTickStats";
}

export interface GetResourceRequest {
    readonly op: "getResource";
    readonly typeName: string;
}

export interface SetResourceFieldRequest {
    readonly op: "setResourceField";
    readonly typeName: string;
    readonly key: string;
    readonly value: SceneJsonValue;
}

export interface ListSettingsRequest {
    readonly op: "listSettings";
}

export interface ReloadDataAssetRequest {
    readonly op: "reloadDataAsset";
    readonly path: string;
}

export interface ReloadPrefabRequest {
    readonly op: "reloadPrefab";
    readonly path: string;
}

export interface DefaultResourceFieldsRequest {
    readonly op: "defaultResourceFields";
    readonly typeName: string;
}

export type EditorRequest =
    | DescribeSchemasRequest
    | ListEntitiesRequest
    | GetEntityRequest
    | GetFieldRequest
    | SetFieldRequest
    | SetFieldsRequest
    | AddComponentRequest
    | RemoveComponentRequest
    | CreateEntityRequest
    | DestroyEntityRequest
    | SetEnabledRequest
    | RenameEntityRequest
    | SetParentRequest
    | DuplicateEntitiesRequest
    | SerializeEntitiesRequest
    | InstantiateEntitiesRequest
    | GetPrefabOverridesRequest
    | RevertPrefabInstanceRequest
    | ApplyPrefabInstanceRequest
    | UpdatePrefabInstancesRequest
    | PickEntitiesRequest
    | SetEditorCameraRequest
    | GetViewInfoRequest
    | SetSelectionRequest
    | SaveSceneRequest
    | LoadSceneRequest
    | UnloadSceneRequest
    | SetActiveSceneRequest
    | ExportSnapshotRequest
    | ImportSnapshotRequest
    | SetModeRequest
    | StepRequest
    | DescribeAssetTypesRequest
    | GetTickStatsRequest
    | GetResourceRequest
    | SetResourceFieldRequest
    | ListSettingsRequest
    | ReloadDataAssetRequest
    | ReloadPrefabRequest
    | DefaultResourceFieldsRequest;

export type EditorOp = EditorRequest["op"];

export interface NumberFieldDescription {
    readonly kind: "number" | "integer";
    readonly nullable?: boolean;
    readonly uncapped?: boolean;
    readonly typeName?: string;
    readonly options?: NumberFieldOptions;
}

export interface PlainFieldDescription {
    readonly kind: PlainFieldKind;
}

export interface StringFieldDescription {
    readonly kind: "string";
    readonly nullable: boolean;
    readonly typeName?: string;
}

export interface EntityFieldDescription {
    readonly kind: "entity";
    readonly nullable: boolean;
}

export interface EnumFieldDescription {
    readonly kind: "enum";
    readonly enumNames: readonly string[];
    readonly typeName?: string;
}

export interface AssetFieldDescription {
    readonly kind: "asset";
    readonly assetType: string;
    readonly editableStruct?: StructFieldDescription;
}

export interface ListFieldDescription {
    readonly kind: "list";
    readonly element: EditorFieldTypeDescription;
    readonly elementDefault: SceneJsonValue;
}

export interface StructFieldDescription {
    readonly kind: "struct";
    readonly nullable?: boolean;
    readonly typeName?: string;
    readonly fields: readonly EditorFieldDescription[];
    readonly presentDefault?: SceneJsonValue;
}

export interface CustomFieldDescription {
    readonly kind: "custom";
    readonly typeName: string;
}

export type EditorFieldTypeDescription =
    | NumberFieldDescription
    | PlainFieldDescription
    | StringFieldDescription
    | EntityFieldDescription
    | EnumFieldDescription
    | AssetFieldDescription
    | ListFieldDescription
    | StructFieldDescription
    | CustomFieldDescription;

export type EditorFieldDescription = EditorFieldTypeDescription & {readonly key: string};

export interface EditorComponentDescription {
    readonly typeName: string;
    readonly persistence: ComponentPersistence;
    readonly fields: readonly EditorFieldDescription[];
    readonly inferred: boolean;
    readonly category: string;
}

export interface EditorResourceDescription {
    readonly typeName: string;
    readonly fields: readonly EditorFieldDescription[];
    readonly category?: string;
}

export interface DescribeSchemasResult {
    readonly components: readonly EditorComponentDescription[];
    readonly resources: readonly EditorResourceDescription[];
}

export interface EditorAssetTypeDescription {
    readonly name: string;
    readonly fileSuffixes: readonly string[];
    readonly builtInPaths: readonly string[];
    readonly dataAsset: boolean;
}

export interface DescribeAssetTypesResult {
    readonly assetTypes: readonly EditorAssetTypeDescription[];
}

export interface EditorTickStats {
    readonly ticks: number;
    readonly tickMsTotal: number;
    readonly timeMs: number;
}

export interface EditorEntitySummary {
    readonly entity: Entity;
    readonly name: string | null;
    readonly enabled: boolean;
    readonly parent: Entity | null;
    readonly siblingIndex: number;
    readonly prefabSourcePath: string | null;
    readonly componentTypeNames: readonly string[];
    readonly sceneId: number;
}

export interface ListEntitiesResult {
    readonly entities: readonly EditorEntitySummary[];
    readonly scenes: readonly EditorSceneRef[];
    readonly activeSceneId: number;
    readonly editedSceneIds: readonly number[];
}

export interface InlineSpriteImageSummary {
    readonly inline: {readonly width: number, readonly height: number};
}

export type EditorFieldValue = SceneJsonValue | InlineSpriteImageSummary;

export interface EditorComponentDetails {
    readonly typeName: string;
    readonly inspectable: boolean;
    readonly inferred: boolean;
    readonly fields: {readonly [key: string]: EditorFieldValue};
}

export interface EditorEntityDetails {
    readonly entity: Entity;
    readonly name: string | null;
    readonly enabled: boolean;
    readonly parent: Entity | null;
    readonly siblingIndex: number;
    readonly prefabSourcePath: string | null;
    readonly components: readonly EditorComponentDetails[];
}

export interface SetFieldResult {
    readonly value: EditorFieldValue;
}

export interface GetFieldResult {
    readonly value: SceneJsonValue;
}

export interface EditorResourceDetails {
    readonly typeName: string;
    readonly dataAssetPath: string | null;
    readonly fields: {readonly [key: string]: EditorFieldValue};
}

export interface EditorSettingsEntity {
    readonly entity: Entity;
    readonly name: string | null;
    readonly enabled: boolean;
    readonly settingsComponentTypeNames: readonly string[];
}

export interface EditorResourceSummary {
    readonly typeName: string;
    readonly dataAssetPath: string | null;
}

export interface ReloadDataAssetResult {
    readonly reloaded: boolean;
}

export interface ReloadPrefabResult {
    readonly reloaded: boolean;
}

export interface DefaultResourceFieldsResult {
    readonly fields: SceneJsonObject;
}

export interface ListSettingsResult {
    readonly entities: readonly EditorSettingsEntity[];
    readonly resources: readonly EditorResourceSummary[];
}

export interface SetFieldsResult {
    readonly values: readonly EditorFieldValue[];
}

export interface DestroyEntityResult {
    readonly destroyed: readonly Entity[];
}

export interface DuplicateEntitiesResult {
    readonly roots: readonly Entity[];
}

export interface SerializeEntitiesResult {
    readonly documentText: string;
    readonly report: SceneSaveReport;
}

export interface InstantiateEntitiesResult {
    readonly roots: readonly Entity[];
    readonly entities: readonly Entity[];
    readonly report: SceneLoadReport;
}

export interface PrefabOverridesResult {
    readonly sourcePath: string;
    readonly overrides: readonly string[];
}

export interface ApplyPrefabInstanceResult {
    readonly documentText: string;
}

export interface UpdatePrefabInstancesResult {
    readonly updated: readonly Entity[];
}

export interface PickEntitiesResult {
    readonly entities: readonly Entity[];
}

export interface EditorCameraPose {
    readonly position: EditorVec3;
    readonly rotation: EditorQuaternion;
    readonly fieldOfViewDegrees?: number;
}

export interface EditorEntityBounds {
    readonly entity: Entity;
    readonly min: EditorVec3;
    readonly max: EditorVec3;
    readonly pivot: EditorVec3;
    readonly rotation: EditorQuaternion;
}

export interface EditorViewInfo {
    readonly view: EditorView;
    readonly projection: EditorProjection;
    readonly worldToScreen: readonly number[];
    readonly screenWidth: number;
    readonly screenHeight: number;
    readonly camera: EditorCameraPose;
    readonly bounds: readonly EditorEntityBounds[];
    readonly sceneViews: readonly SceneViewId[];
    readonly presentedFrames?: number;
}

export interface SetSelectionResult {
    readonly entities: readonly Entity[];
}

export interface SaveSceneResult {
    readonly sceneText: string;
    readonly report: SceneSaveReport;
    readonly sceneId: number;
}

export interface LoadSceneResult {
    readonly entityCount: number;
    readonly report: SceneLoadReport;
    readonly sceneId: number;
}

export interface UnloadSceneResult {
    readonly activeSceneId: number;
}

export interface SetActiveSceneResult {
    readonly sceneId: number;
}

export interface ExportSnapshotResult {
    readonly documentText: string;
    readonly mode: EditorMode;
    readonly gameplayTicks: number;
    readonly entities: readonly Entity[];
    readonly editSnapshotText?: string;
    readonly editSnapshotRecords?: readonly number[];
}

export interface ImportSnapshotResult {
    readonly entities: readonly Entity[];
    readonly report: SceneLoadReport;
}

export interface EditorPlayState {
    readonly mode: EditorMode;
    readonly gameplayTicks: number;
}

export interface EditorServiceState extends EditorPlayState {
    readonly worldStoppedError: string | null;
}

export interface EditorResultByOp {
    readonly describeSchemas: DescribeSchemasResult;
    readonly listEntities: ListEntitiesResult;
    readonly getEntity: EditorEntityDetails;
    readonly getField: GetFieldResult;
    readonly setField: SetFieldResult;
    readonly setFields: SetFieldsResult;
    readonly addComponent: EditorEntityDetails;
    readonly removeComponent: EditorEntityDetails;
    readonly createEntity: EditorEntityDetails;
    readonly destroyEntity: DestroyEntityResult;
    readonly setEnabled: EditorEntityDetails;
    readonly renameEntity: EditorEntityDetails;
    readonly setParent: EditorEntityDetails;
    readonly duplicateEntities: DuplicateEntitiesResult;
    readonly serializeEntities: SerializeEntitiesResult;
    readonly instantiateEntities: InstantiateEntitiesResult;
    readonly getPrefabOverrides: PrefabOverridesResult;
    readonly revertPrefabInstance: PrefabOverridesResult;
    readonly applyPrefabInstance: ApplyPrefabInstanceResult;
    readonly updatePrefabInstances: UpdatePrefabInstancesResult;
    readonly pickEntities: PickEntitiesResult;
    readonly setEditorCamera: EditorViewInfo;
    readonly getViewInfo: EditorViewInfo;
    readonly setSelection: SetSelectionResult;
    readonly saveScene: SaveSceneResult;
    readonly loadScene: LoadSceneResult;
    readonly unloadScene: UnloadSceneResult;
    readonly setActiveScene: SetActiveSceneResult;
    readonly exportSnapshot: ExportSnapshotResult;
    readonly importSnapshot: ImportSnapshotResult;
    readonly setMode: EditorServiceState;
    readonly step: EditorServiceState;
    readonly describeAssetTypes: DescribeAssetTypesResult;
    readonly getTickStats: EditorTickStats;
    readonly getResource: EditorResourceDetails;
    readonly setResourceField: SetFieldResult;
    readonly listSettings: ListSettingsResult;
    readonly reloadDataAsset: ReloadDataAssetResult;
    readonly reloadPrefab: ReloadPrefabResult;
    readonly defaultResourceFields: DefaultResourceFieldsResult;
}

export type EditorResultOf<R extends EditorRequest> = EditorResultByOp[R["op"]];

export type EditorResult = EditorResultByOp[EditorOp];

export interface EditorConsoleEvent {
    readonly kind: "console";
    readonly level: EditorConsoleLevel;
    readonly text: string;
    readonly timeMs: number;
    readonly stack?: string;
}

export interface EditorWorldStoppedEvent {
    readonly kind: "worldStopped";
    readonly error: string;
    readonly stack?: string;
}

export interface EditorModeChangedEvent {
    readonly kind: "modeChanged";
    readonly mode: EditorMode;
    readonly gameplayTicks: number;
}

export interface EditorGameCameraChangedEvent {
    readonly kind: "gameCameraChanged";
    readonly present: boolean;
}

export type EditorEvent = EditorConsoleEvent | EditorWorldStoppedEvent | EditorModeChangedEvent | EditorGameCameraChangedEvent;

export interface EditorRequestMessage {
    readonly type: typeof EDITOR_MESSAGE_TYPE;
    readonly requestId: number;
    readonly request: EditorRequest;
}

export interface EditorSuccessMessage {
    readonly type: typeof EDITOR_MESSAGE_TYPE;
    readonly requestId: number;
    readonly ok: true;
    readonly result: EditorResult;
}

export interface EditorFailureMessage {
    readonly type: typeof EDITOR_MESSAGE_TYPE;
    readonly requestId: number;
    readonly ok: false;
    readonly error: string;
    readonly stack?: string;
}

export type EditorResponseMessage = EditorSuccessMessage | EditorFailureMessage;

export interface EditorEventMessage {
    readonly type: typeof EDITOR_MESSAGE_TYPE;
    readonly event: EditorEvent;
}

export type EditorWorldMessage = EditorResponseMessage | EditorEventMessage;

type MessageFields = {readonly [key: string]: unknown};

function isRecord(value: unknown): value is MessageFields {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isRequestId(value: unknown): value is number {
    return typeof value === "number" && Number.isSafeInteger(value);
}

function isEntityHandle(value: unknown): value is Entity {
    return typeof value === "number" && Number.isInteger(value) && value >= 0 && value < ENTITY_HANDLE_LIMIT;
}

function isNullableEntityHandle(value: unknown): boolean {
    return value === null || isEntityHandle(value);
}

function isEntityList(value: unknown): boolean {
    return Array.isArray(value) && value.every(isEntityHandle);
}

function isEditorMode(value: unknown): value is EditorMode {
    return EDITOR_MODES.some(mode => mode === value);
}

function isEditorView(value: unknown): value is EditorView {
    return value === GAME_VIEW || isSceneViewId(value);
}

function isConsoleLevel(value: unknown): value is EditorConsoleLevel {
    return EDITOR_CONSOLE_LEVELS.some(level => level === value);
}

function isString(value: unknown): value is string {
    return typeof value === "string";
}

function isStringList(value: unknown): boolean {
    return Array.isArray(value) && value.every(isString);
}

function isFiniteNumber(value: unknown): value is number {
    return typeof value === "number" && Number.isFinite(value);
}

function isWholeNumber(value: unknown): value is number {
    return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isRecordIndexList(value: unknown): boolean {
    return Array.isArray(value) && value.every(index => typeof index === "number" && Number.isSafeInteger(index) && index >= -1);
}

function isFiniteTuple(value: unknown, length: number): boolean {
    return Array.isArray(value) && value.length === length && value.every(isFiniteNumber);
}

function isFieldOfViewDegrees(value: unknown): boolean {
    return isFiniteNumber(value) && value > 0 && value < MAX_FIELD_OF_VIEW_DEGREES;
}

function isAbsentOr(value: unknown, guard: (present: unknown) => boolean): boolean {
    return value === undefined || guard(value);
}

function targetsComponent(request: MessageFields): boolean {
    return isEntityHandle(request.entity) && isString(request.typeName);
}

function isFieldEdit(value: unknown): boolean {
    return isRecord(value) && targetsComponent(value) && isString(value.key) && value.value !== undefined;
}

function isComponentValues(value: unknown): boolean {
    return isRecord(value) && Object.values(value).every(isRecord);
}

function isSceneRef(value: unknown): boolean {
    return isRecord(value) && isWholeNumber(value.id) && (value.path === null || isString(value.path));
}

function isBoolean(value: unknown): boolean {
    return typeof value === "boolean";
}

export function isEditorRequest(value: unknown): value is EditorRequest {
    if (!isRecord(value)) return false;
    switch (value.op) {
        case "describeSchemas":
        case "listEntities":
        case "exportSnapshot":
        case "step":
        case "describeAssetTypes":
        case "getTickStats":
        case "listSettings":
            return true;
        case "getEntity":
        case "destroyEntity":
        case "getPrefabOverrides":
        case "applyPrefabInstance":
            return isEntityHandle(value.entity);
        case "getField":
            return targetsComponent(value) && isString(value.key);
        case "setField":
            return isFieldEdit(value);
        case "setFields":
            return Array.isArray(value.edits) && value.edits.every(isFieldEdit);
        case "addComponent":
            return targetsComponent(value) && isAbsentOr(value.values, isRecord);
        case "removeComponent":
            return targetsComponent(value);
        case "createEntity":
            return isAbsentOr(value.name, isString) && isAbsentOr(value.parent, isEntityHandle) && isAbsentOr(value.components, isComponentValues);
        case "setEnabled":
            return isEntityHandle(value.entity) && typeof value.enabled === "boolean";
        case "renameEntity":
            return isEntityHandle(value.entity) && (value.name === null || isString(value.name));
        case "setParent":
            return isEntityHandle(value.entity) && isNullableEntityHandle(value.parent) && isAbsentOr(value.siblingIndex, isWholeNumber);
        case "duplicateEntities":
        case "serializeEntities":
        case "setSelection":
            return isEntityList(value.entities);
        case "instantiateEntities":
            return isString(value.documentText)
                && isAbsentOr(value.parent, isNullableEntityHandle)
                && isAbsentOr(value.siblingIndex, isWholeNumber)
                && isAbsentOr(value.prefabSourcePath, isString)
                && isAbsentOr(value.scene, isSceneRef);
        case "revertPrefabInstance":
            return isEntityHandle(value.entity) && isAbsentOr(value.paths, isStringList);
        case "updatePrefabInstances":
            return isString(value.sourcePath) && isString(value.documentText);
        case "pickEntities":
            return isFiniteNumber(value.x) && isFiniteNumber(value.y) && isEditorView(value.view);
        case "setEditorCamera":
            return isSceneViewId(value.view)
                && isFiniteTuple(value.position, VEC3_LENGTH)
                && isFiniteTuple(value.rotation, QUATERNION_LENGTH)
                && isAbsentOr(value.fieldOfViewDegrees, isFieldOfViewDegrees);
        case "getViewInfo":
            return isEditorView(value.view) && isAbsentOr(value.entities, isEntityList);
        case "saveScene":
            return isAbsentOr(value.scene, isSceneRef);
        case "loadScene":
            return isString(value.sceneText) && isAbsentOr(value.path, isString) && isAbsentOr(value.additive, isBoolean);
        case "unloadScene":
            return isWholeNumber(value.sceneId);
        case "setActiveScene":
            return isSceneRef(value.scene);
        case "importSnapshot":
            return isString(value.documentText)
                && isEditorMode(value.mode)
                && isAbsentOr(value.editSnapshotText, isString)
                && isAbsentOr(value.editSnapshotRecords, isRecordIndexList)
                && isAbsentOr(value.gameplayTicks, isWholeNumber);
        case "setMode":
            return isEditorMode(value.mode);
        case "getResource":
        case "defaultResourceFields":
            return isString(value.typeName);
        case "reloadDataAsset":
        case "reloadPrefab":
            return isString(value.path);
        case "setResourceField":
            return isString(value.typeName) && isString(value.key) && value.value !== undefined;
        default:
            return false;
    }
}

export function isEditorEvent(value: unknown): value is EditorEvent {
    if (!isRecord(value)) return false;
    switch (value.kind) {
        case "console":
            return isConsoleLevel(value.level) && isString(value.text) && isFiniteNumber(value.timeMs) && isAbsentOr(value.stack, isString);
        case "worldStopped":
            return isString(value.error) && isAbsentOr(value.stack, isString);
        case "modeChanged":
            return isEditorMode(value.mode) && isWholeNumber(value.gameplayTicks);
        case "gameCameraChanged":
            return isBoolean(value.present);
        default:
            return false;
    }
}

function isEditorMessage(message: unknown): message is MessageFields {
    return isRecord(message) && message.type === EDITOR_MESSAGE_TYPE && isRequestId(message.requestId);
}

export function isEditorRequestMessage(message: unknown): message is EditorRequestMessage {
    return isEditorMessage(message) && isEditorRequest(message.request);
}

export function isEditorResponseMessage(message: unknown): message is EditorResponseMessage {
    if (!isEditorMessage(message)) return false;
    if (message.ok === true) return "result" in message;
    return message.ok === false && isString(message.error) && isAbsentOr(message.stack, isString);
}

export function isEditorEventMessage(message: unknown): message is EditorEventMessage {
    return isRecord(message) && message.type === EDITOR_MESSAGE_TYPE && !("requestId" in message) && isEditorEvent(message.event);
}

export function requestIdOfMalformedEditorRequest(message: unknown): number | undefined {
    if (!isEditorMessage(message) || "ok" in message || isEditorRequest(message.request)) return undefined;
    return message.requestId as number;
}
