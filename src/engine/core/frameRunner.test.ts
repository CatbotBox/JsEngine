import {describe, expect, test} from "../testing/harness";
import {MemoryPlatform} from "../testing/memoryPlatform";
import {ManualFrameScheduler} from "../testing/manualFrameScheduler";
import {World} from "./world";
import {System} from "./system";
import type {SystemCtor} from "./system";
import {SystemGroup} from "./systemGroup";
import {PresentationSystemGroup} from "./presentationSystemGroup";
import {Resource} from "./resource";
import {ActiveRenderers} from "./activeRenderers";
import type {RendererKind} from "./activeRenderers";
import {Component} from "./component";
import {EntityCommandBufferSystem} from "./entityCommandBufferSystem";
import {FrameLoopSettings, resolveLoopTiming, UNCAPPED_RENDER_RATE} from "./frameLoopSettings";
import {MAX_FRAME_DELTA_MS} from "./frameLoop";
import {DISPLAY_CAPPED_PACING, displayPacing, intervalPacing, UNCAPPED_PACING} from "../platform/framePacing";
import {Input} from "../input/input";
import {Key} from "../input/key";
import {NO_MODIFIERS} from "../input/inputEvent";
import type {KeyDownEvent} from "../input/inputEvent";

const MS_PER_SECOND = 1000;
const TICK_RATE = 60;
const TICK_MS = MS_PER_SECOND / TICK_RATE;
const LONG_WORK_MS = 20;
const SHORT_WORK_MS = 5;
const SLOW_PRESENTATION_MS = 30;
const UNCAPPED_FRAME_MS = 4;
const DEFAULT_MAX_CATCH_UP_TICKS = 5;
const DELTA_DECIMALS = 2;
const NO_WORK_MS = 0;
const NOT_REPEATED = false;
const LATE_PRESENTATION_PRIORITY = 1000;
const CPU_RENDERER: RendererKind = "cpu";
const GPU_RENDERER: RendererKind = "gpu";
const NO_RENDERER = undefined;
const CPU_LIMIT = 60;
const CPU_LIMIT_MS = MS_PER_SECOND / CPU_LIMIT;
const SLOW_RENDER_RATE = 30;
const FAST_RENDER_RATE = 120;
const SLOW_TICK_RATE = 30;
const FAST_TICK_RATE = 600;
const FAST_TICKS_PER_60HZ_FRAME = FAST_TICK_RATE / TICK_RATE;
const FAST_TICKS_PER_30HZ_FRAME = FAST_TICK_RATE / SLOW_RENDER_RATE;
const TICK_RATE_BELOW_MAX_FRAME_DELTA = 2;
const STALL_MS = 10 * MS_PER_SECOND;
const FAST_RENDER_FRAME_MS = MS_PER_SECOND / FAST_RENDER_RATE;
const SLOW_RENDER_FRAME_MS = MS_PER_SECOND / SLOW_RENDER_RATE;
const FAST_TICKS_PER_FAST_RENDER_FRAME = FAST_TICK_RATE / FAST_RENDER_RATE;
const WORK_BETWEEN_FAST_AND_60HZ_FRAME_MS = 10;

class Recorder extends Resource {
    public readonly entries: string[] = [];
}

function recordOf(world: World): string[] {
    return world.resources.getOrCreate(Recorder).entries;
}

function platformOf(world: World): MemoryPlatform {
    return world.platform as MemoryPlatform;
}

type GroupCtor = new () => SystemGroup;

interface WorkOptions {
    readonly name: string;
    readonly priority: number;
    readonly workMs?: number;
    readonly group?: () => GroupCtor;
    readonly run?: (world: World) => void;
}

function workSystem(options: WorkOptions): SystemCtor<System> {
    return class extends System {
        override priority(): number {
            return options.priority;
        }

        override systemGroup(): GroupCtor | undefined {
            return options.group?.();
        }

        public onUpdate(): void {
            recordOf(this.world).push(options.name);
            options.run?.(this.world);
            platformOf(this.world).advance(options.workMs ?? NO_WORK_MS);
        }
    };
}

function barrierGroup(priority: number, parent?: () => GroupCtor): GroupCtor {
    return class extends SystemGroup {
        override priority(): number {
            return priority;
        }

        override systemGroup(): GroupCtor | undefined {
            return parent?.();
        }

        protected override blocksPresentation(): boolean {
            return true;
        }
    };
}

function plainGroup(priority: number, parent: () => GroupCtor): GroupCtor {
    return class extends SystemGroup {
        override priority(): number {
            return priority;
        }

        override systemGroup(): GroupCtor {
            return parent();
        }
    };
}

class FramePresentation extends PresentationSystemGroup {
    override priority(): number {
        return LATE_PRESENTATION_PRIORITY;
    }
}

class Marker extends Component {
}

class MarkerProbe extends System {
    private readonly markers = this.createEntityQuery([Marker]);

    override systemGroup() {
        return FramePresentation;
    }

    public onUpdate(): void {
        recordOf(this.world).push(`markers ${this.markers.enabledEntityCount()}`);
    }
}

class FrameProbe extends System {
    public presentationMs = NO_WORK_MS;

    override systemGroup() {
        return FramePresentation;
    }

    public onUpdate(): void {
        recordOf(this.world).push(`frame ${this.world.time.deltaTimeMs.toFixed(DELTA_DECIMALS)}`);
        platformOf(this.world).advance(this.presentationMs);
    }
}

interface LoopRig {
    readonly world: World;
    readonly platform: MemoryPlatform;
    readonly scheduler: ManualFrameScheduler;
    readonly record: string[];
    frameAt(frameTimeMs: number): void;
}

function loopRig(...systems: readonly SystemCtor<System>[]): LoopRig {
    return loopRigOn(new ManualFrameScheduler(), systems);
}

function displayCappedLoopRig(...systems: readonly SystemCtor<System>[]): LoopRig {
    const rig = loopRigOn(new ManualFrameScheduler(DISPLAY_CAPPED_PACING), systems);
    rig.world.renderers.add(GPU_RENDERER);
    return rig;
}

function loopRigOn(scheduler: ManualFrameScheduler, systems: readonly SystemCtor<System>[]): LoopRig {
    const platform = new MemoryPlatform({frameScheduler: scheduler});
    const world = new World({platform});
    world.ensureSystemExists(FrameProbe);
    for (const system of systems) world.ensureSystemExists(system);
    return {
        world,
        platform,
        scheduler,
        record: recordOf(world),
        frameAt(frameTimeMs: number): void {
            platform.setNow(frameTimeMs);
            scheduler.frame(frameTimeMs);
        },
    };
}

function renderedLoopRig(...systems: readonly SystemCtor<System>[]): LoopRig {
    const rig = loopRig(...systems);
    rig.world.renderers.add(GPU_RENDERER);
    return rig;
}

function withSettings(world: World, configure: (settings: FrameLoopSettings) => void): void {
    const settings = new FrameLoopSettings();
    configure(settings);
    world.entityManager.createEntity("frameLoop", [settings]);
}

function keyDown(key: Key): KeyDownEvent {
    return {type: "keyDown", key, repeat: NOT_REPEATED, ...NO_MODIFIERS};
}

function frameEntry(deltaMs: number): string {
    return `frame ${deltaMs.toFixed(DELTA_DECIMALS)}`;
}

describe("World loop pacing", () => {
    test("by default the loop asks for 60 Hz frames and runs exactly one tick before each", () => {
        const rig = renderedLoopRig(workSystem({name: "tick", priority: 1}));
        rig.world.startLoop();
        expect(rig.scheduler.pacing).toEqual({kind: "interval", intervalMs: TICK_MS});
        expect(rig.scheduler.backlog).toBe(rig.world.presenterBacklogs);
        for (let frame = 1; frame <= 3; frame++) rig.frameAt(frame * TICK_MS);
        expect(rig.record).toEqual(["tick", frameEntry(TICK_MS), "tick", frameEntry(TICK_MS), "tick", frameEntry(TICK_MS)]);
        expect([rig.world.time.tickCount, rig.world.time.frameCount]).toEqual([3, 3]);
    });

    test("an uncapped render rate presents every frame while ticks stay at the tick rate", () => {
        const rig = renderedLoopRig();
        withSettings(rig.world, settings => settings.renderRate = UNCAPPED_RENDER_RATE);
        rig.world.startLoop();
        expect(rig.scheduler.pacing).toEqual({kind: "uncapped"});
        for (let timeMs = UNCAPPED_FRAME_MS; timeMs <= MS_PER_SECOND; timeMs += UNCAPPED_FRAME_MS) rig.frameAt(timeMs);
        expect(rig.world.time.frameCount).toBe(MS_PER_SECOND / UNCAPPED_FRAME_MS);
        expect(rig.world.time.tickCount).toBe(TICK_RATE);
        expect(rig.world.time.frameDeltaTimeMs).toBe(UNCAPPED_FRAME_MS);
    });

    test("matching the display asks for display frames, capped by a finite render rate", () => {
        const rig = renderedLoopRig();
        const settings = new FrameLoopSettings();
        settings.matchDisplay = true;
        expect(resolveLoopTiming(settings, GPU_RENDERER).pacing).toEqual({kind: "display", capIntervalMs: TICK_MS});
        settings.renderRate = UNCAPPED_RENDER_RATE;
        expect(resolveLoopTiming(settings, GPU_RENDERER).pacing).toEqual({kind: "display"});
        rig.world.entityManager.createEntity("frameLoop", [settings]);
        rig.world.startLoop();
        expect(rig.scheduler.pacing).toEqual({kind: "display"});
    });

    test("invalid settings are rejected with the field that is wrong", () => {
        const settings = new FrameLoopSettings();
        settings.simulationTickRate = 0;
        expect(() => resolveLoopTiming(settings, GPU_RENDERER)).toThrow("simulationTickRate");
        settings.simulationTickRate = TICK_RATE;
        settings.renderRate = Number.NaN;
        expect(() => resolveLoopTiming(settings, GPU_RENDERER)).toThrow("renderRate");
        expect(() => resolveLoopTiming(settings, NO_RENDERER)).toThrow("renderRate");
        settings.renderRate = TICK_RATE;
        settings.maxCatchUpTicks = 0;
        expect(() => resolveLoopTiming(settings, GPU_RENDERER)).toThrow("maxCatchUpTicks");
    });

    test("settings changed while running take effect after the frame, restarting the scheduler only for new pacing", () => {
        const rig = renderedLoopRig(workSystem({name: "tick", priority: 1}));
        rig.world.startLoop();
        const settings = new FrameLoopSettings();
        settings.renderRate = UNCAPPED_RENDER_RATE;
        rig.world.entityManager.createEntity("frameLoop", [settings]);
        rig.frameAt(TICK_MS);
        expect([rig.scheduler.starts, rig.scheduler.pacing]).toEqual([2, {kind: "uncapped"}]);
        expect(rig.scheduler.backlog).toBe(rig.world.presenterBacklogs);
        settings.simulationTickRate = TICK_RATE / 2;
        rig.frameAt(2 * TICK_MS);
        expect(rig.scheduler.starts).toBe(2);
        rig.frameAt(4 * TICK_MS);
        expect(rig.world.time.tickDeltaTimeMs).toBe(2 * TICK_MS);
        expect(rig.world.loopTiming.tickDeltaMs).toBe(2 * TICK_MS);
    });

    test("a frame long after the last runs at most maxCatchUpTicks ticks and drops the rest", () => {
        const rig = renderedLoopRig(workSystem({name: "tick", priority: 1}));
        rig.world.startLoop();
        rig.frameAt(STALL_MS);
        expect(rig.world.time.tickCount).toBe(DEFAULT_MAX_CATCH_UP_TICKS);
        expect(rig.world.time.frameDeltaTimeMs).toBe(MAX_FRAME_DELTA_MS);
        rig.frameAt(STALL_MS + TICK_MS);
        expect(rig.world.time.tickCount).toBe(DEFAULT_MAX_CATCH_UP_TICKS + 1);
    });

    test("a frame without a tick leaves input queued, and of several ticks in a frame only the first sees it", () => {
        const seen: number[] = [];
        const rig = renderedLoopRig(workSystem({name: "tick", priority: 1, run: world => seen.push(world.resources.getOrCreate(Input).events.length)}));
        withSettings(rig.world, settings => settings.renderRate = UNCAPPED_RENDER_RATE);
        const input = rig.world.resources.getOrCreate(Input);
        rig.world.startLoop();
        input.enqueue(keyDown(Key.A));
        rig.frameAt(UNCAPPED_FRAME_MS);
        expect(seen).toEqual([]);
        rig.frameAt(TICK_MS);
        expect(seen).toEqual([1]);
        input.enqueue(keyDown(Key.B));
        rig.frameAt(3 * TICK_MS);
        expect(seen).toEqual([1, 1, 0]);
        expect(input.keyHeld(Key.A) && input.keyHeld(Key.B)).toBe(true);
    });
});

describe("World loop without a renderer", () => {
    test("frames are paced at the tick rate, whatever the render rate or display matching asks for", () => {
        const settings = new FrameLoopSettings();
        for (const renderRate of [UNCAPPED_RENDER_RATE, FAST_RENDER_RATE, SLOW_RENDER_RATE]) {
            settings.renderRate = renderRate;
            expect(resolveLoopTiming(settings, NO_RENDERER).pacing).toEqual({kind: "interval", intervalMs: TICK_MS});
        }
        settings.matchDisplay = true;
        expect(resolveLoopTiming(settings, NO_RENDERER).pacing).toEqual({kind: "interval", intervalMs: TICK_MS});
        settings.simulationTickRate = SLOW_TICK_RATE;
        expect(resolveLoopTiming(settings, NO_RENDERER).pacing).toEqual({kind: "interval", intervalMs: MS_PER_SECOND / SLOW_TICK_RATE});
        expect(resolveLoopTiming(settings, NO_RENDERER).renderRateLimit).toBe(UNCAPPED_RENDER_RATE);
    });

    test("an uncapped headless loop asks the scheduler for one frame per tick instead of spinning", () => {
        const rig = loopRig(workSystem({name: "tick", priority: 1}));
        withSettings(rig.world, settings => settings.renderRate = UNCAPPED_RENDER_RATE);
        rig.world.startLoop();
        expect(rig.scheduler.pacing).toEqual({kind: "interval", intervalMs: TICK_MS});
        for (let frame = 1; frame <= 3; frame++) rig.frameAt(frame * TICK_MS);
        expect([rig.world.time.tickCount, rig.world.time.frameCount]).toEqual([3, 3]);
    });

    test("a renderer appearing switches the running loop to render pacing, and its going away switches back to the tick rate", () => {
        const rig = loopRig(workSystem({name: "tick", priority: 1}));
        withSettings(rig.world, settings => {
            settings.simulationTickRate = SLOW_TICK_RATE;
            settings.renderRate = UNCAPPED_RENDER_RATE;
        });
        const slowTickMs = MS_PER_SECOND / SLOW_TICK_RATE;
        rig.world.startLoop();
        expect(rig.scheduler.pacing).toEqual({kind: "interval", intervalMs: slowTickMs});
        rig.world.renderers.add(GPU_RENDERER);
        rig.frameAt(slowTickMs);
        expect([rig.scheduler.starts, rig.scheduler.pacing]).toEqual([2, {kind: "uncapped"}]);
        rig.world.renderers.remove(GPU_RENDERER);
        rig.world.renderers.add(CPU_RENDERER);
        rig.frameAt(2 * slowTickMs);
        expect([rig.scheduler.starts, rig.scheduler.pacing]).toEqual([3, {kind: "interval", intervalMs: CPU_LIMIT_MS}]);
        rig.world.renderers.remove(CPU_RENDERER);
        rig.frameAt(3 * slowTickMs);
        expect([rig.scheduler.starts, rig.scheduler.pacing]).toEqual([4, {kind: "interval", intervalMs: slowTickMs}]);
        rig.frameAt(4 * slowTickMs);
        expect(rig.scheduler.starts).toBe(4);
        expect(rig.world.time.tickCount).toBe(4);
    });

    test("a tick longer than the maximum frame delta is paced at that delta, so its ticks still run at the tick rate", () => {
        const rig = loopRig(workSystem({name: "tick", priority: 1}));
        withSettings(rig.world, settings => settings.simulationTickRate = TICK_RATE_BELOW_MAX_FRAME_DELTA);
        rig.world.startLoop();
        expect(rig.scheduler.pacing).toEqual({kind: "interval", intervalMs: MAX_FRAME_DELTA_MS});
        for (let timeMs = MAX_FRAME_DELTA_MS; timeMs <= MS_PER_SECOND; timeMs += MAX_FRAME_DELTA_MS) rig.frameAt(timeMs);
        expect(rig.world.time.tickCount).toBe(TICK_RATE_BELOW_MAX_FRAME_DELTA);
    });
});

describe("World loop catch-up limit", () => {
    test("a tick rate above the render rate catches up maxCatchUpTicks frames' worth of ticks after a stall", () => {
        const rig = renderedLoopRig(workSystem({name: "tick", priority: 1}));
        withSettings(rig.world, settings => settings.simulationTickRate = FAST_TICK_RATE);
        rig.world.startLoop();
        expect(rig.scheduler.pacing).toEqual({kind: "interval", intervalMs: TICK_MS});
        rig.frameAt(STALL_MS);
        expect(rig.world.time.tickCount).toBe(FAST_TICKS_PER_60HZ_FRAME * DEFAULT_MAX_CATCH_UP_TICKS);
        rig.frameAt(STALL_MS + TICK_MS);
        expect(rig.world.time.tickCount).toBe(FAST_TICKS_PER_60HZ_FRAME * (DEFAULT_MAX_CATCH_UP_TICKS + 1));
    });

    test("frames are counted at the paced rate, at the assumed display rate when uncapped or matching the display", () => {
        const settings = new FrameLoopSettings();
        settings.simulationTickRate = FAST_TICK_RATE;
        const maxTicksPerFrame = (frameRenderer: RendererKind | undefined): number => resolveLoopTiming(settings, frameRenderer).maxTicksPerFrame;
        expect(maxTicksPerFrame(GPU_RENDERER)).toBe(FAST_TICKS_PER_60HZ_FRAME * DEFAULT_MAX_CATCH_UP_TICKS);
        settings.renderRate = SLOW_RENDER_RATE;
        expect(maxTicksPerFrame(GPU_RENDERER)).toBe(FAST_TICKS_PER_30HZ_FRAME * DEFAULT_MAX_CATCH_UP_TICKS);
        settings.renderRate = UNCAPPED_RENDER_RATE;
        expect(maxTicksPerFrame(GPU_RENDERER)).toBe(FAST_TICKS_PER_60HZ_FRAME * DEFAULT_MAX_CATCH_UP_TICKS);
        expect(maxTicksPerFrame(CPU_RENDERER)).toBe(FAST_TICKS_PER_60HZ_FRAME * DEFAULT_MAX_CATCH_UP_TICKS);
        settings.matchDisplay = true;
        expect(maxTicksPerFrame(GPU_RENDERER)).toBe(FAST_TICKS_PER_60HZ_FRAME * DEFAULT_MAX_CATCH_UP_TICKS);
        settings.renderRate = SLOW_RENDER_RATE;
        expect(maxTicksPerFrame(GPU_RENDERER)).toBe(FAST_TICKS_PER_30HZ_FRAME * DEFAULT_MAX_CATCH_UP_TICKS);
        expect(maxTicksPerFrame(NO_RENDERER)).toBe(DEFAULT_MAX_CATCH_UP_TICKS);
    });

    test("a tick rate at or below the render rate keeps maxCatchUpTicks ticks", () => {
        const settings = new FrameLoopSettings();
        expect(resolveLoopTiming(settings, GPU_RENDERER).maxTicksPerFrame).toBe(DEFAULT_MAX_CATCH_UP_TICKS);
        settings.simulationTickRate = SLOW_TICK_RATE;
        expect(resolveLoopTiming(settings, GPU_RENDERER).maxTicksPerFrame).toBe(DEFAULT_MAX_CATCH_UP_TICKS);
        settings.simulationTickRate = TICK_RATE_BELOW_MAX_FRAME_DELTA;
        expect(resolveLoopTiming(settings, NO_RENDERER).maxTicksPerFrame).toBe(DEFAULT_MAX_CATCH_UP_TICKS);
    });
});

describe("World loop CPU render rate limit", () => {
    function settingsWith(configure: (settings: FrameLoopSettings) => void): FrameLoopSettings {
        const settings = new FrameLoopSettings();
        configure(settings);
        return settings;
    }

    test("frames rendered on the CPU turn an uncapped render rate into frames at the limit", () => {
        const settings = settingsWith(settings => settings.renderRate = UNCAPPED_RENDER_RATE);
        const timing = resolveLoopTiming(settings, CPU_RENDERER);
        expect(timing.pacing).toEqual({kind: "interval", intervalMs: CPU_LIMIT_MS});
        expect(timing.renderRateLimit).toBe(CPU_LIMIT);
    });

    test("frames rendered on the CPU cap display pacing at the limit, keeping a lower render rate's cap", () => {
        const settings = settingsWith(settings => {
            settings.renderRate = UNCAPPED_RENDER_RATE;
            settings.matchDisplay = true;
        });
        expect(resolveLoopTiming(settings, CPU_RENDERER).pacing).toEqual({kind: "display", capIntervalMs: CPU_LIMIT_MS});
        settings.renderRate = SLOW_RENDER_RATE;
        expect(resolveLoopTiming(settings, CPU_RENDERER).pacing).toEqual({kind: "display", capIntervalMs: MS_PER_SECOND / SLOW_RENDER_RATE});
    });

    test("frames rendered on the CPU lower a faster interval to the limit and keep a slower one", () => {
        const settings = settingsWith(settings => settings.renderRate = FAST_RENDER_RATE);
        expect(resolveLoopTiming(settings, CPU_RENDERER).pacing).toEqual({kind: "interval", intervalMs: CPU_LIMIT_MS});
        settings.renderRate = SLOW_RENDER_RATE;
        expect(resolveLoopTiming(settings, CPU_RENDERER).pacing).toEqual({kind: "interval", intervalMs: MS_PER_SECOND / SLOW_RENDER_RATE});
    });

    test("frames not rendered on the CPU, or an uncapped limit, keep the requested pacing", () => {
        const settings = settingsWith(settings => settings.renderRate = UNCAPPED_RENDER_RATE);
        const gpuTiming = resolveLoopTiming(settings, GPU_RENDERER);
        expect(gpuTiming.pacing).toEqual({kind: "uncapped"});
        expect(gpuTiming.renderRateLimit).toBe(UNCAPPED_RENDER_RATE);
        settings.cpuRenderRateLimit = UNCAPPED_RENDER_RATE;
        expect(resolveLoopTiming(settings, CPU_RENDERER).pacing).toEqual({kind: "uncapped"});
    });

    test("an invalid limit is rejected even when no CPU renderer is active", () => {
        for (const limit of [0, -CPU_LIMIT, Number.NaN]) {
            const settings = settingsWith(settings => settings.cpuRenderRateLimit = limit);
            expect(() => resolveLoopTiming(settings, NO_RENDERER)).toThrow("cpuRenderRateLimit");
        }
    });

    test("a GPU renderer lifts the limit even while a CPU renderer draws its overlay", () => {
        const renderers = new ActiveRenderers();
        renderers.add("cpu");
        expect(renderers.framesRenderedOnCpu).toBe(true);
        renderers.add("gpu");
        expect(renderers.framesRenderedOnCpu).toBe(false);
        renderers.remove("gpu");
        renderers.remove("cpu");
        expect(renderers.framesRenderedOnCpu).toBe(false);
        expect(() => renderers.remove("cpu")).toThrow("no cpu renderer");
    });

    test("the running loop re-resolves its pacing when renderers appear or go away", () => {
        const rig = loopRig(workSystem({name: "tick", priority: 1}));
        withSettings(rig.world, settings => settings.renderRate = UNCAPPED_RENDER_RATE);
        rig.world.renderers.add("cpu");
        rig.world.startLoop();
        expect(rig.scheduler.pacing).toEqual({kind: "interval", intervalMs: CPU_LIMIT_MS});
        rig.world.renderers.add("gpu");
        rig.frameAt(TICK_MS);
        expect([rig.scheduler.starts, rig.scheduler.pacing]).toEqual([2, {kind: "uncapped"}]);
        expect(rig.world.loopTiming.renderRateLimit).toBe(UNCAPPED_RENDER_RATE);
        rig.world.renderers.remove("gpu");
        rig.frameAt(2 * TICK_MS);
        expect([rig.scheduler.starts, rig.scheduler.pacing]).toEqual([3, {kind: "interval", intervalMs: CPU_LIMIT_MS}]);
        rig.frameAt(3 * TICK_MS);
        expect(rig.scheduler.starts).toBe(3);
    });
});

describe("World loop on a scheduler that caps frames on the display", () => {
    test("a capped render rate asks for display frames capped at that rate; uncapped, matching the display and headless pacing are unchanged", () => {
        const settings = new FrameLoopSettings();
        const pacing = (frameRenderer: RendererKind | undefined) => resolveLoopTiming(settings, frameRenderer, DISPLAY_CAPPED_PACING).pacing;
        expect(pacing(GPU_RENDERER)).toEqual(displayPacing(TICK_MS));
        expect(resolveLoopTiming(settings, GPU_RENDERER).pacing).toEqual(intervalPacing(TICK_MS));
        settings.renderRate = SLOW_RENDER_RATE;
        expect(pacing(GPU_RENDERER)).toEqual(displayPacing(SLOW_RENDER_FRAME_MS));
        expect(pacing(NO_RENDERER)).toEqual(intervalPacing(TICK_MS));
        settings.renderRate = UNCAPPED_RENDER_RATE;
        expect(pacing(GPU_RENDERER)).toEqual(UNCAPPED_PACING);
        settings.matchDisplay = true;
        expect(pacing(GPU_RENDERER)).toEqual(displayPacing());
        settings.renderRate = FAST_RENDER_RATE;
        expect(pacing(GPU_RENDERER)).toEqual(displayPacing(FAST_RENDER_FRAME_MS));
    });

    test("the CPU render rate limit still caps display-capped frames", () => {
        const settings = new FrameLoopSettings();
        settings.renderRate = FAST_RENDER_RATE;
        expect(resolveLoopTiming(settings, CPU_RENDERER, DISPLAY_CAPPED_PACING).pacing).toEqual(displayPacing(CPU_LIMIT_MS));
    });

    test("catch-up counts display-capped frames at the assumed display rate, not at a faster render rate", () => {
        const settings = new FrameLoopSettings();
        settings.simulationTickRate = FAST_TICK_RATE;
        settings.renderRate = FAST_RENDER_RATE;
        expect(resolveLoopTiming(settings, GPU_RENDERER).maxTicksPerFrame).toBe(FAST_TICKS_PER_FAST_RENDER_FRAME * DEFAULT_MAX_CATCH_UP_TICKS);
        expect(resolveLoopTiming(settings, GPU_RENDERER, DISPLAY_CAPPED_PACING).maxTicksPerFrame).toBe(FAST_TICKS_PER_60HZ_FRAME * DEFAULT_MAX_CATCH_UP_TICKS);
    });

    test("a running world asks for display frames, falls back to tick-rate intervals without a renderer, and keeps its pacing when matchDisplay toggles", () => {
        const rig = displayCappedLoopRig(workSystem({name: "tick", priority: 1}));
        const settings = new FrameLoopSettings();
        rig.world.entityManager.createEntity("frameLoop", [settings]);
        rig.world.startLoop();
        expect(rig.scheduler.pacing).toEqual(displayPacing(TICK_MS));
        expect(rig.scheduler.backlog).toBe(rig.world.presenterBacklogs);
        for (let frame = 1; frame <= 3; frame++) rig.frameAt(frame * TICK_MS);
        expect([rig.world.time.tickCount, rig.world.time.frameCount]).toEqual([3, 3]);
        settings.matchDisplay = true;
        rig.frameAt(4 * TICK_MS);
        expect([rig.scheduler.starts, rig.scheduler.pacing]).toEqual([1, displayPacing(TICK_MS)]);
        rig.world.renderers.remove(GPU_RENDERER);
        rig.frameAt(5 * TICK_MS);
        expect([rig.scheduler.starts, rig.scheduler.pacing]).toEqual([2, intervalPacing(TICK_MS)]);
        rig.world.renderers.add(GPU_RENDERER);
        rig.frameAt(6 * TICK_MS);
        expect([rig.scheduler.starts, rig.scheduler.pacing]).toEqual([3, displayPacing(TICK_MS)]);
        expect(rig.world.time.tickCount).toBe(6);
    });

    test("a stalled display resumes with at most maxCatchUpTicks ticks", () => {
        const rig = displayCappedLoopRig(workSystem({name: "tick", priority: 1}));
        rig.world.startLoop();
        rig.frameAt(TICK_MS);
        rig.frameAt(TICK_MS + STALL_MS);
        expect(rig.world.time.tickCount).toBe(1 + DEFAULT_MAX_CATCH_UP_TICKS);
        expect(rig.world.time.frameDeltaTimeMs).toBe(MAX_FRAME_DELTA_MS);
    });

    test("a long tick interleaves at the assumed display rate, not at a faster capped render rate", () => {
        const systems = [
            workSystem({name: "a", priority: 1, workMs: WORK_BETWEEN_FAST_AND_60HZ_FRAME_MS}),
            workSystem({name: "b", priority: 2}),
        ];
        const fastRenderRate = (rig: LoopRig): LoopRig => {
            withSettings(rig.world, settings => settings.renderRate = FAST_RENDER_RATE);
            return rig;
        };
        const onIntervals = fastRenderRate(renderedLoopRig(...systems));
        onIntervals.world.startLoop();
        onIntervals.frameAt(TICK_MS);
        expect(onIntervals.record).toEqual(["a", frameEntry(TICK_MS + WORK_BETWEEN_FAST_AND_60HZ_FRAME_MS), "b", frameEntry(NO_WORK_MS)]);
        const onDisplay = fastRenderRate(displayCappedLoopRig(...systems));
        onDisplay.world.startLoop();
        onDisplay.frameAt(TICK_MS);
        expect(onDisplay.record).toEqual(["a", "b", frameEntry(TICK_MS)]);
    });
});

describe("World loop command playback", () => {
    test("commands recorded in a tick are played back as the next tick starts, so frames between ticks never show them half done", () => {
        const rig = renderedLoopRig(workSystem({name: "spawner", priority: 1, run: world => {
            if (world.time.tickCount === 1) world.getOrCreateSystem(EntityCommandBufferSystem).getEntityCommandBuffer().createEntity("marked", [new Marker()]);
        }}));
        rig.world.ensureSystemExists(MarkerProbe);
        withSettings(rig.world, settings => settings.renderRate = UNCAPPED_RENDER_RATE);
        rig.world.startLoop();
        rig.frameAt(TICK_MS);
        rig.frameAt(TICK_MS + UNCAPPED_FRAME_MS);
        rig.frameAt(2 * TICK_MS);
        expect(rig.record.filter(entry => entry.startsWith("markers"))).toEqual(["markers 0", "markers 0", "markers 1"]);
    });
});

describe("World loop control", () => {
    test("step, stepSimulation and renderFrame are refused while the loop runs, and work again after pause", () => {
        const rig = loopRig();
        rig.world.startLoop();
        expect(() => rig.world.step()).toThrow("pause()");
        expect(() => rig.world.stepSimulation()).toThrow("pause()");
        expect(() => rig.world.renderFrame(TICK_MS)).toThrow("pause()");
        rig.world.pause();
        expect(rig.scheduler.running).toBe(false);
        rig.world.step();
        expect(rig.world.time.frameCount).toBe(1);
        rig.world.startLoop();
        expect([rig.scheduler.running, rig.scheduler.starts]).toEqual([true, 2]);
    });

    test("an error thrown in a frame stops the loop and reaches the scheduler", () => {
        const rig = loopRig(workSystem({name: "boom", priority: 1, run: () => {
            throw new Error("boom");
        }}));
        rig.world.startLoop();
        expect(() => rig.frameAt(TICK_MS)).toThrow("boom");
        expect(rig.scheduler.running).toBe(false);
        expect(rig.world.presentationBarriers.blocking).toBe(false);
    });

    test("stopping the world inside a tick ends the frame without presenting it", () => {
        const rig = loopRig(
            workSystem({name: "stopper", priority: 1, run: world => world.stop()}),
            workSystem({name: "after", priority: 2}),
        );
        rig.world.startLoop();
        rig.frameAt(TICK_MS);
        expect(rig.record).toEqual(["stopper"]);
        expect(rig.scheduler.running).toBe(false);
    });
});

describe("World loop interleaving", () => {
    test("a long tick presents a due frame between its systems, then resumes with the tick delta", () => {
        const rig = loopRig(
            workSystem({name: "slow", priority: 1, workMs: LONG_WORK_MS}),
            workSystem({name: "next", priority: 2, run: world => recordOf(world).push(`next sees ${world.time.deltaTimeMs.toFixed(DELTA_DECIMALS)}`)}),
        );
        rig.world.startLoop();
        rig.frameAt(TICK_MS);
        expect(rig.record).toEqual(["slow", frameEntry(TICK_MS + LONG_WORK_MS), "next", `next sees ${TICK_MS.toFixed(DELTA_DECIMALS)}`, frameEntry(NO_WORK_MS)]);
        expect([rig.world.time.tickCount, rig.world.time.frameCount]).toEqual([1, 2]);
    });

    test("an uncapped loop interleaves a long tick at the assumed display rate, not at every boundary", () => {
        const rig = renderedLoopRig(
            workSystem({name: "quick", priority: 1, workMs: SHORT_WORK_MS}),
            workSystem({name: "slow", priority: 2, workMs: LONG_WORK_MS}),
            workSystem({name: "next", priority: 3}),
        );
        withSettings(rig.world, settings => settings.renderRate = UNCAPPED_RENDER_RATE);
        rig.world.startLoop();
        rig.frameAt(TICK_MS);
        expect(rig.record).toEqual(["quick", "slow", frameEntry(TICK_MS + SHORT_WORK_MS + LONG_WORK_MS), "next", frameEntry(NO_WORK_MS)]);
    });

    test("a tick that fits in a frame never interleaves", () => {
        const rig = loopRig(
            workSystem({name: "quick", priority: 1, workMs: SHORT_WORK_MS}),
            workSystem({name: "next", priority: 2, workMs: SHORT_WORK_MS}),
        );
        rig.world.startLoop();
        rig.frameAt(TICK_MS);
        expect(rig.record).toEqual(["quick", "next", frameEntry(TICK_MS)]);
    });

    test("a barrier group delays a due frame until the whole group has run", () => {
        const Barrier = barrierGroup(1);
        const rig = loopRig(
            workSystem({name: "a", priority: 1, workMs: LONG_WORK_MS, group: () => Barrier}),
            workSystem({name: "b", priority: 2, group: () => Barrier}),
            workSystem({name: "after", priority: 2}),
        );
        rig.world.startLoop();
        rig.frameAt(TICK_MS);
        expect(rig.record).toEqual(["a", "b", frameEntry(TICK_MS + LONG_WORK_MS), "after", frameEntry(NO_WORK_MS)]);
    });

    test("a due frame may present before a barrier group starts", () => {
        const Barrier = barrierGroup(2);
        const rig = loopRig(
            workSystem({name: "before", priority: 1, workMs: LONG_WORK_MS}),
            workSystem({name: "a", priority: 1, group: () => Barrier}),
            workSystem({name: "b", priority: 2, group: () => Barrier}),
        );
        rig.world.startLoop();
        rig.frameAt(TICK_MS);
        expect(rig.record).toEqual(["before", frameEntry(TICK_MS + LONG_WORK_MS), "a", "b", frameEntry(NO_WORK_MS)]);
    });

    test("groups nested in a barrier group are blocked too", () => {
        const Barrier = barrierGroup(1);
        const Nested = plainGroup(1, () => Barrier);
        const rig = loopRig(
            workSystem({name: "a", priority: 1, workMs: LONG_WORK_MS, group: () => Nested}),
            workSystem({name: "b", priority: 2, workMs: LONG_WORK_MS, group: () => Nested}),
            workSystem({name: "c", priority: 2, group: () => Barrier}),
        );
        rig.world.startLoop();
        rig.frameAt(TICK_MS);
        expect(rig.record).toEqual(["a", "b", "c", frameEntry(TICK_MS)]);
    });

    test("a slow presentation leaves the tick at least as long to run before the next interleaved frame", () => {
        const work = Array.from({length: 10}, (_, index) => workSystem({name: `s${index + 1}`, priority: index + 1, workMs: SHORT_WORK_MS}));
        const rig = loopRig(...work);
        rig.world.getOrCreateSystem(FrameProbe).presentationMs = SLOW_PRESENTATION_MS;
        rig.world.startLoop();
        rig.frameAt(TICK_MS);
        const frames = rig.record.map((entry, index) => entry.startsWith("frame") ? index : -1).filter(index => index >= 0);
        expect(rig.record.filter(entry => entry.startsWith("frame")).length).toBe(2);
        expect(frames[0]).toBe(4);
        expect(frames[1]).toBe(rig.record.length - 1);
    });

    test("ticks of one frame may be separated by an interleaved frame", () => {
        const rig = loopRig(workSystem({name: "tick", priority: 1, workMs: LONG_WORK_MS}));
        rig.world.startLoop();
        rig.frameAt(2 * TICK_MS);
        expect(rig.record).toEqual(["tick", frameEntry(2 * TICK_MS + LONG_WORK_MS), "tick", frameEntry(LONG_WORK_MS)]);
    });

    test("World.step never interleaves, however long the tick runs", () => {
        const rig = loopRig(
            workSystem({name: "slow", priority: 1, workMs: MS_PER_SECOND}),
            workSystem({name: "next", priority: 2}),
        );
        rig.world.step();
        expect(rig.record).toEqual(["slow", "next", frameEntry(TICK_MS)]);
    });
});
