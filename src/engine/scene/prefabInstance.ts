import {Component} from "../core";

export class PrefabInstance extends Component {
    public constructor(public sourcePath: string = "", public overrides: string[] = []) {
        super();
    }
}
