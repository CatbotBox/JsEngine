export interface GameViewAspect {
    readonly id: string;
    readonly label: string;
    readonly widthToHeight: number | undefined;
}

export interface FittedRect {
    readonly left: number;
    readonly top: number;
    readonly width: number;
    readonly height: number;
}

export const GAME_VIEW_ASPECT_STORAGE_KEY = "jsengine.editor.gameViewAspect";
export const FREE_ASPECT: GameViewAspect = {id: "free", label: "Free Aspect", widthToHeight: undefined};
export const GAME_VIEW_ASPECTS: readonly GameViewAspect[] = [
    FREE_ASPECT,
    {id: "16:9", label: "16:9", widthToHeight: 16 / 9},
    {id: "16:10", label: "16:10", widthToHeight: 16 / 10},
    {id: "4:3", label: "4:3", widthToHeight: 4 / 3},
    {id: "5:4", label: "5:4", widthToHeight: 5 / 4},
    {id: "1:1", label: "1:1", widthToHeight: 1},
    {id: "9:16", label: "9:16 (portrait)", widthToHeight: 9 / 16},
];

const CENTERING_DIVISOR = 2;
const EMPTY_FRAME: FittedRect = {left: 0, top: 0, width: 0, height: 0};
const SUBPIXEL_TOLERANCE = 1e-6;

function wholePixels(value: number): number {
    return Math.floor(value + SUBPIXEL_TOLERANCE);
}

export function gameViewAspectOf(id: string | null): GameViewAspect {
    return GAME_VIEW_ASPECTS.find(aspect => aspect.id === id) ?? FREE_ASPECT;
}

export function fittedAspectRect(areaWidth: number, areaHeight: number, widthToHeight: number): FittedRect {
    if (!(areaWidth > 0) || !(areaHeight > 0) || !(widthToHeight > 0)) return EMPTY_FRAME;
    const width = wholePixels(Math.min(areaWidth, areaHeight * widthToHeight));
    const height = wholePixels(Math.min(areaHeight, width / widthToHeight));
    return {
        left: Math.floor((areaWidth - width) / CENTERING_DIVISOR),
        top: Math.floor((areaHeight - height) / CENTERING_DIVISOR),
        width,
        height,
    };
}
