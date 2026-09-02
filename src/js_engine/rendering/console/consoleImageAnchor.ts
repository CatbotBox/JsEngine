import {Component} from "../../core";

export type AnchorPosition = `${'top' | 'middle' | 'bottom'}-${'left' | 'center' | 'right'}`;

export class ConsoleImageAnchor extends Component {
    public anchorPosition: AnchorPosition = 'middle-center';
}

/**
 * Horizontal anchor fraction: 0 = left, 0.5 = center, 1 = right.
 *
 * endsWith/startsWith rather than `split('-')`, deliberately. Both render passes call these
 * per anchored entity per frame, and the split version allocated a two-element array and
 * destructured it through the iterator protocol just to arrive at two constants.
 */
export function anchorFractionX(position: AnchorPosition): number {
    return position.endsWith('left') ? 0 : position.endsWith('center') ? 0.5 : 1;
}

/** Vertical anchor fraction: 0 = top, 0.5 = middle, 1 = bottom. See {@link anchorFractionX}. */
export function anchorFractionY(position: AnchorPosition): number {
    return position.startsWith('top') ? 0 : position.startsWith('middle') ? 0.5 : 1;
}
