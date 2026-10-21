// Server graph: same entry import — with the plugin registered it must land
// on the generated node drop-in (`createClientSync()`, await-free), not the
// TypeScript source. Real runtime check: `next start` + curl this route.
import { add, greet } from '../../../../calculator-core/src/core';

// Node drop-in initializes synchronously at module scope.
const sum = add(20, 22);

export async function GET() {
  return Response.json({ sum, hi: greet('next-server') });
}
