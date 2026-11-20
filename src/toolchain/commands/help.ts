import {EXIT_SUCCESS} from "../cliArguments";
import type {CommandResult} from "./command";

export const USAGE = `jsengine <command> [options] (runs under bun)

  run       [--project <dir>] [--target web|window|terminal] [--backend cells|pixels|gpu]
            [--node] [--watch]                  terminal only
            [--no-build]                        web and window only
            [--smoke] [--screenshot <png>]      window only
  build     [--target web|window|terminal|editor] [--project <dir>]
            [--prod] [--with-editor]            web only
            [--report json]                     editor only
  package   --target window [--project <dir>] [--backend cells|pixels|gpu] [--no-build] [--no-zip]
  generate  [--project <dir>] [--check | --print]
  serve     [--prod] [--no-build] [--no-coi]    dev server (PORT moves it from 8080)
  edit      [--project <dir>] [--target web|window] [--backend pixels|gpu] [--no-build]
            [--smoke] [--screenshot <png>]      window only
  help

Defaults: --target web; --backend pixels on web and window, cells on the terminal, gpu in the editor.
--project defaults to the current folder, which must hold jsengine.project.json.`;

export async function helpCommand(): Promise<CommandResult> {
    console.log(USAGE);
    return EXIT_SUCCESS;
}
