export function snappedUiEdge(positionUnits: number, deviceUnitsPerUiUnit: number): number {
    return Math.round(positionUnits * deviceUnitsPerUiUnit);
}

export class SnappedUiRect {
    public left = 0;
    public top = 0;
    public right = 0;
    public bottom = 0;

    public get isEmpty(): boolean {
        return this.left >= this.right || this.top >= this.bottom;
    }

    public snapEdges(leftUnits: number, topUnits: number, rightUnits: number, bottomUnits: number, unitWidth: number, unitHeight: number): this {
        this.left = snappedUiEdge(leftUnits, unitWidth);
        this.top = snappedUiEdge(topUnits, unitHeight);
        this.right = snappedUiEdge(rightUnits, unitWidth);
        this.bottom = snappedUiEdge(bottomUnits, unitHeight);
        return this;
    }

    public snapRect(xUnits: number, yUnits: number, widthUnits: number, heightUnits: number, unitWidth: number, unitHeight: number): this {
        return this.snapEdges(xUnits, yUnits, xUnits + widthUnits, yUnits + heightUnits, unitWidth, unitHeight);
    }

    public set(left: number, top: number, right: number, bottom: number): this {
        this.left = left;
        this.top = top;
        this.right = right;
        this.bottom = bottom;
        return this;
    }

    public intersect(other: SnappedUiRect): this {
        this.left = Math.max(this.left, other.left);
        this.top = Math.max(this.top, other.top);
        this.right = Math.min(this.right, other.right);
        this.bottom = Math.min(this.bottom, other.bottom);
        return this;
    }

    public clampTo(width: number, height: number): this {
        this.left = Math.max(0, this.left);
        this.top = Math.max(0, this.top);
        this.right = Math.min(width, this.right);
        this.bottom = Math.min(height, this.bottom);
        return this;
    }
}
