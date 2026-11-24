import {NULL_ENTITY, System} from "@jsengine/engine/core";
import {activeRenderBackend, PresentationStats} from "@jsengine/engine/rendering";
import {MeshRenderStats} from "@jsengine/engine/rendering/3d";
import {RateWindow, WindowedCount} from "@jsengine/engine/datatypes";
import {formatHudLines, formatHudText, HudLabel} from "@jsengine/engine/rendering/text";
import {Demo3dHud, ModelGrid} from "./components";
import type {CatalogModel, ModelDownload} from "./modelCatalog";
import {Demo3dSession, sessionOf} from "./session";
import {Demo3dConfig} from "./config";
import type {Demo3dHudConfig, RenderPacingPreset} from "./config";
import {INCLUDING_DISABLED} from "./worldAccess";

const HUD_PRIORITY = 20;
const FIRST_MODEL = 0;
const BYTES_PER_KB = 1024;
const BYTES_PER_MB = BYTES_PER_KB * BYTES_PER_KB;
const COMPACT_DIGITS = 3;
const UNIT_STEP = 1000;
const NO_TEXT = "";
const PREVIEW_LINE_SEPARATOR = "\n";
const COMPACT_UNITS: readonly (readonly [value: number, suffix: string])[] = [
    [1e12, "T"],
    [1e9, "B"],
    [1e6, "M"],
    [1e3, "k"],
];

function formatCompact(num: number): string {
    const abs = Math.abs(num);
    const sign = num < 0 ? "-" : "";
    for (let i = 0; i < COMPACT_UNITS.length; i++) {
        const [value, suffix] = COMPACT_UNITS[i];
        if (abs < value) continue;
        const scaled = Number((abs / value).toPrecision(COMPACT_DIGITS));
        if (scaled >= UNIT_STEP && i > 0) {
            const [nextValue, nextSuffix] = COMPACT_UNITS[i - 1];
            return `${sign}${Number((abs / nextValue).toPrecision(COMPACT_DIGITS))}${nextSuffix}`;
        }
        return `${sign}${scaled}${suffix}`;
    }
    return `${sign}${abs}`;
}

function renderPacingOf(config: Demo3dConfig, session: Demo3dSession): RenderPacingPreset | undefined {
    return config.renderPacing[session.renderPacingIndex];
}

export class Demo3dHudSystem extends System {
    private _hud = this.createEntityQuery([Demo3dHud]);
    private _grids = this.createEntityQuery([ModelGrid]);
    private _preview = new HudLabel();
    private _entityCounter = new HudLabel();
    private _fpsCounter = new HudLabel();
    private _previewText: string | undefined;
    private _rateWindow!: RateWindow;
    private readonly _frames = new WindowedCount();
    private readonly _ticks = new WindowedCount();
    private readonly _submits = new WindowedCount();
    private readonly _uploadedBytes = new WindowedCount();

    override priority(): number {
        return HUD_PRIORITY;
    }

    protected onCreate(): void {
        this.requireResourceForUpdate(Demo3dConfig);
        this.requireResourceForUpdate(Demo3dSession);
        this._rateWindow = new RateWindow(this.world.time.elapsedTimeMs);
    }

    onUpdate(): void {
        const session = sessionOf(this.world);
        const config = this.world.resources.get(Demo3dConfig);
        const hud = this._hud.tryGetSingleton({hud: Demo3dHud}, INCLUDING_DISABLED)?.hud;
        this._preview.bindTo(this.world, hud?.preview ?? NULL_ENTITY);
        this._entityCounter.bindTo(this.world, hud?.entityCounter ?? NULL_ENTITY);
        this._fpsCounter.bindTo(this.world, hud?.fpsCounter ?? NULL_ENTITY);
        session.placedModels.sync();
        this.refreshPreview(session, config.hud);
        this.measureRates(config.hud.rateWindowMs);
        const pacing = renderPacingOf(config, session);
        this._fpsCounter.show(formatHudLines(config.hud.fpsLines, {
            fps: this._frames.perSecond.toFixed(config.hud.rateDecimals),
            ticks: this._ticks.perSecond.toFixed(config.hud.rateDecimals),
            pacing: this.pacingLabel(pacing, config.hud),
        }));
        const stats = this.world.resources.tryGet(MeshRenderStats);
        const lodLevels = stats === undefined ? NO_TEXT : formatHudText(config.hud.lodLevelsFormat, {
            levels: Array.from(stats.lodLevelCounts.subarray(0, config.hud.lodLevelsShown)).join(config.hud.lodLevelSeparator),
        });
        const statsLines = formatHudLines(config.hud.statsLines, {
            entities: this.world.enabledEntityCount,
            drawn: formatCompact(stats === undefined ? 0 : stats.trianglesDrawn),
            source: formatCompact(session.placedModels.sourceTriangles()),
            lodLevels,
        });
        if (activeRenderBackend(this.world) !== "gpu") {
            const rasterWorkers = stats === undefined ? 0 : stats.rasterWorkers;
            statsLines.push(formatHudText(config.hud.rasterWorkersLine, {
                rasterWorkers: rasterWorkers === 0 ? config.hud.singleThreadedRasterText : rasterWorkers,
            }));
        }
        if (this.world.resources.tryGet(PresentationStats) !== undefined) {
            statsLines.push(formatHudText(config.hud.presentationLine, {
                submits: this._submits.perSecond.toFixed(config.hud.rateDecimals),
                upload: (this._uploadedBytes.deltaPer(this._submits) / BYTES_PER_KB).toFixed(config.hud.rateDecimals),
            }));
        }
        this._entityCounter.show(statsLines);
    }

    private pacingLabel(pacing: RenderPacingPreset | undefined, hud: Demo3dHudConfig): string {
        const label = pacing?.label ?? NO_TEXT;
        const limit = this.world.loopTiming.renderRateLimit;
        return Number.isFinite(limit) ? formatHudText(hud.pacingWithCpuLimitFormat, {label, limit}) : label;
    }

    private refreshPreview(session: Demo3dSession, hud: Demo3dHudConfig): void {
        const catalog = session.catalog;
        const spawned = session.placedModels.count;
        const lines = [...catalog.downloads].map(([path, progress]) => this.downloadLine(catalog.modelFrom(path)?.name ?? path, progress, hud));
        const selected = this.selectedModel(session);
        lines.push(selected === undefined
            ? formatHudText(hud.noModelsFormat, {spawned})
            : formatHudText(hud.nextModelFormat, {model: selected.name, spawned}));
        const text = lines.join(PREVIEW_LINE_SEPARATOR);
        if (text === this._previewText) return;
        this._previewText = text;
        this._preview.show(lines);
    }

    private selectedModel(session: Demo3dSession): CatalogModel | undefined {
        const models = session.catalog.models;
        const selectedIndex = this._grids.tryGetSingleton({grid: ModelGrid}, INCLUDING_DISABLED)?.grid.selectedModelIndex ?? FIRST_MODEL;
        return models[selectedIndex] ?? models[FIRST_MODEL];
    }

    private downloadLine(name: string, progress: ModelDownload, hud: Demo3dHudConfig): string {
        if (progress.failure !== undefined) return formatHudText(hud.downloadFailedFormat, {model: name, failure: progress.failure});
        const queued = progress.queuedSpawns === 0 ? NO_TEXT : formatHudText(hud.queuedSpawnsFormat, {queued: progress.queuedSpawns});
        return formatHudText(hud.downloadFormat, {
            model: name,
            loaded: (progress.loadedBytes / BYTES_PER_MB).toFixed(hud.megabyteDecimals),
            total: (progress.totalBytes / BYTES_PER_MB).toFixed(hud.megabyteDecimals),
            queued,
        });
    }

    private measureRates(minimumWindowMs: number): void {
        const time = this.world.time;
        if (!this._rateWindow.tryClose(time.elapsedTimeMs, minimumWindowMs)) return;
        const windowMs = this._rateWindow.lengthMs;
        this._frames.closeWindow(time.frameCount, windowMs);
        this._ticks.closeWindow(time.tickCount, windowMs);
        const stats = this.world.resources.tryGet(PresentationStats);
        if (stats === undefined) return;
        this._submits.closeWindow(stats.submittedFrames, windowMs);
        this._uploadedBytes.closeWindow(stats.uploadedBytes, windowMs);
    }
}
