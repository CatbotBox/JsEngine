import {expect} from "../../engine/testing/harness";
import {MemoryPlatform} from "../../engine/testing/memoryPlatform";
import {DebugWorld, EntityCommandBufferSystem, System, World} from "../../engine/core";
import type {Entity} from "../../engine/core";
import {Children} from "../../engine/translation/children";
import {RenderingSystemGroup} from "../../engine/rendering/renderingSystemGroup";
import {encodePpm} from "../../engine/assets/image/ppm";
import {ComponentSchemaRegistry, registerEngineComponentSchemas} from "../../engine/scene";
import {isEditorEventMessage} from "../editorProtocol";
import type {EditorEntityDetails, EditorEntitySummary, EditorEvent, EditorRequest, EditorResultOf} from "../editorProtocol";
import {EditorClient, EditorRequestError} from "../page/editorClient";
import {attachEditorWorldService} from "./editorWorldService";
import type {EditorWorldService} from "./editorWorldService";

export const TICK_MS = 2;
export const SETTLE_FRAMES = 5;
export const SPRITE_PATH = "sprites/dot.ppm";
export const RED_PIXEL_RGBA = new Uint8Array([255, 0, 0, 255]);

const WAIT_TIMEOUT_MS = 3_000;
const POLL_INTERVAL_MS = 2;
const DELIVERY_DELAY_MS = 0;
const PRELOAD_DELAY_MS = 10;

export class GameplayCounterSystem extends System {
    public runs = 0;

    public onUpdate(): void {
        this.runs++;
    }
}

export class SwitchedOffGameplaySystem extends System {
    public runs = 0;

    public onUpdate(): void {
        this.runs++;
    }
}

export class RenderProbeSystem extends System {
    public frames = 0;

    override systemGroup() {
        return RenderingSystemGroup;
    }

    public onUpdate(): void {
        this.frames++;
    }
}

type MessageListener = (event: {readonly data: unknown}) => void;

export class MessagePipe {
    public failingDeliveries = 0;
    private readonly listeners: MessageListener[] = [];

    public listen(listener: MessageListener): void {
        this.listeners.push(listener);
    }

    public deliver(message: unknown): void {
        if (this.failingDeliveries > 0) {
            this.failingDeliveries--;
            throw new Error("DataCloneError: simulated");
        }
        const data = structuredClone(message);
        setTimeout(() => {
            for (const listener of this.listeners) listener({data});
        }, DELIVERY_DELAY_MS);
    }
}

export interface Harnessed {
    readonly world: World;
    readonly registry: ComponentSchemaRegistry;
    readonly service: EditorWorldService;
    readonly client: EditorClient;
    readonly counter: GameplayCounterSystem;
    readonly switchedOff: SwitchedOffGameplaySystem;
    readonly probe: RenderProbeSystem;
    readonly toWorld: MessagePipe;
    readonly toPage: MessagePipe;
    readonly preloaded: string[][];
    readonly events: EditorEvent[];
}

export interface EditorWorldOptions {
    readonly debugWorld?: boolean;
    readonly register?: (registry: ComponentSchemaRegistry) => void;
    readonly files?: Readonly<Record<string, string | Uint8Array>>;
    readonly tickMs?: number;
}

const running: Harnessed[] = [];

export const sleep = (ms: number) => new Promise(done => setTimeout(done, ms));

export function disposeEditorWorlds(): void {
    for (const harnessed of running.splice(0)) {
        harnessed.client.close();
        harnessed.service.detach();
    }
}

export function editorWorld(populate: (world: World) => void = () => undefined, options: EditorWorldOptions = {}): Harnessed {
    const platform = new MemoryPlatform({files: {[SPRITE_PATH]: encodePpm(1, 1, RED_PIXEL_RGBA), ...options.files}});
    const world = options.debugWorld === true ? new DebugWorld({platform}) : new World({platform});
    world.targetDeltaTimeMs = options.tickMs ?? TICK_MS;
    world.ensureSystemExists(EntityCommandBufferSystem);
    const probe = world.getOrCreateSystem(RenderProbeSystem);
    const counter = world.getOrCreateSystem(GameplayCounterSystem);
    const switchedOff = world.getOrCreateSystem(SwitchedOffGameplaySystem);
    switchedOff.enabled = false;
    populate(world);

    const registry = new ComponentSchemaRegistry();
    registerEngineComponentSchemas(registry);
    options.register?.(registry);
    const toWorld = new MessagePipe();
    const toPage = new MessagePipe();
    const preloaded: string[][] = [];
    const events: EditorEvent[] = [];
    toPage.listen(event => {
        if (isEditorEventMessage(event.data)) events.push(event.data.event);
    });
    const service = attachEditorWorldService({
        postMessage: message => toPage.deliver(message),
        addEventListener: (_type, listener) => toWorld.listen(listener),
    }, world, registry, {
        preloadAssets: async paths => {
            preloaded.push([...paths]);
            await sleep(PRELOAD_DELAY_MS);
        },
    });
    const client = new EditorClient({
        postMessage: message => toWorld.deliver(message),
        addEventListener: (_type, listener) => toPage.listen(listener),
    });
    const harnessed = {world, registry, service, client, counter, switchedOff, probe, toWorld, toPage, preloaded, events};
    running.push(harnessed);
    return harnessed;
}

export function ask<R extends EditorRequest>(harnessed: Harnessed, request: R): Promise<EditorResultOf<R>> {
    return harnessed.client.request(request);
}

export async function failureOf(promise: Promise<unknown>): Promise<string> {
    try {
        await promise;
    } catch (error) {
        expect(error).toBeInstanceOf(EditorRequestError);
        return (error as Error).message;
    }
    throw new Error("expected the editor request to fail");
}

export async function waitUntil(condition: () => boolean): Promise<boolean> {
    const deadline = performance.now() + WAIT_TIMEOUT_MS;
    while (!condition()) {
        if (performance.now() > deadline) return false;
        await sleep(POLL_INTERVAL_MS);
    }
    return true;
}

export async function framesPass(harnessed: Harnessed, frames: number = SETTLE_FRAMES): Promise<boolean> {
    const target = harnessed.probe.frames + frames;
    return waitUntil(() => harnessed.probe.frames >= target);
}

export function byName(entities: readonly EditorEntitySummary[], name: string): EditorEntitySummary | undefined {
    return entities.find(entity => entity.name === name);
}

export function fieldsOf(details: EditorEntityDetails, typeName: string): {readonly [key: string]: unknown} | undefined {
    return details.components.find(component => component.typeName === typeName)?.fields;
}

export function childrenOf(world: World, parent: Entity): readonly Entity[] {
    return world.entityManager.getComponent<Children>(parent, Children)?.children ?? [];
}
