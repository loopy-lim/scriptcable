import { ScriptcableRspackPlugin } from '@scriptcable/webpack';

export default {
  source: {
    entry: { index: './src/rn-style-entry.ts' },
    // The linked @scriptcable/client package ships plain .ts — include it
    // for the SWC transform.
    include: [/[\\/]scriptcable[\\/]generated[\\/]/],
  },
  tools: {
    rspack: {
      plugins: [new ScriptcableRspackPlugin()],
    },
  },
};
