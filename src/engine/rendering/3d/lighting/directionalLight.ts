import {Light} from "./light";

export class DirectionalLight extends Light {
    public constructor(color?: number, intensity?: number) {
        super(color, intensity);
    }
}
