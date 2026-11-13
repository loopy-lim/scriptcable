import { ScriptcableRspackPlugin } from '@unikit-bridge/scriptcable/webpack';

export default {
  source: {
    entry: { index: './src/rn-style-entry.ts' },
    // The linked @unikit-bridge/scriptcable-client package ships plain .ts — include it
    // for the SWC transform.
    include: [/[\\/]scriptcable[\\/]generated[\\/]/],
  },
  tools: {
    rspack: {
      plugins: [new ScriptcableRspackPlugin()],
    },
  },
};
