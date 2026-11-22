import {inlineSourceMapText, rewriteStack, SourceMap, stackFrameUrls} from "./sourceMaps";
import type {StackLine} from "./sourceMaps";

export interface StackMapper {
    mapStack(stack: string): Promise<readonly StackLine[]>;
}

export type BundleTextFetch = (url: string) => Promise<string | undefined>;

export const REMEMBERED_BUNDLE_LIMIT = 4;

interface RememberedBundle {
    bundleText: Promise<string | undefined> | undefined;
    sourceMap: Promise<SourceMap | undefined> | undefined;
}

export async function fetchBundleText(url: string): Promise<string | undefined> {
    try {
        const response = await fetch(url);
        return response.ok ? await response.text() : undefined;
    } catch {
        return undefined;
    }
}

function absoluteUrl(url: string, baseUrl: string): string | undefined {
    try {
        return new URL(url, baseUrl).href;
    } catch {
        return undefined;
    }
}

function parsedSourceMap(bundleText: string | undefined): SourceMap | undefined {
    const mapText = bundleText === undefined ? undefined : inlineSourceMapText(bundleText);
    return mapText === undefined ? undefined : SourceMap.parse(mapText);
}

export class BundleStackMapper implements StackMapper {
    private readonly bundles = new Map<string, RememberedBundle>();

    public constructor(private readonly baseUrl: string, private readonly fetchText: BundleTextFetch = fetchBundleText) {
    }

    public addBundle(url: string): void {
        const absolute = absoluteUrl(url, this.baseUrl);
        if (absolute === undefined || this.bundles.has(absolute)) return;
        this.bundles.set(absolute, {bundleText: this.fetchText(absolute), sourceMap: undefined});
        for (const oldest of this.bundles.keys()) {
            if (this.bundles.size <= REMEMBERED_BUNDLE_LIMIT) break;
            this.bundles.delete(oldest);
        }
    }

    public async mapStack(stack: string): Promise<readonly StackLine[]> {
        const maps = new Map<string, SourceMap>();
        for (const url of stackFrameUrls(stack)) {
            const map = await this.sourceMapOf(url);
            if (map !== undefined) maps.set(url, map);
        }
        return rewriteStack(stack, url => maps.get(url));
    }

    private sourceMapOf(url: string): Promise<SourceMap | undefined> {
        const bundle = this.bundles.get(url);
        if (bundle === undefined) return Promise.resolve(undefined);
        if (bundle.sourceMap === undefined) {
            const bundleText = bundle.bundleText ?? Promise.resolve(undefined);
            bundle.bundleText = undefined;
            bundle.sourceMap = bundleText.then(parsedSourceMap, () => undefined);
        }
        return bundle.sourceMap;
    }
}
