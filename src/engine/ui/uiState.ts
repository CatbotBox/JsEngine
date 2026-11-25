import {Component} from "../core";

export const NO_UI_STATE = 0;
export const UI_STATE_HOVERED = 1;
export const UI_STATE_PRESSED = 2;
export const UI_STATE_DISABLED = 4;
export const UI_POINTER_STATE_BITS = 7;

export class UiState extends Component {
    public bits = NO_UI_STATE;

    public get hovered(): boolean {
        return (this.bits & UI_STATE_HOVERED) !== NO_UI_STATE;
    }

    public get pressed(): boolean {
        return (this.bits & UI_STATE_PRESSED) !== NO_UI_STATE;
    }

    public get disabled(): boolean {
        return (this.bits & UI_STATE_DISABLED) !== NO_UI_STATE;
    }
}
