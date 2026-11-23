import {describe, expect, test} from "../testing/harness";
import {MemoryPlatform} from "../testing/memoryPlatform";
import {ManualFrameScheduler} from "../testing/manualFrameScheduler";
import {consoleOverride} from "../debugging";
import {originalConsole} from "../debugging/originalConsole";
import {App} from "./app";
import type {RequestedQuitHandling} from "./app";
import {World} from "./world";
import {DebugWorld} from "./debugWorld";
import {System} from "./system";
import type {SystemCtor} from "./system";
import {QuitSystemGroup} from "./quitSystemGroup";
import {PresentationSystemGroup} from "./presentationSystemGroup";
import {Resource} from "./resource";
import {Component} from "./component";

const MS_PER_SECOND = 1000;
const TICK_RATE = 60;
const TICK_MS = MS_PER_SECOND / TICK_RATE;
const CATCH_UP_TICKS = 3;
const LATE_PRIORITY = 10;
const PRESENTATION_PRIORITY = 1000;
const AFTER_SAVE_PRIORITY = 1;

class Journal extends Resource {
    public constructor(public readonly worldName: string, public readonly entries: string[]) {
        super();
    }
}

class QuitNow extends Resource {
}

class Marker extends Component {
}

function note(world: World, what: string): void {
    const journal = world.resources.get(Journal);
    journal.entries.push(`${journal.worldName} ${what}`);
}

class Gameplay extends System {
    public onUpdate(): void {
        note(this.world, "gameplay");
        if (this.world.resources.tryGet(QuitNow) !== undefined) this.world.requestQuit();
    }
}

class LateGameplay extends System {
    override priority(): number {
        return LATE_PRIORITY;
    }

    public onUpdate(): void {
        note(this.world, "late gameplay");
    }
}

class FailingGameplay extends System {
    public onUpdate(): void {
        throw new Error("gameplay broke");
    }
}

class Screen extends PresentationSystemGroup {
    override priority(): number {
        return PRESENTATION_PRIORITY;
    }
}

class Draw extends System {
    override systemGroup() {
        return Screen;
    }

    public onUpdate(): void {
        note(this.world, "present");
    }
}

class SaveOnQuit extends System {
    override systemGroup() {
        return QuitSystemGroup;
    }

    public onUpdate(): void {
        note(this.world, "save");
    }
}

class FailingSaveOnQuit extends System {
    override systemGroup() {
        return QuitSystemGroup;
    }

    public onUpdate(): void {
        note(this.world, "failing save");
        throw new Error("disk full");
    }
}

class CloseOnQuit extends System {
    override systemGroup() {
        return QuitSystemGroup;
    }

    override priority(): number {
        return AFTER_SAVE_PRIORITY;
    }

    public onUpdate(): void {
        note(this.world, "close");
    }
}

class MarkerOnQuit extends System {
    override systemGroup() {
        return QuitSystemGroup;
    }

    protected override onCreate(): void {
        this.requireAnyForUpdate([Marker]);
    }

    public onUpdate(): void {
        note(this.world, "marker quit");
    }
}

class RequestQuitOnQuit extends System {
    override systemGroup() {
        return QuitSystemGroup;
    }

    public onUpdate(): void {
        note(this.world, "quit again");
        this.world.requestQuit();
    }
}

const PLAYED_SYSTEMS: readonly SystemCtor<System>[] = [Gameplay, LateGameplay, Draw];
const QUIT_SYSTEMS: readonly SystemCtor<System>[] = [SaveOnQuit, CloseOnQuit];

function journaled(world: World, name: string, entries: string[], systems: readonly SystemCtor<System>[]): World {
    world.resources.insert(new Journal(name, entries));
    world.onStopped.add(() => entries.push(`${name} stopped`));
    for (const system of systems) world.ensureSystemExists(system);
    return world;
}

function sameWorlds(actual: readonly World[], expected: readonly World[]): boolean {
    return actual.length === expected.length && actual.every((world, index) => world === expected[index]);
}

function owner(entries: string[], handling: RequestedQuitHandling): () => RequestedQuitHandling {
    return () => {
        entries.push("owner");
        return handling;
    };
}

function ignore(): void {
}

function consoleErrorsDuring(action: () => void): string[] {
    const errors: string[] = [];
    const methods: Record<string, (...args: unknown[]) => void> = {};
    for (const key in originalConsole) methods[key] = ignore;
    methods.error = (...args: unknown[]) => errors.push(args.map(String).join(" "));
    const recorder = methods as unknown as Console;
    consoleOverride.removeConsoleEventListener(originalConsole);
    consoleOverride.addConsoleEventListener(recorder);
    try {
        action();
    } finally {
        consoleOverride.removeConsoleEventListener(recorder);
        consoleOverride.addConsoleEventListener(originalConsole);
    }
    return errors;
}

describe("App quit", () => {
    test("the quit groups run once per world in creation order after the frame, then every world stops, then the platform quits", () => {
        const entries: string[] = [];
        const platform = new MemoryPlatform();
        const app = new App({platform});
        const first = journaled(app.createWorld(), "first", entries, [...PLAYED_SYSTEMS, ...QUIT_SYSTEMS]);
        const second = journaled(app.createDebugWorld(), "second", entries, QUIT_SYSTEMS);
        platform.onExit(() => entries.push("platform exit"));
        expect(sameWorlds(app.worlds, [first, second])).toBe(true);
        expect(first.app).toBe(app);

        first.step();
        expect(entries).toEqual(["first gameplay", "first late gameplay", "first present"]);
        entries.length = 0;
        first.resources.insert(new QuitNow());
        first.step();

        expect(entries).toEqual([
            "first gameplay", "first late gameplay", "first present",
            "first save", "first close", "second save", "second close",
            "first stopped", "second stopped",
            "platform exit",
        ]);
        expect(platform.quitCount).toBe(1);
        expect(app.worlds.length).toBe(0);
        expect(app.quitting).toBe(true);
        expect(app.quitPending).toBe(false);
    });

    test("repeated requests, later frames and the exit event that platform.quit fires run nothing again", () => {
        const entries: string[] = [];
        const platform = new MemoryPlatform();
        const app = new App({platform});
        const world = journaled(app.createWorld(), "world", entries, QUIT_SYSTEMS);
        world.requestQuit();
        world.requestQuit();
        expect(app.quitPending).toBe(true);
        world.step();
        world.requestQuit();
        world.step();
        app.quitAfterFrame();
        platform.exit();

        expect(entries).toEqual(["world save", "world close", "world stopped"]);
        expect(platform.quitCount).toBe(1);
    });

    test("in the frame loop the quit waits for the frame's remaining ticks and its presentation, then stops the loop", () => {
        const entries: string[] = [];
        const scheduler = new ManualFrameScheduler();
        const platform = new MemoryPlatform({frameScheduler: scheduler});
        const app = new App({platform});
        const world = journaled(app.createWorld(), "world", entries, [Gameplay, Draw, SaveOnQuit]);
        world.resources.insert(new QuitNow());
        world.startLoop();
        const frameTimeMs = CATCH_UP_TICKS * TICK_MS;
        platform.setNow(frameTimeMs);
        scheduler.frame(frameTimeMs);

        expect(entries).toEqual(["world gameplay", "world gameplay", "world gameplay", "world present", "world save", "world stopped"]);
        expect(scheduler.running).toBe(false);
        expect(platform.quitCount).toBe(1);
    });

    test("world.stop() alone, and the DebugWorld stop after a throwing system, never run the quit group", () => {
        const entries: string[] = [];
        const platform = new MemoryPlatform();
        const app = new App({platform});
        const unloaded = journaled(app.createWorld(), "unloaded", entries, QUIT_SYSTEMS);
        const failing = journaled(app.createDebugWorld(), "failing", entries, [FailingGameplay, ...QUIT_SYSTEMS]);
        const kept = journaled(app.createWorld(), "kept", entries, QUIT_SYSTEMS);

        unloaded.stop();
        const errors = consoleErrorsDuring(() => failing.step());

        expect(entries).toEqual(["unloaded stopped", "failing stopped"]);
        expect(errors.length).toBe(1);
        expect(sameWorlds(app.worlds, [kept])).toBe(true);
        expect(platform.quitCount).toBe(0);
    });

    test("an external exit runs the quit groups and stops every world without calling platform.quit", () => {
        const entries: string[] = [];
        const platform = new MemoryPlatform();
        const app = new App({platform});
        journaled(app.createWorld(), "first", entries, QUIT_SYSTEMS);
        const second = journaled(app.createWorld(), "second", entries, QUIT_SYSTEMS);

        platform.exit();
        second.requestQuit();
        second.step();

        expect(entries).toEqual(["first save", "first close", "second save", "second close", "first stopped", "second stopped"]);
        expect(platform.quitCount).toBe(0);
        expect(app.quitting).toBe(true);
    });

    test("a throwing quit system is logged and blocks neither the other quit systems, the other worlds nor the platform quit", () => {
        const entries: string[] = [];
        const platform = new MemoryPlatform();
        const app = new App({platform});
        const debug = journaled(app.createDebugWorld(), "debug", entries, [FailingSaveOnQuit, CloseOnQuit]);
        journaled(app.createWorld(), "plain", entries, [FailingSaveOnQuit, CloseOnQuit]);

        debug.requestQuit();
        const errors = consoleErrorsDuring(() => debug.step());

        expect(entries).toEqual([
            "debug failing save", "debug close", "plain failing save", "plain close",
            "debug stopped", "plain stopped",
        ]);
        expect(errors.length).toBe(2);
        expect(errors.every(line => line.includes("FailingSaveOnQuit failed while the app quit") && line.includes("disk full"))).toBe(true);
        expect(platform.quitCount).toBe(1);
    });

    test("a quit requested before a DebugWorld stops on a throwing system still quits at the end of that frame", () => {
        const entries: string[] = [];
        const platform = new MemoryPlatform();
        const app = new App({platform});
        const world = journaled(app.createDebugWorld(), "world", entries, [Gameplay, FailingGameplay, SaveOnQuit]);
        world.resources.insert(new QuitNow());

        const errors = consoleErrorsDuring(() => world.step());

        expect(entries).toEqual(["world gameplay", "world stopped"]);
        expect(errors.length).toBe(1);
        expect(platform.quitCount).toBe(1);
    });

    test("the quit group never joins its parent's update list, and its systems' requirements still apply", () => {
        const entries: string[] = [];
        const platform = new MemoryPlatform();
        const app = new App({platform});
        const world = journaled(app.createWorld(), "world", entries, [SaveOnQuit, MarkerOnQuit]);
        const quitGroup = world.getOrCreateSystem(QuitSystemGroup);

        world.step();
        quitGroup.enabled = false;
        quitGroup.enabled = true;
        world.step();
        expect(world.rootSystemGroup!.systems.includes(quitGroup)).toBe(true);
        expect(entries).toEqual([]);

        world.requestQuit();
        world.step();
        expect(entries).toEqual(["world save", "world stopped"]);
    });

    test("requestQuit on a world made without an App throws, naming App.createWorld", () => {
        const world = new World({platform: new MemoryPlatform()});
        expect(world.app).toBeUndefined();
        expect(() => world.requestQuit()).toThrow("App.createWorld");
    });

    test("a world joins only the app it was created for", () => {
        const platform = new MemoryPlatform();
        const app = new App({platform});
        const other = new App({platform});
        const world = new DebugWorld({platform, app: other});
        expect(sameWorlds(other.worlds, [world])).toBe(true);
        expect(() => app.addWorld(world)).toThrow("another app");
        expect(app.worlds.length).toBe(0);
    });
});

describe("App quit through an owner", () => {
    test("an owner that handles a requested quit is asked after every world's quit groups ran; no world stops, the platform does not quit and the request clears", () => {
        const entries: string[] = [];
        const platform = new MemoryPlatform();
        const app = new App({platform, handleRequestedQuit: owner(entries, "handled")});
        const first = journaled(app.createWorld(), "first", entries, [...PLAYED_SYSTEMS, ...QUIT_SYSTEMS]);
        const second = journaled(app.createDebugWorld(), "second", entries, QUIT_SYSTEMS);
        first.resources.insert(new QuitNow());
        first.step();

        expect(entries).toEqual([
            "first gameplay", "first late gameplay", "first present",
            "first save", "first close", "second save", "second close",
            "owner",
        ]);
        expect(platform.quitCount).toBe(0);
        expect(sameWorlds(app.worlds, [first, second])).toBe(true);
        expect([app.quitting, app.quitPending]).toEqual([false, false]);
    });

    test("after a handled quit the worlds play on, a later request goes to the owner again, and an external exit still runs the quit groups and stops every world", () => {
        const entries: string[] = [];
        const platform = new MemoryPlatform();
        const app = new App({platform, handleRequestedQuit: owner(entries, "handled")});
        const first = journaled(app.createWorld(), "first", entries, [...PLAYED_SYSTEMS, ...QUIT_SYSTEMS]);
        const second = journaled(app.createWorld(), "second", entries, QUIT_SYSTEMS);
        first.requestQuit();
        first.step();
        entries.length = 0;

        first.step();
        expect(entries).toEqual(["first gameplay", "first late gameplay", "first present"]);
        entries.length = 0;

        second.requestQuit();
        second.step();
        expect(entries).toEqual(["first save", "first close", "second save", "second close", "owner"]);
        entries.length = 0;

        platform.exit();
        expect(entries).toEqual(["first save", "first close", "second save", "second close", "first stopped", "second stopped"]);
        expect(platform.quitCount).toBe(0);
        expect(app.quitting).toBe(true);
    });

    test("in the frame loop a handled quit keeps the loop running and the next frame plays on", () => {
        const entries: string[] = [];
        const scheduler = new ManualFrameScheduler();
        const platform = new MemoryPlatform({frameScheduler: scheduler});
        const app = new App({platform, handleRequestedQuit: owner(entries, "handled")});
        const world = journaled(app.createWorld(), "world", entries, [Gameplay, Draw, SaveOnQuit]);
        world.resources.insert(new QuitNow());
        world.startLoop();
        const frameTimeMs = CATCH_UP_TICKS * TICK_MS;
        platform.setNow(frameTimeMs);
        scheduler.frame(frameTimeMs);

        expect(entries).toEqual(["world gameplay", "world gameplay", "world gameplay", "world present", "world save", "owner"]);
        expect(scheduler.running).toBe(true);
        entries.length = 0;

        world.resources.remove(QuitNow);
        const nextFrameTimeMs = frameTimeMs + TICK_MS;
        platform.setNow(nextFrameTimeMs);
        scheduler.frame(nextFrameTimeMs);
        expect(entries).toEqual(["world gameplay", "world present"]);
        expect(platform.quitCount).toBe(0);
        world.pause();
    });

    test("a quit that a quit system requests during a handled quit belongs to that quit", () => {
        const entries: string[] = [];
        const platform = new MemoryPlatform();
        const app = new App({platform, handleRequestedQuit: owner(entries, "handled")});
        const world = journaled(app.createWorld(), "world", entries, [RequestQuitOnQuit]);
        world.requestQuit();
        world.step();
        world.step();

        expect(entries).toEqual(["world quit again", "owner"]);
        expect(app.quitPending).toBe(false);
    });

    test("an owner that lets the quit proceed is asked after the quit groups, then every world stops and the platform quits once, as without an owner", () => {
        const entries: string[] = [];
        const platform = new MemoryPlatform();
        const app = new App({platform, handleRequestedQuit: owner(entries, "proceed")});
        const first = journaled(app.createWorld(), "first", entries, [...PLAYED_SYSTEMS, ...QUIT_SYSTEMS]);
        journaled(app.createDebugWorld(), "second", entries, QUIT_SYSTEMS);
        platform.onExit(() => entries.push("platform exit"));
        first.resources.insert(new QuitNow());
        first.step();
        first.requestQuit();
        first.step();
        app.quitAfterFrame();
        platform.exit();

        expect(entries).toEqual([
            "first gameplay", "first late gameplay", "first present",
            "first save", "first close", "second save", "second close",
            "owner",
            "first stopped", "second stopped",
            "platform exit",
        ]);
        expect(platform.quitCount).toBe(1);
        expect(app.worlds.length).toBe(0);
        expect([app.quitting, app.quitPending]).toEqual([true, false]);
    });
});
