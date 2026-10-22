<script lang="ts">
  import { onMount } from 'svelte';

  // Plain entry import — the vite plugin redirects it onto the compiled
  // browser drop-in (WASM) at bundle time. Dynamic import inside onMount
  // keeps the call browser-only.
  let result = $state('loading…');

  onMount(async () => {
    const { add, greet } = await import('../../../calculator-core/src/core');
    result = `add(20, 22) = ${add(20, 22)} · greet = ${greet('sveltekit')}`;
  });
</script>

<h1>scriptcable sveltekit</h1>
<div id="out">{result}</div>
