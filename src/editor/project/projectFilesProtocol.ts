export const PROJECT_FILES_MESSAGE_TYPE = "jsengine-project-files";

export interface ProjectListedFile {
    readonly path: string;
    readonly size: number;
    readonly mtimeMs: number;
}

export interface ProjectListingMessage {
    readonly type: typeof PROJECT_FILES_MESSAGE_TYPE;
    readonly kind: "listing";
    readonly files: readonly ProjectListedFile[];
}

export interface ProjectListingFailedMessage {
    readonly type: typeof PROJECT_FILES_MESSAGE_TYPE;
    readonly kind: "listingFailed";
    readonly error: string;
}

export interface ProjectFileContentsMessage {
    readonly type: typeof PROJECT_FILES_MESSAGE_TYPE;
    readonly kind: "contents";
    readonly requestId: number;
    readonly ok: true;
    readonly bytes: ArrayBuffer;
}

export interface ProjectFileFailureMessage {
    readonly type: typeof PROJECT_FILES_MESSAGE_TYPE;
    readonly kind: "contents";
    readonly requestId: number;
    readonly ok: false;
    readonly error: string;
}

export type ProjectFilesPageMessage = ProjectListingMessage | ProjectListingFailedMessage | ProjectFileContentsMessage | ProjectFileFailureMessage;

export interface ProjectFileReadMessage {
    readonly type: typeof PROJECT_FILES_MESSAGE_TYPE;
    readonly kind: "read";
    readonly requestId: number;
    readonly path: string;
}

export type ProjectFilesWorldMessage = ProjectFileReadMessage;

type MessageFields = {readonly [key: string]: unknown};

function isProjectFilesMessage(message: unknown): message is MessageFields {
    return typeof message === "object" && message !== null && (message as MessageFields).type === PROJECT_FILES_MESSAGE_TYPE;
}

function isWholeNumber(value: unknown): value is number {
    return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isFiniteNumber(value: unknown): value is number {
    return typeof value === "number" && Number.isFinite(value);
}

export function isProjectListedFile(value: unknown): value is ProjectListedFile {
    if (typeof value !== "object" || value === null) return false;
    const file = value as MessageFields;
    return typeof file.path === "string" && file.path.length > 0 && isWholeNumber(file.size) && isFiniteNumber(file.mtimeMs);
}

export function isProjectFilesPageMessage(message: unknown): message is ProjectFilesPageMessage {
    if (!isProjectFilesMessage(message)) return false;
    switch (message.kind) {
        case "listing":
            return Array.isArray(message.files) && message.files.every(isProjectListedFile);
        case "listingFailed":
            return typeof message.error === "string";
        case "contents":
            if (!isWholeNumber(message.requestId)) return false;
            if (message.ok === true) return message.bytes instanceof ArrayBuffer;
            return message.ok === false && typeof message.error === "string";
        default:
            return false;
    }
}

export function isProjectFilesWorldMessage(message: unknown): message is ProjectFilesWorldMessage {
    return isProjectFilesMessage(message) && message.kind === "read" && isWholeNumber(message.requestId)
        && typeof message.path === "string" && message.path.length > 0;
}
