import {Component, Resource} from "../core";
import type {SceneDocument, SceneEntityRecord, SceneFieldValues} from "./sceneDocument";

export const SCENE_INSTANCE_COMPONENT_NAME = "SceneInstance";
export const ACTIVE_SCENE_RESOURCE_NAME = "ActiveScene";
export const NO_SCENE_ID = 0;

export class SceneInstance extends Component {
    public constructor(public sceneId: number = NO_SCENE_ID, public path: string | undefined = undefined) {
        super();
    }
}

export class ActiveScene extends Resource {
    public sceneId: number = NO_SCENE_ID;
    public path: string | undefined = undefined;
}

type ResourceValues = {[resourceName: string]: SceneFieldValues};

function withoutSceneInstance(record: SceneEntityRecord): SceneEntityRecord {
    if (record.components[SCENE_INSTANCE_COMPONENT_NAME] === undefined) return record;
    const components = {...record.components};
    delete components[SCENE_INSTANCE_COMPONENT_NAME];
    return {...record, components};
}

function withoutActiveScene(resources: ResourceValues): ResourceValues | undefined {
    const kept = {...resources};
    delete kept[ACTIVE_SCENE_RESOURCE_NAME];
    return Object.keys(kept).length === 0 ? undefined : kept;
}

export function withoutSceneMembership(document: SceneDocument): SceneDocument {
    const stripped: SceneDocument = {...document, entities: document.entities.map(withoutSceneInstance)};
    if (document.resources?.[ACTIVE_SCENE_RESOURCE_NAME] === undefined) return stripped;
    const resources = withoutActiveScene(document.resources);
    if (resources === undefined) delete stripped.resources;
    else stripped.resources = resources;
    return stripped;
}
