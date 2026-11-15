export type RendererKind = "cpu" | "gpu";

const NO_RENDERERS = 0;

export class ActiveRenderers {
    private readonly _counts: Record<RendererKind, number> = {cpu: NO_RENDERERS, gpu: NO_RENDERERS};

    public add(kind: RendererKind): void {
        this._counts[kind]++;
    }

    public remove(kind: RendererKind): void {
        if (this._counts[kind] === NO_RENDERERS) throw new Error(`ActiveRenderers.remove: no ${kind} renderer is active`);
        this._counts[kind]--;
    }

    public count(kind: RendererKind): number {
        return this._counts[kind];
    }

    public get framesRenderedOnCpu(): boolean {
        return this._counts.cpu > NO_RENDERERS && this._counts.gpu === NO_RENDERERS;
    }
}
