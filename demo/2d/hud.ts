import {NULL_ENTITY, System} from "@jsengine/engine/core";
import {Input, resolveInputActions} from "@jsengine/engine/input";
import type {ResolvedInputActions} from "@jsengine/engine/input";
import {HudElement, PresentationStats} from "@jsengine/engine/rendering";
import {AverageStat, RateWindow, WindowedCount} from "@jsengine/engine/datatypes";
import {formatHudText, HudLabel} from "@jsengine/engine/rendering/text";
import {Demo2dHud} from "./components";
import {ColorFadeSystem} from "./game";
import {Demo2dConfig} from "./config";
import {commandBufferOf, INCLUDING_DISABLED} from "./worldAccess";

const MS_PER_SECOND = 1000;
const BYTES_PER_KB = 1024;
const NO_FPS_SAMPLES = 0;
const HUD_PRIORITY = 10;

const Demo2dHudAction = {
    ToggleHud: "toggleHud",
} as const;

export class Demo2dHudSystem extends System {
    private _hud = this.createEntityQuery([Demo2dHud]);
    private _hudElements = this.createEntityQuery([HudElement]);
    private _entityCounter = new HudLabel();
    private _fpsCounter = new HudLabel();
    private readonly _fps = new AverageStat(NO_FPS_SAMPLES);
    private _presentationWindow!: RateWindow;
    private readonly _submits = new WindowedCount();
    private readonly _uploadedBytes = new WindowedCount();
    private _visible = true;
    private _actions!: ResolvedInputActions<typeof Demo2dHudAction>;

    override priority(): number {
        return HUD_PRIORITY;
    }

    protected onCreate(): void {
        this.requireResourceForUpdate(Demo2dConfig);
        this._actions = resolveInputActions(this.world, Demo2dHudAction);
        this._presentationWindow = new RateWindow(this.world.time.elapsedTimeMs);
    }

    onUpdate(): void {
        if (this.world.resources.get(Input).actionPressed(this._actions.ToggleHud)) {
            this._visible = !this._visible;
            commandBufferOf(this.world).setEnabledStateForQuery(this._hudElements, this._visible);
        }
        if (!this._visible) return;
        const config = this.world.resources.get(Demo2dConfig).hud;
        this._fps.resetIfWindowSizeChanged(config.fpsAverageFrames);
        const frameDeltaMs = this.world.time.frameDeltaTimeMs;
        if (frameDeltaMs > 0) this._fps.add(MS_PER_SECOND / frameDeltaMs);
        const hud = this._hud.tryGetSingleton({hud: Demo2dHud}, INCLUDING_DISABLED)?.hud;
        this._fpsCounter.bindTo(this.world, hud?.fpsCounter ?? NULL_ENTITY);
        this._entityCounter.bindTo(this.world, hud?.entityCounter ?? NULL_ENTITY);
        this._fpsCounter.show([formatHudText(config.fpsFormat, {fps: this._fps.getAvg().toFixed(config.fpsDecimals)})]);
        const fadeSystem = this.world.tryGetSystem(ColorFadeSystem);
        const lines = [fadeSystem === undefined
            ? config.fadeSystemInactiveText
            : formatHudText(config.entitiesFormat, {entities: fadeSystem.fadingCount().toFixed(config.entitiesDecimals)})];
        const presentation = this.world.resources.tryGet(PresentationStats);
        if (presentation !== undefined) {
            this.measurePresentation(presentation, config.presentationWindowMs);
            lines.push(formatHudText(config.presentationFormat, {
                submits: this._submits.perSecond.toFixed(config.presentationDecimals),
                upload: (this._uploadedBytes.deltaPer(this._submits) / BYTES_PER_KB).toFixed(config.presentationDecimals),
            }));
        }
        this._entityCounter.show(lines);
    }

    private measurePresentation(stats: PresentationStats, windowMs: number): void {
        if (!this._presentationWindow.tryClose(this.world.time.elapsedTimeMs, windowMs)) return;
        const lengthMs = this._presentationWindow.lengthMs;
        this._submits.closeWindow(stats.submittedFrames, lengthMs);
        this._uploadedBytes.closeWindow(stats.uploadedBytes, lengthMs);
    }
}
