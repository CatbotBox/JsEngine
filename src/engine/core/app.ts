import {World} from "./world";
import {DebugWorld} from "./debugWorld";
import {QuitSystemGroup} from "./quitSystemGroup";
import type {Platform} from "../platform/platform";

const NOT_FOUND = -1;
const ONE_WORLD = 1;

export interface AppOptions {
    readonly platform: Platform;
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
    private _quitRequested = false;
    private _quitStarted = false;
    private readonly stopWatchingExit: () => void;

    public constructor(options: AppOptions) {
        this.platform = options.platform;
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
        this.runQuitGroupsAndStop();
        this.platform.quit();
    }

    private runQuitGroupsAndStop(): void {
        if (this._quitStarted) return;
        this._quitStarted = true;
        this.stopWatchingExit();
        for (const world of [...this._worlds]) {
            world.pause();
            runQuitGroup(world);
        }
        for (const world of [...this._worlds]) stopLoggingErrors(world);
    }
}
