import {keyEventsOfChord, mouseEventOfHover, mouseEventsOfClick, mouseEventsOfDrag} from "./smokeInput";
import type {SmokeInputEvent, SmokeMouseButton} from "./smokeInput";

export interface SmokePage {
    evaluate<T>(script: string): Promise<T>;

    sendInput(event: SmokeInputEvent): void;

    insertText(text: string): Promise<void>;

    zoomFactor(): number;
}

export interface SmokeClock {
    now(): number;

    sleep(ms: number): Promise<void>;
}

export interface SmokeUiOptions {
    readonly deadlineMs: number;
    readonly waitTimeoutMs: number;
    readonly pollMs: number;
}

interface ClickPoint {
    readonly x: number;
    readonly y: number;
}

interface ClickProblem {
    readonly problem: string;
}

export class SmokeFailure extends Error {
}

const OUTSIDE_WINDOW_PX = 60;
const LEFT_BUTTON: SmokeMouseButton = "left";
const RIGHT_BUTTON: SmokeMouseButton = "right";
const MIDDLE_BUTTON: SmokeMouseButton = "middle";

function visibleElementsScript(selector: string): string {
    return `[...document.querySelectorAll(${JSON.stringify(selector)})].filter(element => {
        if (!element.isConnected || !element.checkVisibility()) return false;
        const bounds = element.getBoundingClientRect();
        return bounds.width > 0 && bounds.height > 0;
    })`;
}

export function visibleCountScript(selector: string): string {
    return `${visibleElementsScript(selector)}.length`;
}

export function visibleTextsScript(selector: string): string {
    return `${visibleElementsScript(selector)}.map(element => (element.textContent ?? "").trim())`;
}

export function attributeScript(selector: string, name: string): string {
    return `(${visibleElementsScript(selector)}[0]?.getAttribute(${JSON.stringify(name)}) ?? null)`;
}

export function focusedScript(selector: string): string {
    return `(document.activeElement !== null && document.activeElement.matches(${JSON.stringify(selector)}))`;
}

export function clickPointScript(selector: string): string {
    return `(() => {
        const describe = element => element === null ? "nothing" : element.tagName.toLowerCase() + (typeof element.className === "string" && element.className.length > 0 ? "." + element.className.trim().split(/\\s+/).join(".") : "");
        const target = ${visibleElementsScript(selector)}[0];
        if (target === undefined) return {problem: "no visible element matches"};
        if (target.disabled === true) return {problem: "the element is disabled" + (target.title ? " (" + target.title + ")" : "")};
        target.scrollIntoView({block: "nearest", inline: "nearest"});
        const bounds = target.getBoundingClientRect();
        const x = bounds.left + bounds.width / 2;
        const y = bounds.top + bounds.height / 2;
        const hit = document.elementFromPoint(x, y);
        if (hit === null || (hit !== target && !target.contains(hit))) return {problem: "it is covered by " + describe(hit)};
        return {x, y};
    })()`;
}

function isProblem(point: ClickPoint | ClickProblem): point is ClickProblem {
    return "problem" in point;
}

export class SmokeUi {
    public constructor(private readonly page: SmokePage, private readonly clock: SmokeClock, private readonly options: SmokeUiOptions) {
    }

    public onPage(page: SmokePage): SmokeUi {
        return new SmokeUi(page, this.clock, this.options);
    }

    public async read<T>(script: string): Promise<T> {
        this.requireBudget();
        return await this.page.evaluate<T>(script);
    }

    public async visibleCount(selector: string): Promise<number> {
        return await this.read<number>(visibleCountScript(selector));
    }

    public async texts(selector: string): Promise<string[]> {
        return await this.read<string[]>(visibleTextsScript(selector));
    }

    public async text(selector: string): Promise<string | undefined> {
        return (await this.texts(selector))[0];
    }

    public async attribute(selector: string, name: string): Promise<string | null> {
        return await this.read<string | null>(attributeScript(selector, name));
    }

    public async isVisible(selector: string): Promise<boolean> {
        return await this.visibleCount(selector) > 0;
    }

    public async waitFor(description: string, condition: () => Promise<boolean>, timeoutMs: number = this.options.waitTimeoutMs): Promise<void> {
        const timeoutAt = this.clock.now() + timeoutMs;
        const budgetBound = this.options.deadlineMs < timeoutAt;
        const deadline = budgetBound ? this.options.deadlineMs : timeoutAt;
        let lastError: unknown;
        for (;;) {
            try {
                if (await condition()) return;
                lastError = undefined;
            } catch (error) {
                if (error instanceof SmokeFailure) throw error;
                lastError = error;
            }
            if (this.clock.now() >= deadline) {
                const cause = lastError === undefined ? "" : ` (last error: ${lastError instanceof Error ? lastError.message : String(lastError)})`;
                const ended = budgetBound ? "the flow ran out of its time budget" : `timed out after ${timeoutMs} ms`;
                throw new SmokeFailure(`${ended} waiting for ${description}${cause}`);
            }
            await this.clock.sleep(this.options.pollMs);
        }
    }

    public async waitForVisible(selector: string, description: string = selector, timeoutMs?: number): Promise<void> {
        await this.waitFor(`${description} to be visible`, () => this.isVisible(selector), timeoutMs);
    }

    public async waitForNone(selector: string, description: string = selector, timeoutMs?: number): Promise<void> {
        await this.waitFor(`${description} to be gone`, async () => !await this.isVisible(selector), timeoutMs);
    }

    public async waitForCount(selector: string, expected: number, description: string = selector, timeoutMs?: number): Promise<void> {
        let seen: number | undefined;
        try {
            await this.waitFor(`${expected} of ${description}`, async () => (seen = await this.visibleCount(selector)) === expected, timeoutMs);
        } catch (error) {
            if (error instanceof SmokeFailure && seen !== undefined) throw new SmokeFailure(`${error.message}; saw ${seen}`);
            throw error;
        }
    }

    public async waitForAttribute(selector: string, name: string, value: string | null, description: string = selector, timeoutMs?: number): Promise<void> {
        let seen: string | null | undefined;
        try {
            await this.waitFor(`${description} to have ${name}=${String(value)}`, async () => (seen = await this.attribute(selector, name)) === value, timeoutMs);
        } catch (error) {
            if (error instanceof SmokeFailure && seen !== undefined) throw new SmokeFailure(`${error.message}; saw ${String(seen)}`);
            throw error;
        }
    }

    public async waitForFocus(selector: string, description: string = selector): Promise<void> {
        await this.waitFor(`${description} to have focus`, () => this.read<boolean>(focusedScript(selector)));
    }

    public async click(selector: string, description: string = selector): Promise<void> {
        await this.clickWith(selector, LEFT_BUTTON, description);
    }

    public async rightClick(selector: string, description: string = selector): Promise<void> {
        await this.clickWith(selector, RIGHT_BUTTON, description);
    }

    public async middleClick(selector: string, description: string = selector): Promise<void> {
        await this.clickWith(selector, MIDDLE_BUTTON, description);
    }

    public async hover(selector: string, description: string = selector): Promise<void> {
        const point = await this.clickablePoint(selector, description);
        const zoom = this.page.zoomFactor();
        this.page.sendInput(mouseEventOfHover(point.x * zoom, point.y * zoom));
    }

    public async drag(fromSelector: string, toSelector: string, description: string): Promise<void> {
        const from = await this.clickablePoint(fromSelector, `the start of ${description}`);
        const to = await this.clickablePoint(toSelector, `the end of ${description}`);
        const zoom = this.page.zoomFactor();
        for (const event of mouseEventsOfDrag(from.x * zoom, from.y * zoom, to.x * zoom, to.y * zoom)) this.page.sendInput(event);
    }

    public async dragOutside(fromSelector: string, description: string): Promise<void> {
        const from = await this.clickablePoint(fromSelector, `the start of ${description}`);
        const zoom = this.page.zoomFactor();
        for (const event of mouseEventsOfDrag(from.x * zoom, from.y * zoom, -OUTSIDE_WINDOW_PX, from.y * zoom)) this.page.sendInput(event);
    }

    public async press(chord: string): Promise<void> {
        this.requireBudget();
        for (const event of keyEventsOfChord(chord)) this.page.sendInput(event);
    }

    public async type(text: string): Promise<void> {
        this.requireBudget();
        await this.page.insertText(text);
    }

    public fail(reason: string): never {
        throw new SmokeFailure(reason);
    }

    public expect(condition: boolean, reason: string): void {
        if (!condition) this.fail(reason);
    }

    private async clickWith(selector: string, button: SmokeMouseButton, description: string): Promise<void> {
        const point = await this.clickablePoint(selector, description);
        const zoom = this.page.zoomFactor();
        for (const event of mouseEventsOfClick(point.x * zoom, point.y * zoom, button)) this.page.sendInput(event);
    }

    private async clickablePoint(selector: string, description: string): Promise<ClickPoint> {
        let found: ClickPoint | ClickProblem = {problem: "it was never checked"};
        try {
            await this.waitFor(`${description} to be clickable`, async () => !isProblem(found = await this.read<ClickPoint | ClickProblem>(clickPointScript(selector))));
        } catch (error) {
            if (error instanceof SmokeFailure && isProblem(found)) throw new SmokeFailure(`${error.message}: ${found.problem}`);
            throw error;
        }
        if (isProblem(found)) throw new SmokeFailure(`${description} is not clickable: ${found.problem}`);
        return found;
    }

    private requireBudget(): void {
        if (this.clock.now() > this.options.deadlineMs) throw new SmokeFailure("the flow ran past its time budget");
    }
}
