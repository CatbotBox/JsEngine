// fileLogger is opt-in and node-only, so it stays out of this barrel: import it from
// './fileLogger' and register it with consoleOverride.addConsoleEventListener.
export {consoleOverride} from './consoleOverride';