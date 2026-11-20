import {ComponentType, NULL_ENTITY, persistentTrackComponent, System} from "../../src/engine/core";
import type {Entity, World} from "../../src/engine/core";
import {TextSprite} from "../../src/engine/rendering";
import type {TextColor} from "../../src/engine/rendering";
import {AverageStat} from "../../src/engine/datatypes";
import {untrackedComponentOf} from "../../src/engine/scene";
import {Enemy, SwarmHud} from "./components";
import {SwarmPhase, SwarmState} from "./resources";
import {MS_PER_SECOND, SwarmTuning} from "./tuning";
import type {ControlHint, HudTuning, TitleBanner, WaveBanner} from "./tuning";

const HUD_PRIORITY = -10;
const HALF = 0.5;
const UNSHOWN = -1;
const REFRESH_ON_FIRST_FRAME_MS = Number.POSITIVE_INFINITY;
const NO_TEXT: string[] = [];
const BLANK_LINE = "";
const SPACE = " ";
const PLACEHOLDER = /\{(\w+)\}/g;

type BannerKind = "none" | "title" | "wave" | "gameOver";

type HudValues = Readonly<Record<string, number>>;

function formatHudText(template: string, values: HudValues): string {
    return template.replace(PLACEHOLDER, (placeholder: string, name: string) =>
        Object.prototype.hasOwnProperty.call(values, name) ? String(values[name]) : placeholder);
}

function formatHudLines(lines: readonly string[], values: HudValues): string[] {
    return lines.map(line => formatHudText(line, values));
}

function widestLength(lines: readonly string[]): number {
    let width = 0;
    for (const line of lines) width = Math.max(width, line.length);
    return width;
}

function centeredPanel(lines: readonly string[], paddingColumns: number): string[] {
    const width = widestLength(lines);
    const padding = SPACE.repeat(paddingColumns);
    const rows = [BLANK_LINE, ...lines, BLANK_LINE];
    return rows.map(line => padding + (SPACE.repeat(Math.floor((width - line.length) * HALF)) + line).padEnd(width) + padding);
}

function controlLines(controls: readonly ControlHint[], keyColumns: number): string[] {
    const lines = controls.map(control => control.keys.padEnd(keyColumns) + control.effect);
    const width = widestLength(lines);
    return lines.map(line => line.padEnd(width));
}

function stateValues(state: SwarmState): HudValues {
    return {score: state.score, wave: state.wave, lives: state.lives, bombs: state.bombs, kills: state.kills};
}

function titleLines(title: TitleBanner, values: HudValues): string[] {
    return [...formatHudLines(title.lines, values), ...controlLines(title.controls, title.controlKeyColumns), ...formatHudLines(title.promptLines, values)];
}

function waveLines(banner: WaveBanner, state: SwarmState, values: HudValues): string[] {
    const lines = formatHudLines(banner.lines, values);
    if (state.lastClearEarnedBomb) lines.push(...formatHudLines(banner.bombEarnedLines, values));
    return lines;
}

class HudLabel {
    private source: TextSprite | undefined;
    private label: TextSprite | undefined;
    private lines: string[] | undefined;
    private foreground: TextColor | undefined;

    public bindTo(world: World, entity: Entity): void {
        const source = untrackedComponentOf<TextSprite>(world, entity, ComponentType.of(TextSprite));
        if (source === this.source) return;
        this.source = source;
        this.label = source === undefined ? undefined : persistentTrackComponent(entity, source);
        if (this.foreground !== undefined) this.paint(this.foreground);
        if (this.lines !== undefined) this.show(this.lines);
    }

    public paint(foreground: TextColor): void {
        this.foreground = foreground;
        if (this.label !== undefined) this.label.foreground = foreground;
    }

    public show(lines: string[]): void {
        this.lines = lines;
        if (this.label !== undefined) this.label.image = lines;
    }
}

export class SwarmHudSystem extends System {
    private _hud = this.createEntityQuery([SwarmHud]);
    private _enemies = this.createEntityQuery([Enemy]);
    private _status = new HudLabel();
    private _stats = new HudLabel();
    private _banner = new HudLabel();
    private _fps: AverageStat | undefined;
    private _fpsAverageFrames = UNSHOWN;
    private _sinceStatsRefreshMs = REFRESH_ON_FIRST_FRAME_MS;
    private _shownPhase: SwarmPhase | undefined;
    private _shownScore = UNSHOWN;
    private _shownWave = UNSHOWN;
    private _shownLives = UNSHOWN;
    private _shownBombs = UNSHOWN;
    private _shownBanner: BannerKind | undefined;
    private _shownBannerWave = UNSHOWN;

    override priority(): number {
        return HUD_PRIORITY;
    }

    protected onCreate(): void {
        this.requireResourceForUpdate(SwarmState);
        this.requireResourceForUpdate(SwarmTuning);
    }

    onUpdate(): void {
        const hud = this._hud.tryGetSingleton({hud: SwarmHud})?.hud;
        this._status.bindTo(this.world, hud?.status ?? NULL_ENTITY);
        this._stats.bindTo(this.world, hud?.stats ?? NULL_ENTITY);
        this._banner.bindTo(this.world, hud?.banner ?? NULL_ENTITY);
        const state = this.world.resources.get(SwarmState);
        const tuning = this.world.resources.get(SwarmTuning).hud;
        this.refreshStatus(state, tuning);
        this.refreshStats(tuning);
        this.refreshBanner(state, tuning);
    }

    private refreshStatus(state: SwarmState, tuning: HudTuning): void {
        if (state.phase === this._shownPhase && state.score === this._shownScore && state.wave === this._shownWave
            && state.lives === this._shownLives && state.bombs === this._shownBombs) return;
        this._shownPhase = state.phase;
        this._shownScore = state.score;
        this._shownWave = state.wave;
        this._shownLives = state.lives;
        this._shownBombs = state.bombs;
        this._status.show(state.phase === SwarmPhase.Title ? NO_TEXT : [formatHudText(tuning.statusFormat, stateValues(state))]);
    }

    private refreshStats(tuning: HudTuning): void {
        const fps = this.fpsAveragedOver(tuning.fpsAverageFrames);
        const time = this.world.time;
        if (time.frameDeltaTimeMs > 0) fps.add(MS_PER_SECOND / time.frameDeltaTimeMs);
        this._sinceStatsRefreshMs += time.deltaTimeMs;
        if (this._sinceStatsRefreshMs < tuning.statsRefreshMs) return;
        this._sinceStatsRefreshMs = 0;
        this._stats.show([formatHudText(tuning.statsFormat, {enemies: this._enemies.enabledEntityCount(), fps: Math.round(fps.getAvg())})]);
    }

    private fpsAveragedOver(frames: number): AverageStat {
        if (this._fps === undefined || this._fpsAverageFrames !== frames) {
            this._fps = new AverageStat(frames);
            this._fpsAverageFrames = frames;
        }
        return this._fps;
    }

    private refreshBanner(state: SwarmState, tuning: HudTuning): void {
        const banner = this.bannerOf(state);
        if (banner === this._shownBanner && state.wave === this._shownBannerWave) return;
        this._shownBanner = banner;
        this._shownBannerWave = state.wave;
        const values = stateValues(state);
        switch (banner) {
            case "title":
                this._banner.paint(tuning.title.color);
                this._banner.show(centeredPanel(titleLines(tuning.title, values), tuning.panelPaddingColumns));
                break;
            case "wave":
                this._banner.paint(tuning.wave.color);
                this._banner.show(centeredPanel(waveLines(tuning.wave, state, values), tuning.panelPaddingColumns));
                break;
            case "gameOver":
                this._banner.paint(tuning.gameOver.color);
                this._banner.show(centeredPanel(formatHudLines(tuning.gameOver.lines, values), tuning.panelPaddingColumns));
                break;
            case "none":
                this._banner.show(NO_TEXT);
                break;
        }
    }

    private bannerOf(state: SwarmState): BannerKind {
        if (state.phase === SwarmPhase.Title) return "title";
        if (state.phase === SwarmPhase.GameOver) return "gameOver";
        if (state.phase === SwarmPhase.Playing && state.intermissionRemainingMs > 0) return "wave";
        return "none";
    }
}
