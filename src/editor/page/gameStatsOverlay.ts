import type {EditorTickStats} from "../editorProtocol";
import {createElement} from "./dom";
import type {EditorWorkspace} from "./editorWorkspace";
import {GAME_STATS_POLL_INTERVAL_MS, gameStatsLines, tickRates} from "./gameStats";
import type {TickRates} from "./gameStats";

const LINE_BREAK = "\n";
const VIEWPORT_CANVAS_SELECTOR = "canvas";

export class GameStatsOverlay {
    public readonly element: HTMLElement;
    private timer: ReturnType<typeof setInterval> | undefined;
    private previous: EditorTickStats | undefined;
    private rates: TickRates | undefined;
    private polling = false;

    public constructor(document: Document, private readonly workspace: EditorWorkspace, private readonly viewport: HTMLElement, private readonly targetLabel: () => string) {
        this.element = createElement(document, "div", "game-stats");
        this.element.setAttribute("aria-label", "Game stats");
        this.element.hidden = true;
        workspace.on("state", () => this.update());
        workspace.on("entities", () => this.render());
        this.update();
    }

    public update(): void {
        const workspace = this.workspace;
        const shown = workspace.gameViewOptions.stats && !workspace.closed;
        this.element.hidden = !shown;
        if (shown) this.start();
        else this.stop();
        this.render();
    }

    private start(): void {
        if (this.timer !== undefined) return;
        this.previous = undefined;
        this.rates = undefined;
        this.timer = setInterval(() => void this.poll(), GAME_STATS_POLL_INTERVAL_MS);
        void this.poll();
    }

    private stop(): void {
        if (this.timer === undefined) return;
        clearInterval(this.timer);
        this.timer = undefined;
    }

    private async poll(): Promise<void> {
        if (this.polling) return;
        this.polling = true;
        try {
            const current = await this.workspace.request({op: "getTickStats"});
            if (this.previous !== undefined) this.rates = tickRates(this.previous, current) ?? this.rates;
            this.previous = current;
            this.render();
        } catch {
            this.stop();
        } finally {
            this.polling = false;
        }
    }

    private render(): void {
        if (this.element.hidden) return;
        const canvas = this.viewport.querySelector(VIEWPORT_CANVAS_SELECTOR);
        this.element.textContent = gameStatsLines({
            rates: this.rates,
            entityCount: this.workspace.entities.length,
            viewportWidthPx: canvas?.width ?? 0,
            viewportHeightPx: canvas?.height ?? 0,
            targetLabel: this.targetLabel(),
        }).join(LINE_BREAK);
    }
}
