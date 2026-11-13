import { ScriptcaRspackPlugin } from '@unikit-bridge/scriptca/webpack';

export default {
  source: {
    entry: { index: './src/rn-style-entry.ts' },
    // The linked @unikit-bridge/scriptca-client package ships plain .ts — include it
    // for the SWC transform.
    include: [/[\\/]scriptca[\\/]generated[\\/]/],
  },
  tools: {
    rspack: {
      plugins: [new ScriptcaRspackPlugin()],
    },
  },
};
