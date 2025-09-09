import {Component} from "../../core";

export class Position2d extends Component {
    public x: number;
    public y: number = 0;

    public constructor(x: number = 0, y: number = 0) {
        super();
        this.x = x;
        this.y = y;
    }

}