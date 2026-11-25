const UNMEASURED_PX = -1;

export interface SizeObservation {
    observe(target: SizedElement): void;

    disconnect(): void;
}

export interface SizeObserverWindow {
    readonly ResizeObserver?: new (callback: () => void) => SizeObservation;

    requestAnimationFrame(callback: () => void): number;
}

export interface SizedElement {
    readonly ownerDocument: {readonly defaultView: SizeObserverWindow | null};

    getBoundingClientRect(): {readonly width: number, readonly height: number};
}

export class FollowedElementSize {
    private observedIn: SizeObserverWindow | undefined;
    private observer: SizeObservation | undefined;
    private width = UNMEASURED_PX;
    private height = UNMEASURED_PX;
    private scheduledIn: SizeObserverWindow | undefined;
    private disposed = false;

    public constructor(private readonly element: SizedElement, private readonly changed: () => void) {
        this.follow();
    }

    public follow(): void {
        const window = this.element.ownerDocument.defaultView ?? undefined;
        if (this.disposed || window === this.observedIn) return;
        this.observer?.disconnect();
        this.observer = undefined;
        this.observedIn = window;
        const Observer = window?.ResizeObserver;
        if (typeof Observer !== "function") return;
        this.observer = new Observer(this.measure);
        this.observer.observe(this.element);
    }

    public dispose(): void {
        this.disposed = true;
        this.observer?.disconnect();
        this.observer = undefined;
        this.observedIn = undefined;
    }

    private readonly measure = (): void => {
        const bounds = this.element.getBoundingClientRect();
        if (bounds.width === this.width && bounds.height === this.height) return;
        this.width = bounds.width;
        this.height = bounds.height;
        const window = this.element.ownerDocument.defaultView ?? this.observedIn;
        if (window === undefined || this.scheduledIn === window) return;
        this.scheduledIn = window;
        window.requestAnimationFrame(this.run);
    };

    private readonly run = (): void => {
        this.scheduledIn = undefined;
        if (!this.disposed) this.changed();
    };
}
