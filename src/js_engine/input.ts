import * as readline from 'node:readline';
import {Event, EventListener} from "./util/event";


export type KeyPress = {
  sequence: string;
  name?: string;
  ctrl: boolean;
  meta: boolean;
  shift: boolean;
};

const keypressEvent = new Event<KeyPress>();

function enable() {
  readline.emitKeypressEvents(process.stdin);
  if (!process.stdin.isTTY) {
    console.error('This script needs a TTY (run it directly in cmd/PowerShell/Terminal).');
    process.exit(1);
  }
  process.stdin.setRawMode(true);
  process.stdin.resume();

  process.stdin.on('keypress', (_str: string, key: KeyPress) => {
    // Arrow keys -> key.name: 'up' | 'down' | 'left' | 'right'
    // Letters -> key.name: 'a'...'z'
    // Ctrl+C -> key.ctrl && key.name === 'c'
    keypressEvent.invoke(key);
  });
  console.info("toggled on input");
}

function disable() {
  console.info("toggled off input");
  process.stdin.setRawMode?.(false);
  process.stdin.pause();
}


enable();

export const keyboardInput = {
  any(cb: EventListener<KeyPress>) {
    keypressEvent.add(cb);
  },
  when(keyPress: Partial<KeyPress>, cb: EventListener<KeyPress>) {
    keypressEvent.add((keypress) => {
      for (const k in keyPress) {
        if ((keyPress as any)[k] !== (keypress as any)[k]) return;
      }
      cb(keypress);
    });
  },
  enable,
  disable
}

