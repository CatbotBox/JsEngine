export const SCREEN_UNIT_HEIGHT_PER_WIDTH = 2;

const HALF = 0.5;

export class WorldViewRect {
    public xMin = 0;
    public yMin = 0;
    public xMax = 0;
    public yMax = 0;
    public widthUnits = 0;
    public heightUnits = 0;
}

export interface WorldPosition {
    x: number;
    y: number;
}

export function worldViewRectInto(out: WorldViewRect, cameraX: number, cameraY: number, screenWidth: number, screenHeight: number): WorldViewRect {
    const widthUnits = screenWidth;
    const heightUnits = screenHeight * SCREEN_UNIT_HEIGHT_PER_WIDTH;
    out.widthUnits = widthUnits;
    out.heightUnits = heightUnits;
    out.xMin = cameraX - HALF * widthUnits;
    out.yMin = cameraY - HALF * heightUnits;
    out.xMax = out.xMin + widthUnits;
    out.yMax = out.yMin + heightUnits;
    return out;
}

export function pointerWorldPositionInto(out: WorldPosition, view: WorldViewRect, pointerX: number, pointerY: number): WorldPosition {
    out.x = view.xMin + pointerX;
    out.y = view.yMin + pointerY * SCREEN_UNIT_HEIGHT_PER_WIDTH;
    return out;
}
