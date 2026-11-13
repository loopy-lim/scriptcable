/**
 * Drop-in demo module: imports the core entry directly — the TS source, not
 * `@unikit-bridge/scriptca-client`. With the scriptca vite plugin registered, this
 * import is redirected onto the compiled drop-in client at bundle time; the
 * code below never changes.
 */
import { add, mul } from '../../calculator-core/src/core';

export const dropinAnswers = { add: add(20, 22), mul: mul(6, 7) };
