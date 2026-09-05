import {Light} from "./light";

export class AmbientLight extends Light {
    public constructor(color?: number, intensity: number = 0.2) {
        super(color, intensity);
    }
}
