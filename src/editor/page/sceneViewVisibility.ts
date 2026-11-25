export const VISIBLE_DOCUMENT: DocumentVisibilityState = "visible";

const VISIBILITY_CHANGE = "visibilitychange";
const VISIBLE_BEFORE_FOLLOWING = true;

export interface SceneViewVisibility {
    readonly panelShown: boolean;
    readonly layoutShowsSceneView: boolean;
    readonly documentVisible: boolean;
}

export interface VisibilityDocument {
    readonly visibilityState: DocumentVisibilityState;

    addEventListener(type: typeof VISIBILITY_CHANGE, listener: () => void): void;

    removeEventListener(type: typeof VISIBILITY_CHANGE, listener: () => void): void;
}

export function isSceneViewVisible(visibility: SceneViewVisibility): boolean {
    return visibility.panelShown && visibility.layoutShowsSceneView && visibility.documentVisible;
}

export function isDocumentVisible(document: Pick<VisibilityDocument, "visibilityState">): boolean {
    return document.visibilityState === VISIBLE_DOCUMENT;
}

export class FollowedDocumentVisibility {
    private followed: VisibilityDocument | undefined;
    private shown = VISIBLE_BEFORE_FOLLOWING;
    private readonly listener = (): void => this.read();

    public constructor(private readonly changed: () => void) {
    }

    public get visible(): boolean {
        return this.shown;
    }

    public follow(document: VisibilityDocument): void {
        if (document === this.followed) return;
        this.followed?.removeEventListener(VISIBILITY_CHANGE, this.listener);
        this.followed = document;
        document.addEventListener(VISIBILITY_CHANGE, this.listener);
        this.read();
    }

    public dispose(): void {
        this.followed?.removeEventListener(VISIBILITY_CHANGE, this.listener);
        this.followed = undefined;
    }

    private read(): void {
        const document = this.followed;
        if (document === undefined) return;
        const visible = isDocumentVisible(document);
        if (visible === this.shown) return;
        this.shown = visible;
        this.changed();
    }
}
