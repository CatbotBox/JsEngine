import {Component} from "../../../core";
import {Size2d} from "../size2d";
import {Ansi} from "./ansi";

export class ConsoleImageAnchor extends Component {
    public anchorPosition: `${'top' | 'middle' | 'bottom'}-${'left' | 'center' | 'right'}` = 'top-left';
}

export class ConsoleImageOffset extends Component {
    public x: number = 0;
    public y: number = 0;
}

export class ConsoleImage extends Component {
    public image: string[] = []

    public get size(): Size2d {
        const size = new Size2d();
        size.x = Math.max(...this.image.map(i => Ansi.strip(i).length));
        size.y = this.image.length;
        return size;
    }
}