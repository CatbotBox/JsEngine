import {Component, Entity} from "../core";

export class Parent extends Component {
    public constructor(public entity: Entity) {
        super();
    }
}