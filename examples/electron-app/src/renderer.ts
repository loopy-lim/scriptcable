/**
 * Renderer source: imports the core entry directly — the TS source, not
 * `@scriptcable/client`. With the scriptcable vite plugin registered, this
 * import is redirected onto the compiled browser drop-in (WASM) at bundle
 * time; the code below never changes.
 */
import { add, greet } from '../../calculator-core/src/core';

const el = document.getElementById('out')!;
const hi = greet('electron');
const sum = add(20, 22);
el.textContent = `add(20, 22) = ${sum} · greet = ${hi}`;

// The main process polls this after did-finish-load (the drop-in's
// top-level await init finishes shortly after the module executes).
(window as { __scriptcableResult?: number }).__scriptcableResult = sum;
