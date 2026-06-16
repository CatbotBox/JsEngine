import {System} from "../../core";
import {Camera} from "../camera";
import {RenderingSystemGroup} from "../renderingSystemGroup";
import {CurrentInterpreter} from "../../interpreter";
import {ConsoleCellRatio} from "../consoleCellRatio";

export class ConsoleCellSizingSystem extends System {
    private _cameraQuery = this.createEntityQuery([Camera, ConsoleCellRatio])
    private _initialized: boolean = false;

    override systemGroup() {
        return RenderingSystemGroup;
    }

    protected onCreate() {
        this.requireAnyForUpdate(this._cameraQuery)
    }

    onUpdate() {
        if (CurrentInterpreter == "Bun" || CurrentInterpreter == "Unknown") {
            this.refreshSize();
            return;
        }
        if (!this._initialized) {
            this.refreshSize();
            this._initialized = true;
        }
    }

    onEnable(): void {
        //reset initialized status
        this._initialized = false;
    }

    public refreshSize() {
        const cameraEntity = this._cameraQuery.getSingleton({consoleSizeRatio: ConsoleCellRatio})
        process.stdin.setRawMode(true);
        process.stdin.resume();
        process.stdout.write('\x1b[14t');

        process.stdin.once('data', (chunk: Uint8Array) => {
            process.stdin.setRawMode(false);
            process.stdin.pause();

            const response = new TextDecoder().decode(chunk);
            const match = response.match(/\x1b\[4;(\d+);(\d+)t/);

            if (match) {
                const pixelHeight = parseInt(match[1], 10);
                const pixelWidth = parseInt(match[2], 10);

                // Derive your verified ratio constraints
                cameraEntity.consoleSizeRatio.value = 1 / pixelHeight * pixelWidth;
            } else {
                cameraEntity.consoleSizeRatio.value = 2;
            }
        });
    }
}