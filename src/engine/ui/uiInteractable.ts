import {UiNodeComponent} from "./uiNodeComponent";

export class UiInteractable extends UiNodeComponent {
    public click = true;
    public press = false;
    public wheel = false;
    public drag = false;
    public disabled = false;
}
