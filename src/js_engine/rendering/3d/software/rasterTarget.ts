/**
 * The rasterizer's output for one flushed batch: depth (+Infinity where
 * uncovered) and packed 0xRRGGBB color per subsample, row-major over a
 * rasterWidth × rasterHeight grid that tiles width × height cells.
 */
export interface SubsampleLayers {
    readonly depth: Float32Array<ArrayBufferLike>;
    readonly color: Int32Array<ArrayBufferLike>;
    /** Cells. */
    readonly width: number;
    readonly height: number;
    readonly supersampleX: number;
    readonly supersampleY: number;
    readonly rowsPerCell: number;
    readonly rasterWidth: number;
    readonly rasterHeight: number;
    /** Two vertical halves per cell, each supersampleY rows, top half first: rowsPerCell = supersampleY * 2. */
    readonly halfBlock: boolean;
}

/** Where MeshRasterizer delivers its subsample layers; called once per flushed batch, possibly several times a frame. */
export interface RasterTarget {
    composite(layers: SubsampleLayers): void;
}
