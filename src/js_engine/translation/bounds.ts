import {Component} from "../core";

export class Bounds extends Component {
    public xMin: number = 0;
    public yMin: number = 0;

    public xMax: number = 0;
    public yMax: number = 0;

    public zMin: number = 0;
    public zMax: number = 0;

    public intersects(other: Bounds): boolean {
        return !(
            other.xMin > this.xMax || other.xMax < this.xMin ||
            other.yMin > this.yMax || other.yMax < this.yMin ||
            other.zMin < this.zMin || other.zMax < this.zMin
        );
    }
}