import {Component} from "../../core";

const START_FRACTION = 0;
const CENTER_FRACTION = 0.5;
const END_FRACTION = 1;

export type AnchorPosition = `${'top' | 'middle' | 'bottom'}-${'left' | 'center' | 'right'}`;

export class ConsoleImageAnchor extends Component {
    public anchorPosition: AnchorPosition = 'middle-center';
}

export function anchorFractionX(position: AnchorPosition): number {
    return position.endsWith('left') ? START_FRACTION : position.endsWith('center') ? CENTER_FRACTION : END_FRACTION;
}

export function anchorFractionY(position: AnchorPosition): number {
    return position.startsWith('top') ? START_FRACTION : position.startsWith('middle') ? CENTER_FRACTION : END_FRACTION;
}
