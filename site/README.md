# scriptcable intro site

React + Tailwind CSS v4 + [@unikit-bridge/ui](https://github.com/loopy-lim/UniKit) + Vite — and the page dogfoods the product: `src/core.ts` is compiled to WebAssembly by `scriptcable build --target wasm --hosts browser`, and the vite plugin redirects every `../core` import onto the compiled client (the drop-in).

## Commands

```bash
bun install                 # from the repo root
bun run --filter @scriptcable/site dev      # dev server (builds the core first)
bun run --filter @scriptcable/site verify   # build + drop-in assertions (the gate)
bun run --filter @scriptcable/site typecheck
```

`verify` asserts the real `vite build` output: the drop-in client is in the bundle, the TS entry source is not, and the `.wasm` asset ships.

## Deploy

- `.github/workflows/site.yml` builds and deploys to **Cloudflare Pages** on pushes to `main` touching `site/**`.
- Requires repo secrets `CLOUDFLARE_API_TOKEN` (Pages: Edit) and `CLOUDFLARE_ACCOUNT_ID`.
- Custom domain `scriptca.ll3.kr` is bound in the Pages dashboard.

## Structure

- `src/core.ts` — the dogfooded core (add / fib / repeat / sumBytes / greet)
- `src/i18n.tsx` — EN/KO dictionaries (single source of all copy) + language provider
- `src/components/` — Hero, LiveDemo (shell + error boundary), LiveDemoPanels (React.lazy chunk that imports the compiled core), HostMatrix, Benchmarks, BeforeAfter, LinuxVerified, Footer
- `src/styles.css` — Tailwind v4 + UniKit zinc tokens + Geist fonts
- `wrangler.toml` — Pages project config (`dist`)

Note: `react-hook-form` looks unused in site source — it satisfies `@unikit-bridge/ui`'s barrel, which statically imports `form.tsx` (TS-source distribution), so `tsc --noEmit` fails without it even though the web runtime never touches it.
