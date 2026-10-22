// Client-only build — the page runs only in the browser, so the client
// graph is the one the drop-in must serve (no SSR graph consuming the core).
export const ssr = false;
export const prerender = true;
