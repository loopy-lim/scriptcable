'use client';

// Client graph: this import resolves to the core ENTRY — with the plugin
// registered it must land on the generated browser drop-in (WASM, TLA init),
// not the TypeScript source. dropin-smoke asserts exactly that in the build.
import { add, greet } from '../../calculator-core/src/core';

import { useEffect, useState } from 'react';

export default function Home() {
  const [result, setResult] = useState<string>('loading…');

  useEffect(() => {
    setResult(`${add(20, 22)} / ${greet('next-client')}`);
  }, []);

  return <main>client: {result}</main>;
}
