import type { Config } from '@react-router/dev/config';

// SPA mode (ssr: false): the client graph is the one the drop-in serves.
export default {
  ssr: false,
} satisfies Config;
