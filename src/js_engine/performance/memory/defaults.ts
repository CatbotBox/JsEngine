import {Memory} from "./memory";
import {DoubleStack} from "./doubleStack";
import {Heap} from "./heap";
import {registerDefaultPointerHandlers} from "./types/pointerRegistry";

//todo read from config file or smt
const mem = new Memory(8 << 20, {maxByteLength: 64 << 20});

const doubleStack = new DoubleStack(mem, 2 << 20);
export const heap = new Heap(mem, 4 << 20, {growable: true});
export const stack = doubleStack.front();
export const stackEnd = doubleStack.back();
export const pointerKinds = mem.pointerKinds;
registerDefaultPointerHandlers(mem);




