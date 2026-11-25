export type DockPanelKind = "hierarchy" | "inspector" | "scene" | "game" | "project" | "console" | "history" | "settings" | "assets";
export type InstancedDockPanelKind = "scene";
export type DockPanelInstanceId<Kind extends InstancedDockPanelKind> = Kind | `${Kind}:${number}`;
export type SceneViewId = DockPanelInstanceId<"scene">;
export type DockPanelId = DockPanelKind | SceneViewId;
export type GameViewId = "game";
export type EditorViewportId = GameViewId | SceneViewId;

export const DOCK_PANEL_KINDS: readonly DockPanelKind[] = ["hierarchy", "inspector", "scene", "game", "project", "console", "history", "settings", "assets"];
export const INSTANCED_DOCK_PANEL_KINDS: readonly InstancedDockPanelKind[] = ["scene"];
export const SCENE_VIEW_KIND: InstancedDockPanelKind = "scene";
export const FIRST_SCENE_VIEW: SceneViewId = SCENE_VIEW_KIND;
export const GAME_VIEW_ID: GameViewId = "game";
export const FIRST_INSTANCE = 1;

const INSTANCE_SEPARATOR = ":";
const INSTANCE_NUMBER = /^[1-9]\d*$/;
const KNOWN_KINDS: ReadonlySet<string> = new Set<string>(DOCK_PANEL_KINDS);
const INSTANCED_KINDS: ReadonlySet<string> = new Set<string>(INSTANCED_DOCK_PANEL_KINDS);

interface ParsedPanelId {
    readonly kind: DockPanelKind;
    readonly instance: number;
}

function parsePanelId(value: string): ParsedPanelId | undefined {
    const separator = value.indexOf(INSTANCE_SEPARATOR);
    if (separator < 0) return KNOWN_KINDS.has(value) ? {kind: value as DockPanelKind, instance: FIRST_INSTANCE} : undefined;
    const kind = value.slice(0, separator);
    const number = value.slice(separator + INSTANCE_SEPARATOR.length);
    if (!INSTANCED_KINDS.has(kind) || !INSTANCE_NUMBER.test(number)) return undefined;
    const instance = Number(number);
    return Number.isSafeInteger(instance) && instance > FIRST_INSTANCE ? {kind: kind as DockPanelKind, instance} : undefined;
}

export function isDockPanelId(value: unknown): value is DockPanelId {
    return typeof value === "string" && parsePanelId(value) !== undefined;
}

export function isSceneViewId(value: unknown): value is SceneViewId {
    return typeof value === "string" && parsePanelId(value)?.kind === SCENE_VIEW_KIND;
}

export function isInstancedDockPanelKind(kind: DockPanelKind): kind is InstancedDockPanelKind {
    return INSTANCED_KINDS.has(kind);
}

export function dockPanelKindOf(panel: DockPanelId): DockPanelKind {
    return parsePanelId(panel)?.kind ?? (panel as DockPanelKind);
}

export function dockPanelInstanceOf(panel: DockPanelId): number {
    return parsePanelId(panel)?.instance ?? FIRST_INSTANCE;
}

export function isFirstDockPanelInstance(panel: DockPanelId): boolean {
    return dockPanelInstanceOf(panel) === FIRST_INSTANCE;
}

export function dockPanelInstanceId<Kind extends InstancedDockPanelKind>(kind: Kind, instance: number): DockPanelInstanceId<Kind> {
    return instance === FIRST_INSTANCE ? kind : `${kind}${INSTANCE_SEPARATOR}${instance}` as DockPanelInstanceId<Kind>;
}

export function nextDockPanelInstance<Kind extends InstancedDockPanelKind>(kind: Kind, taken: Iterable<DockPanelId>): DockPanelInstanceId<Kind> {
    const used = new Set<DockPanelId>(taken);
    let instance = FIRST_INSTANCE;
    while (used.has(dockPanelInstanceId(kind, instance))) instance++;
    return dockPanelInstanceId(kind, instance);
}

export function dockPanelTitle(panel: DockPanelId, kindTitle: string): string {
    const instance = dockPanelInstanceOf(panel);
    return instance === FIRST_INSTANCE ? kindTitle : `${kindTitle} (${instance})`;
}
