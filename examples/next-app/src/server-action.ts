/** Simulates a Next.js server action / route handler calling the native core */
import { createClient } from '@scriptcable/client';

const client = await createClient();
console.log(JSON.stringify({
  sum: client.add(20, 22),
  hi: client.greet('next-server'),
}));
client.dispose();
