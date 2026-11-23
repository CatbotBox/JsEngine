import {World} from "./world";
import {DebugWorld} from "./debugWorld";
import {QuitSystemGroup} from "./quitSystemGroup";
import type {Platform} from "../platform/platform";

const NOT_FOUND = -1;
const ONE_WORLD = 1;
const HANDLED_BY_OWNER: RequestedQuitHandling = "handled";

export type RequestedQuitHandling = "handled" | "proceed";

export interface AppOptions {
    readonly platform: Platform;
    readonly handleRequestedQuit?: () => RequestedQuitHandling;
}

function runQuitGroup(world: World): void {
    try {
        world.tryGetSystem(QuitSystemGroup)?.update();
    } catch (error) {
        console.error("The quit systems failed while the app quit:", error);
    }
}

function stopLoggingErrors(world: World): void {
    try {
        world.stop();
    } catch (error) {
        console.error("A world failed to stop while the app quit:", error);
    }
}

export class App {
    public readonly platform: Platform;
    private readonly _worlds: World[] = [];
    private readonly handleRequestedQuit: (() => RequestedQuitHandling) | undefined;
    private _quitRequested = false;
    private _quitStarted = false;
    private readonly stopWatchingExit: () => void;

    public constructor(options: AppOptions) {
        this.platform = options.platform;
        this.handleRequestedQuit = options.handleRequestedQuit;
        this.stopWatchingExit = options.platform.onExit(() => this.runQuitGroupsAndStop());
    }

    public get worlds(): readonly World[] {
        return this._worlds;
    }

    public get quitting(): boolean {
        return this._quitRequested || this._quitStarted;
    }

    public get quitPending(): boolean {
        return this._quitRequested && !this._quitStarted;
    }

    public createWorld(): World {
        return new World({platform: this.platform, app: this});
    }

    public createDebugWorld(): DebugWorld {
        return new DebugWorld({platform: this.platform, app: this});
    }

    public addWorld(world: World): void {
        if (world.app !== this) throw new Error("App.addWorld: the world was created for another app; create it with this app's createWorld");
        if (this._worlds.includes(world)) return;
        this._worlds.push(world);
        const forgetWorld = (): void => {
            world.onStopped.remove(forgetWorld);
            const index = this._worlds.indexOf(world);
            if (index !== NOT_FOUND) this._worlds.splice(index, ONE_WORLD);
        };
        world.onStopped.add(forgetWorld);
    }

    public requestQuit(): void {
        this._quitRequested = true;
    }

    public quitAfterFrame(): void {
        if (!this.quitPending) return;
        const handleRequestedQuit = this.handleRequestedQuit;
        if (handleRequestedQuit === undefined) {
            this.runQuitGroupsAndStop();
            this.platform.quit();
            return;
        }
        this.quitThroughOwner(handleRequestedQuit);
    }

    private quitThroughOwner(handleRequestedQuit: () => RequestedQuitHandling): void {
        for (const world of [...this._worlds]) runQuitGroup(world);
        this._quitRequested = false;
        if (handleRequestedQuit() === HANDLED_BY_OWNER) return;
        this.stopAfterQuitGroups();
        this.platform.quit();
    }

    private runQuitGroupsAndStop(): void {
        if (this._quitStarted) return;
        this.startStopping();
        for (const world of [...this._worlds]) {
            world.pause();
            runQuitGroup(world);
        }
        this.stopWorlds();
    }

    private stopAfterQuitGroups(): void {
        if (this._quitStarted) return;
        this.startStopping();
        for (const world of [...this._worlds]) world.pause();
        this.stopWorlds();
    }

    private startStopping(): void {
        this._quitStarted = true;
        this.stopWatchingExit();
    }

    private stopWorlds(): void {
        for (const world of [...this._worlds]) stopLoggingErrors(world);
    }
}
