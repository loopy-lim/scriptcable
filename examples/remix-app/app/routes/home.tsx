// Client graph (ssr: false) — this plain core import is what the vite plugin
// redirects onto the compiled browser drop-in at bundle time.
import { add, greet } from '../../../calculator-core/src/core';

export default function Home() {
  const sum = add(20, 22);
  return (
    <main>
      <h1>scriptcable react-router</h1>
      <p>
        add(20, 22) = {sum} · greet = {greet('router')}
      </p>
    </main>
  );
}
