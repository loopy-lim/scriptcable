// Metro bundle entry: imports the core ENTRY like real app code would.
// With withScriptcableMetro registered, this import must resolve to the
// generated drop-in (dropin/react-native.ts) — not this TypeScript source.
import { add, greet } from '../../calculator-core/src/core';

console.log(JSON.stringify({ sum: add(20, 22), hi: greet('metro') }));
