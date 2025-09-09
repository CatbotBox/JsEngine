import {Component} from "../../core";

export class Bounds2d extends Component {
    public xMin: number = 0;
    public yMin: number = 0;
    public xMax: number = 0;
    public yMax: number = 0;

    public intersects(other: Bounds2d): boolean {
        return !(
            other.xMin > this.xMax || other.xMax < this.xMin ||
            other.yMin > this.yMax || other.yMax < this.yMin
        );
    }
}