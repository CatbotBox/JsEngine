import {describe, expect, test} from "../../engine/testing/harness";
import type {SmokeInputEvent} from "./smokeInput";
import {SmokeFailure, SmokeUi} from "./smokeUi";
import type {SmokeClock, SmokePage} from "./smokeUi";

interface Bounds {
    readonly left: number;
    readonly top: number;
    readonly width: number;
    readonly height: number;
}

class FakeElement {
    public isConnected = true;
    public disabled = false;
    public title = "";
    public readonly tagName = "BUTTON";
    public visible = true;
    public scrolled = 0;

    public constructor(
        public readonly className: string,
        public textContent: string,
        public bounds: Bounds,
        private readonly attributes: Map<string, string> = new Map(),
    ) {
    }

    public checkVisibility(): boolean {
        return this.visible;
    }

    public getBoundingClientRect(): Bounds {
        return this.bounds;
    }

    public scrollIntoView(): void {
        this.scrolled++;
    }

    public contains(other: unknown): boolean {
        return other === this;
    }

    public getAttribute(name: string): string | null {
        return this.attributes.get(name) ?? null;
    }

    public matches(selector: string): boolean {
        return selector === `.${this.className}`;
    }
}

class FakeDocument {
    public readonly bySelector = new Map<string, FakeElement[]>();
    public hit: FakeElement | null = null;
    public activeElement: FakeElement | null = null;

    public querySelectorAll(selector: string): FakeElement[] {
        return this.bySelector.get(selector) ?? [];
    }

    public elementFromPoint(): FakeElement | null {
        return this.hit;
    }
}

class FakePage implements SmokePage {
    public readonly sent: SmokeInputEvent[] = [];
    public readonly typed: string[] = [];
    public zoom = 1;

    public constructor(private readonly document: FakeDocument, private readonly beforeEvaluate: () => void = () => undefined) {
    }

    public async evaluate<T>(script: string): Promise<T> {
        this.beforeEvaluate();
        return new Function("document", `return (${script});`)(this.document) as T;
    }

    public sendInput(event: SmokeInputEvent): void {
        this.sent.push(event);
    }

    public async insertText(text: string): Promise<void> {
        this.typed.push(text);
    }

    public zoomFactor(): number {
        return this.zoom;
    }
}

class FakeClock implements SmokeClock {
    public nowMs = 0;

    public now(): number {
        return this.nowMs;
    }

    public async sleep(ms: number): Promise<void> {
        this.nowMs += ms;
    }
}

const BUTTON = ".save";
const BUTTON_BOUNDS: Bounds = {left: 10, top: 20, width: 40, height: 10};
const WAIT_TIMEOUT_MS = 1000;
const POLL_MS = 100;
const BUDGET_MS = 60_000;

function fixture(beforeEvaluate?: () => void): {readonly document: FakeDocument, readonly page: FakePage, readonly clock: FakeClock, readonly ui: SmokeUi} {
    const document = new FakeDocument();
    const page = new FakePage(document, beforeEvaluate);
    const clock = new FakeClock();
    const ui = new SmokeUi(page, clock, {deadlineMs: BUDGET_MS, waitTimeoutMs: WAIT_TIMEOUT_MS, pollMs: POLL_MS});
    return {document, page, clock, ui};
}

function button(document: FakeDocument, attributes?: Map<string, string>): FakeElement {
    const element = new FakeElement("save", "Save", BUTTON_BOUNDS, attributes);
    document.bySelector.set(BUTTON, [element]);
    document.hit = element;
    return element;
}

async function failureOf(work: Promise<unknown>): Promise<string> {
    try {
        await work;
    } catch (error) {
        expect(error instanceof SmokeFailure).toBe(true);
        return (error as Error).message;
    }
    throw new Error("expected a smoke failure");
}

describe("SmokeUi clicks", () => {
    test("a click lands on the centre of the first visible match, scaled by the page zoom", async () => {
        const {document, page, ui} = fixture();
        const element = button(document);
        page.zoom = 2;
        await ui.click(BUTTON);
        expect(page.sent.map(event => [event.type, "x" in event ? event.x : undefined, "y" in event ? event.y : undefined])).toEqual([
            ["mouseMove", 60, 50],
            ["mouseDown", 60, 50],
            ["mouseUp", 60, 50],
        ]);
        expect(element.scrolled).toBe(1);
    });

    test("a click waits for the element to appear", async () => {
        let evaluations = 0;
        const {document, page, clock, ui} = fixture(() => {
            if (++evaluations === 3) button(document);
        });
        await ui.click(BUTTON);
        expect(page.sent.length).toBe(3);
        expect(clock.nowMs).toBe(2 * POLL_MS);
    });

    test("a covered, disabled or hidden element is not clicked, and the failure says why", async () => {
        const covered = fixture();
        button(covered.document);
        covered.document.hit = new FakeElement("editor-modal-backdrop", "", BUTTON_BOUNDS);
        expect(await failureOf(covered.ui.click(BUTTON, "Save"))).toBe(`timed out after ${WAIT_TIMEOUT_MS} ms waiting for Save to be clickable: it is covered by button.editor-modal-backdrop`);
        expect(covered.page.sent).toEqual([]);

        const disabled = fixture();
        const element = button(disabled.document);
        element.disabled = true;
        element.title = "Nothing to undo";
        expect(await failureOf(disabled.ui.click(BUTTON, "Undo"))).toBe(`timed out after ${WAIT_TIMEOUT_MS} ms waiting for Undo to be clickable: the element is disabled (Nothing to undo)`);

        const hidden = fixture();
        button(hidden.document).visible = false;
        expect(await failureOf(hidden.ui.click(BUTTON, "Save"))).toBe(`timed out after ${WAIT_TIMEOUT_MS} ms waiting for Save to be clickable: no visible element matches`);
    });
});

describe("SmokeUi reads and waits", () => {
    test("counts and texts skip hidden and zero-sized matches", async () => {
        const {document, ui} = fixture();
        const shown = new FakeElement("row", " One ", BUTTON_BOUNDS);
        const hidden = new FakeElement("row", "Two", BUTTON_BOUNDS);
        hidden.visible = false;
        const collapsed = new FakeElement("row", "Three", {left: 0, top: 0, width: 0, height: 0});
        document.bySelector.set(".row", [shown, hidden, collapsed]);
        expect(await ui.visibleCount(".row")).toBe(1);
        expect(await ui.texts(".row")).toEqual(["One"]);
    });

    test("attributes come from the first visible match", async () => {
        const {document, ui} = fixture();
        button(document, new Map([["aria-pressed", "true"]]));
        expect(await ui.attribute(BUTTON, "aria-pressed")).toBe("true");
        expect(await ui.attribute(BUTTON, "aria-checked")).toBe(null);
    });

    test("a count that never arrives fails with what was last seen", async () => {
        const {document, clock, ui} = fixture();
        button(document);
        expect(await failureOf(ui.waitForCount(BUTTON, 2, "save buttons"))).toBe(`timed out after ${WAIT_TIMEOUT_MS} ms waiting for 2 of save buttons; saw 1`);
        expect(clock.nowMs).toBe(WAIT_TIMEOUT_MS);
    });

    test("a page that cannot answer keeps being polled, and the last error is reported", async () => {
        const {ui} = fixture(() => {
            throw new Error("the page is navigating");
        });
        expect(await failureOf(ui.waitForVisible(BUTTON, "Save"))).toBe(`timed out after ${WAIT_TIMEOUT_MS} ms waiting for Save to be visible (last error: the page is navigating)`);
    });

    test("focus is read from the active element", async () => {
        const {document, ui} = fixture();
        document.activeElement = button(document);
        await ui.waitForFocus(BUTTON);
    });

    test("nothing runs once the flow is past its budget", async () => {
        const {document, clock, ui} = fixture();
        button(document);
        clock.nowMs = BUDGET_MS + 1;
        expect(await failureOf(ui.visibleCount(BUTTON))).toBe("the flow ran past its time budget");
        expect(await failureOf(ui.press("Escape"))).toBe("the flow ran past its time budget");
    });
});

describe("SmokeUi keys and text", () => {
    test("a chord becomes key events and text is inserted as typed", async () => {
        const {page, ui} = fixture();
        await ui.press("Ctrl+Shift+P");
        await ui.type("inspector");
        expect(page.sent.map(event => event.type)).toEqual(["keyDown", "keyUp"]);
        expect(page.typed).toEqual(["inspector"]);
    });
});
