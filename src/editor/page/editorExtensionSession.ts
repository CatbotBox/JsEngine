import {EDITOR_EXTENSIONS_EXPORT} from "../project/editorExtensions";
import type {EditorExtensions, FieldDrawerFactory as ExtensionFieldDrawerFactory} from "../project/editorExtensions";
import {fieldDrawers} from "./fieldDrawers";
import type {FieldDrawerFactory, FieldDrawerRegistry, UnregisterFieldDrawer} from "./fieldDrawers";

type ExtensionsRegistration = (editor: EditorExtensions) => void | Promise<void>;

function adaptedDrawer(factory: ExtensionFieldDrawerFactory): FieldDrawerFactory {
    return (document, context) => {
        const drawer = factory(document, context);
        return {
            element: drawer.element,
            show: values => drawer.show(values),
            showEntityChoices: () => drawer.showEntityChoices?.(),
        };
    };
}

function registrationOf(module: unknown): ExtensionsRegistration {
    const registration = typeof module === "object" && module !== null ? (module as Record<string, unknown>)[EDITOR_EXTENSIONS_EXPORT] : undefined;
    if (typeof registration !== "function") throw new Error(`the editor extensions module does not export a ${EDITOR_EXTENSIONS_EXPORT}(editor) function`);
    return registration as ExtensionsRegistration;
}

export class EditorExtensionSession {
    public readonly extensions: EditorExtensions;
    private readonly unregisters: UnregisterFieldDrawer[] = [];

    public constructor(private readonly drawers: FieldDrawerRegistry = fieldDrawers) {
        this.extensions = {
            registerFieldDrawer: (typeName, factory) => {
                this.unregisters.push(this.drawers.register(typeName, adaptedDrawer(factory)));
            },
        };
    }

    public get drawerCount(): number {
        return this.unregisters.length;
    }

    public dispose(): void {
        for (const unregister of this.unregisters.splice(0)) unregister();
    }
}

export async function registerEditorExtensionsOf(module: unknown, drawers: FieldDrawerRegistry = fieldDrawers): Promise<EditorExtensionSession> {
    const registration = registrationOf(module);
    const session = new EditorExtensionSession(drawers);
    try {
        await registration(session.extensions);
    } catch (error) {
        session.dispose();
        throw error;
    }
    return session;
}
