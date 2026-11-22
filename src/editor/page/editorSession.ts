import type {Entity} from "../../engine/core";
import type {EditorEvent} from "../editorProtocol";
import type {ProjectFileSystem} from "../project/projectFileSystem";
import type {EditorClient} from "./editorClient";

export interface EditorProject {
    readonly name: string;
    readonly startScene: string | null;
}

export interface EditorEventSource {
    onEvent(listener: (event: EditorEvent) => void): () => void;
}

export interface EditorSession {
    readonly client: EditorClient;
    readonly events: EditorEventSource;
    readonly files: ProjectFileSystem;
    readonly project: EditorProject;
}

export type EntityRemap = ReadonlyMap<Entity, Entity>;

export type EditorNoticeLevel = "info" | "warn" | "error";

export interface EditorShell {
    readonly viewport: HTMLElement;

    mount(session: EditorSession): Promise<void>;

    replaceSession(session: EditorSession, remap: EntityRemap): Promise<void>;

    notice(level: EditorNoticeLevel, text: string): void;

    showTargetLabel(text: string): void;
}
