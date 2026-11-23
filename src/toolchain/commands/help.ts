import {EXIT_SUCCESS} from "../cliArguments";
import type {CommandResult} from "./command";

export const USAGE = `jsengine <command> [options] (runs under bun)

  run       [--project <dir>] [--target web|window|terminal] [--backend cells|pixels|gpu]
            [--node] [--watch]                  terminal only
            [--no-build]                        web and window only
            [--smoke] [--screenshot <png>]      window only
  build     [--target web|window|terminal|editor] [--project <dir>]
            fails when a bundle uses a feature its target lacks; the terminal is checked, not written
            web and window write the project to dist/web/<folder name>/, its page from <dir>/web/index.html
            or made from the manifest; without --project, every sample project and the landing page
            [--prod] [--with-editor]            web only
            [--simulate web|window|terminal] [--backend cells|pixels|gpu]
                                                editor only: the editor worker with that target's features and backend
            [--report json]                     the result as JSON on the last line
  build     --report bundles [--update-baseline]  every sample project bundle against tests/bundles.baseline.txt and its target's features
  package   --target window [--project <dir>] [--backend cells|pixels|gpu] [--no-build] [--no-zip]
            a desktop app of that project alone, named after the manifest's "name"
  generate  [--project <dir>] [--check | --print | --report json]
  serve     [--prod] [--no-build] [--no-coi]    dev server for the sample projects (PORT moves it from 8080)
  edit      [--project <dir>] [--target web|window] [--backend cells|pixels|gpu] [--no-build]
            [--smoke] [--screenshot <png>]      window only
            [--flows <name,...>|none]           window --smoke only: which editor UI flows drive the page (default all)
  help

Defaults: --target web; --backend from the manifest's "targets", else pixels on web and window, cells on the terminal; --simulate web.
edit opens the project's remembered target (right-click the Game tab), else WebGPU when usable; --backend overrides it.
--project defaults to the current folder, which must hold jsengine.project.json; build --target web|window
without it builds the sample projects instead.`;

export async function helpCommand(): Promise<CommandResult> {
    console.log(USAGE);
    return EXIT_SUCCESS;
}
