import type {Entity} from "../engine/core";
import type {ComponentPersistence, PlainFieldKind, SceneJsonObject, SceneJsonValue, SceneLoadReport, SceneSaveReport} from "../engine/scene";

export const EDITOR_MESSAGE_TYPE = "jsengine-editor";

export const ENTITY_HANDLE_LIMIT = 2 ** 32;

export type EditorMode = "edit" | "play" | "paused";

export const EDITOR_MODES: readonly EditorMode[] = ["edit", "play", "paused"];

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

export interface SetFieldRequest {
    readonly op: "setField";
    readonly entity: Entity;
    readonly typeName: string;
    readonly key: string;
    readonly value: SceneJsonValue;
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

export interface SaveSceneRequest {
    readonly op: "saveScene";
}

export interface LoadSceneRequest {
    readonly op: "loadScene";
    readonly sceneText: string;
}

export interface SetModeRequest {
    readonly op: "setMode";
    readonly mode: EditorMode;
}

export interface StepRequest {
    readonly op: "step";
}

export type EditorRequest =
    | DescribeSchemasRequest
    | ListEntitiesRequest
    | GetEntityRequest
    | SetFieldRequest
    | AddComponentRequest
    | RemoveComponentRequest
    | CreateEntityRequest
    | DestroyEntityRequest
    | SetEnabledRequest
    | SaveSceneRequest
    | LoadSceneRequest
    | SetModeRequest
    | StepRequest;

export type EditorOp = EditorRequest["op"];

export interface PlainFieldDescription {
    readonly key: string;
    readonly kind: PlainFieldKind;
}

export interface NullableFieldDescription {
    readonly key: string;
    readonly kind: "string" | "entity";
    readonly nullable: boolean;
}

export interface EnumFieldDescription {
    readonly key: string;
    readonly kind: "enum";
    readonly enumNames: readonly string[];
}

export type EditorFieldDescription = PlainFieldDescription | NullableFieldDescription | EnumFieldDescription;

export interface EditorComponentDescription {
    readonly typeName: string;
    readonly persistence: ComponentPersistence;
    readonly fields: readonly EditorFieldDescription[];
}

export interface DescribeSchemasResult {
    readonly components: readonly EditorComponentDescription[];
}

export interface EditorEntitySummary {
    readonly entity: Entity;
    readonly name: string | null;
    readonly enabled: boolean;
    readonly parent: Entity | null;
    readonly componentTypeNames: readonly string[];
}

export interface ListEntitiesResult {
    readonly entities: readonly EditorEntitySummary[];
}

export interface InlineSpriteImageSummary {
    readonly inline: {readonly width: number, readonly height: number};
}

export type EditorFieldValue = SceneJsonValue | InlineSpriteImageSummary;

export interface EditorComponentDetails {
    readonly typeName: string;
    readonly inspectable: boolean;
    readonly fields: {readonly [key: string]: EditorFieldValue};
}

export interface EditorEntityDetails {
    readonly entity: Entity;
    readonly name: string | null;
    readonly enabled: boolean;
    readonly parent: Entity | null;
    readonly components: readonly EditorComponentDetails[];
}

export interface SetFieldResult {
    readonly value: EditorFieldValue;
}

export interface DestroyEntityResult {
    readonly destroyed: readonly Entity[];
}

export interface SaveSceneResult {
    readonly sceneText: string;
    readonly report: SceneSaveReport;
}

export interface LoadSceneResult {
    readonly entityCount: number;
    readonly report: SceneLoadReport;
}

export interface EditorPlayState {
    readonly mode: EditorMode;
    readonly gameplayTicks: number;
}

export interface EditorResultByOp {
    readonly describeSchemas: DescribeSchemasResult;
    readonly listEntities: ListEntitiesResult;
    readonly getEntity: EditorEntityDetails;
    readonly setField: SetFieldResult;
    readonly addComponent: EditorEntityDetails;
    readonly removeComponent: EditorEntityDetails;
    readonly createEntity: EditorEntityDetails;
    readonly destroyEntity: DestroyEntityResult;
    readonly setEnabled: EditorEntityDetails;
    readonly saveScene: SaveSceneResult;
    readonly loadScene: LoadSceneResult;
    readonly setMode: EditorPlayState;
    readonly step: EditorPlayState;
}

export type EditorResultOf<R extends EditorRequest> = EditorResultByOp[R["op"]];

export type EditorResult = EditorResultByOp[EditorOp];

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
}

export type EditorResponseMessage = EditorSuccessMessage | EditorFailureMessage;

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

function isEditorMode(value: unknown): value is EditorMode {
    return EDITOR_MODES.some(mode => mode === value);
}

function isString(value: unknown): value is string {
    return typeof value === "string";
}

function isAbsentOr(value: unknown, guard: (present: unknown) => boolean): boolean {
    return value === undefined || guard(value);
}

function targetsComponent(request: MessageFields): boolean {
    return isEntityHandle(request.entity) && isString(request.typeName);
}

export function isEditorRequest(value: unknown): value is EditorRequest {
    if (!isRecord(value)) return false;
    switch (value.op) {
        case "describeSchemas":
        case "listEntities":
        case "saveScene":
        case "step":
            return true;
        case "getEntity":
        case "destroyEntity":
            return isEntityHandle(value.entity);
        case "setField":
            return targetsComponent(value) && isString(value.key) && value.value !== undefined;
        case "addComponent":
            return targetsComponent(value) && isAbsentOr(value.values, isRecord);
        case "removeComponent":
            return targetsComponent(value);
        case "createEntity":
            return isAbsentOr(value.name, isString) && isAbsentOr(value.parent, isEntityHandle);
        case "setEnabled":
            return isEntityHandle(value.entity) && typeof value.enabled === "boolean";
        case "loadScene":
            return isString(value.sceneText);
        case "setMode":
            return isEditorMode(value.mode);
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
    return message.ok === false && isString(message.error);
}

export function requestIdOfMalformedEditorRequest(message: unknown): number | undefined {
    if (!isEditorMessage(message) || "ok" in message || isEditorRequest(message.request)) return undefined;
    return message.requestId as number;
}
