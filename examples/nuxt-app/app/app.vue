<script setup lang="ts">
// Client-only graph (ssr: false) — this plain core import is what the vite
// plugin redirects onto the compiled browser drop-in at bundle time.
import { add, greet } from '../../calculator-core/src/core';

const sum = add(20, 22);
const message = `add(20, 22) = ${sum} · greet = ${greet('nuxt')}`;
</script>

<template>
  <main>
    <h1>scriptcable nuxt</h1>
    <p>{{ message }}</p>
  </main>
</template>
