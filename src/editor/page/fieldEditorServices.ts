import type {EditorWorkspace} from "./editorWorkspace";
import type {FieldEditorServices} from "./fieldEditorBase";
import type {RotationEulerCache} from "./rotationEulerCache";

const ALWAYS_EDITABLE = (): boolean => false;

export function workspaceFieldServices(workspace: EditorWorkspace, rotations: RotationEulerCache, isReadOnly: () => boolean = ALWAYS_EDITABLE): FieldEditorServices {
    return {
        rotations,
        entityChoices: () => workspace.entities,
        endGesture: coalesceKey => workspace.endGesture(coalesceKey),
        reportInvalid: message => workspace.notice("warn", message),
        draggedAsset: () => workspace.drag?.kind === "asset" ? workspace.drag : undefined,
        draggedEntities: () => workspace.drag?.kind === "entities" ? workspace.drag.entities : undefined,
        pickEntity: () => workspace.pickEntity(),
        assetFileSuffixes: assetType => workspace.assetTypes.get(assetType)?.fileSuffixes,
        assetChoices: assetType => workspace.assetChoices(assetType),
        isDataAssetType: assetType => workspace.assetTypes.get(assetType)?.dataAsset === true,
        openDataAsset: path => workspace.openDataAsset(path),
        createDataAsset: assetType => workspace.askAndCreateDataAsset(assetType),
        isReadOnly,
    };
}
