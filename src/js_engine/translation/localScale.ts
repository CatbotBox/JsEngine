// import {Component} from "../core";
//
// export class LocalScale extends Component {
//     private _values = new Float32Array(3);
//     // [x, y, z]
//
//     constructor(x: number = 0, y: number = 0, z: number = 0) {
//         super();
//         this.x = x;
//         this.y = y;
//         this.z = z;
//     }
//
//     get x(): number {
//         return this._values[0];
//     }
//     set x(value: number) {
//         this._values[0] = value;
//     }
//
//     get y(): number {
//         return this._values[1];
//     }
//     set y(value: number) {
//         this._values[1] = value;
//     }
//
//     get z(): number {
//         return this._values[2];
//     }
//     set z(value: number) {
//         this._values[2] = value;
//     }
// }
import {Component} from "../core";

export class LocalScale extends Component {
    public x: number = 1;
    public y: number = 1;
    public z: number = 1;
}

