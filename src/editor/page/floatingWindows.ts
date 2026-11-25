import {clampedScreenBounds, DOCK_WINDOW_URL, dockWindowFeatures, dockWindowName} from "../project/dockWindows";
import type {ScreenBounds} from "../project/dockWindows";
import type {DockWindowMetrics} from "./dockGeometry";
import {createElement} from "./dom";
import {appliedPageUiScale, applyPageUiScale} from "./uiScale";

export interface FloatingWindowEvents {
    readonly moved: (bounds: ScreenBounds) => void;
    readonly closedByUser: () => void;
    readonly focused: () => void;
}

export interface FloatingWindow {
    readonly document: Document;
    readonly root: HTMLElement;
    readonly openedAt: ScreenBounds;

    metrics(): DockWindowMetrics;

    bounds(): ScreenBounds;

    place(bounds: ScreenBounds): void;

    setTitle(title: string): void;

    focus(): void;

    close(): void;
}

export interface FloatingWindowHost {
    open(id: string, bounds: ScreenBounds, events: FloatingWindowEvents): FloatingWindow | undefined;
}

export type OpenerWindow = Window & typeof globalThis;

interface ScreenArea {
    readonly availLeft?: number;
    readonly availTop?: number;
    readonly availWidth: number;
    readonly availHeight: number;
    readonly isExtended?: boolean;
}

const DOCUMENT_SKELETON = "<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\"><title></title></head><body></body></html>";
const STYLESHEET_SELECTOR = "link[rel~=\"stylesheet\"], style";
const LINK_TAG = "LINK";
const STYLESHEET_REL = "stylesheet";
const ROOT_CLASS = "dock-root floating-dock-root";
const ROOT_LABEL = "Panels";
const STYLE_ATTRIBUTE = "style";
const STYLE_CHANGES: MutationObserverInit = {attributes: true, attributeFilter: [STYLE_ATTRIBUTE]};
const BOUNDS_POLL_MS = 500;
const BOUNDS_SETTLE_MS = 200;
const NO_OFFSET = 0;

function sameBounds(a: ScreenBounds, b: ScreenBounds): boolean {
    return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
}

function copyStylesheets(from: Document, to: Document): void {
    for (const sheet of from.querySelectorAll<HTMLLinkElement | HTMLStyleElement>(STYLESHEET_SELECTOR)) {
        if (sheet.tagName === LINK_TAG) {
            const link = to.createElement("link");
            link.rel = STYLESHEET_REL;
            link.href = (sheet as HTMLLinkElement).href;
            to.head.append(link);
            continue;
        }
        const style = to.createElement("style");
        style.textContent = sheet.textContent;
        to.head.append(style);
    }
}

function visibleBounds(bounds: ScreenBounds, screen: ScreenArea): ScreenBounds {
    if (screen.isExtended === true || !(screen.availWidth > 0 && screen.availHeight > 0)) return bounds;
    return clampedScreenBounds(bounds, {x: screen.availLeft ?? NO_OFFSET, y: screen.availTop ?? NO_OFFSET, width: screen.availWidth, height: screen.availHeight});
}

class BrowserFloatingWindow implements FloatingWindow {
    public readonly document: Document;
    public readonly root: HTMLElement;
    private known: ScreenBounds;
    private closing = false;
    private readonly pollTimer: number;
    private settleTimer: number | undefined;
    private readonly scaleObserver: MutationObserver;

    public constructor(private readonly opener: OpenerWindow, private readonly popup: Window, public readonly openedAt: ScreenBounds, private readonly events: FloatingWindowEvents) {
        const document = popup.document;
        document.open();
        document.write(DOCUMENT_SKELETON);
        document.close();
        this.document = document;
        copyStylesheets(opener.document, document);
        this.root = createElement(document, "div", ROOT_CLASS);
        this.root.setAttribute("aria-label", ROOT_LABEL);
        document.body.append(this.root);
        this.known = openedAt;
        this.syncUiScale();
        this.scaleObserver = new opener.MutationObserver(() => this.syncUiScale());
        this.scaleObserver.observe(opener.document.documentElement, STYLE_CHANGES);
        popup.addEventListener("pagehide", () => this.closedByUser());
        popup.addEventListener("resize", () => this.settle());
        popup.addEventListener("focus", () => events.focused());
        this.pollTimer = opener.setInterval(() => this.poll(), BOUNDS_POLL_MS);
    }

    public metrics(): DockWindowMetrics {
        const popup = this.popup;
        return {screenX: popup.screenX, screenY: popup.screenY, outerWidth: popup.outerWidth, outerHeight: popup.outerHeight, innerWidth: popup.innerWidth, innerHeight: popup.innerHeight};
    }

    public bounds(): ScreenBounds {
        if (this.popup.closed) return this.known;
        const popup = this.popup;
        const live = {x: popup.screenX, y: popup.screenY, width: popup.outerWidth, height: popup.outerHeight};
        return live.width > 0 && live.height > 0 ? live : this.known;
    }

    public place(bounds: ScreenBounds): void {
        if (this.closing || sameBounds(bounds, this.known)) return;
        this.known = bounds;
        try {
            this.popup.moveTo(Math.round(bounds.x), Math.round(bounds.y));
            this.popup.resizeTo(Math.round(bounds.width), Math.round(bounds.height));
        } catch {
            return;
        }
    }

    public setTitle(title: string): void {
        if (this.document.title !== title) this.document.title = title;
    }

    public focus(): void {
        if (!this.closing) this.popup.focus();
    }

    public close(): void {
        if (this.closing) return;
        this.stop();
        this.popup.close();
    }

    private stop(): void {
        this.closing = true;
        this.opener.clearInterval(this.pollTimer);
        if (this.settleTimer !== undefined) this.opener.clearTimeout(this.settleTimer);
        this.scaleObserver.disconnect();
    }

    private closedByUser(): void {
        if (this.closing) return;
        this.stop();
        this.events.closedByUser();
    }

    private settle(): void {
        if (this.settleTimer !== undefined) this.opener.clearTimeout(this.settleTimer);
        this.settleTimer = this.opener.setTimeout(() => {
            this.settleTimer = undefined;
            this.poll();
        }, BOUNDS_SETTLE_MS);
    }

    private poll(): void {
        if (this.closing) return;
        if (this.popup.closed) {
            this.closedByUser();
            return;
        }
        const bounds = this.bounds();
        if (sameBounds(bounds, this.known)) return;
        this.known = bounds;
        this.events.moved(bounds);
    }

    private syncUiScale(): void {
        applyPageUiScale(this.document.documentElement, appliedPageUiScale(this.opener.document.documentElement));
    }
}

export class BrowserFloatingWindowHost implements FloatingWindowHost {
    public constructor(private readonly opener: OpenerWindow) {
    }

    public open(id: string, bounds: ScreenBounds, events: FloatingWindowEvents): FloatingWindow | undefined {
        const placed = visibleBounds(bounds, this.opener.screen as ScreenArea);
        let popup: Window | null;
        try {
            popup = this.opener.open(DOCK_WINDOW_URL, dockWindowName(id), dockWindowFeatures(placed));
        } catch {
            return undefined;
        }
        if (popup === null) return undefined;
        try {
            return new BrowserFloatingWindow(this.opener, popup, placed, events);
        } catch {
            popup.close();
            return undefined;
        }
    }
}
