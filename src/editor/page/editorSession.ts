import type {Entity} from "../../engine/core";
import type {EditorEvent} from "../editorProtocol";
import type {ProjectFileSystem} from "../project/projectFileSystem";
import type {MenuEntry} from "./commandMenus";
import type {CommandRegistry} from "./commandRegistry";
import type {EditorClient} from "./editorClient";
import type {StackMapper} from "./stackMapper";

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
    readonly stackMapper?: StackMapper;
}

export type EntityRemap = ReadonlyMap<Entity, Entity>;

export type EditorNoticeLevel = "info" | "warn" | "error";

export interface EditorShell {
    readonly viewport: HTMLElement;
    readonly sceneViewport: HTMLElement;
    readonly commands: CommandRegistry;

    mount(session: EditorSession): Promise<void>;

    replaceSession(session: EditorSession, remap: EntityRemap): Promise<void>;

    notice(level: EditorNoticeLevel, text: string, stack?: string): void;

    showTargetLabel(text: string): void;

    setGameTargetMenu(entries: readonly MenuEntry[]): void;

    onSceneViewShown(listener: (shown: boolean) => void): () => void;
}
