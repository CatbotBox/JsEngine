export interface SubsampleLayers {
    readonly depth: Float32Array<ArrayBufferLike>;
    readonly color: Int32Array<ArrayBufferLike>;
    readonly width: number;
    readonly height: number;
    readonly supersampleX: number;
    readonly supersampleY: number;
    readonly rowsPerCell: number;
    readonly rasterWidth: number;
    readonly rasterHeight: number;
    readonly halfBlock: boolean;
}

export interface RasterTarget {
    composite(layers: SubsampleLayers): void;
}
