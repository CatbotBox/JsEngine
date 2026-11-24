import {createInterface} from "readline";
import {TOOLCHAIN_SERVER_COMMAND} from "../../editor/desktop/toolchainServerProtocol";
import {EXIT_SUCCESS, parseOptions} from "../cliArguments";
import {answerRequests, ToolchainServer} from "../serve/toolchainServer";
import {WarmToolchain} from "../serve/warmToolchain";
import type {CommandResult} from "./command";

const OPTIONS = {} as const;

export async function toolchainServerCommand(args: readonly string[]): Promise<CommandResult> {
    parseOptions(TOOLCHAIN_SERVER_COMMAND, args, OPTIONS);
    const requests = createInterface({input: process.stdin});
    await answerRequests(requests, new ToolchainServer(new WarmToolchain()), reply => process.stdout.write(reply));
    return EXIT_SUCCESS;
}
