# @scriptca/next

```js
// next.config.mjs
import { withScriptca } from '@scriptca/next';
export default withScriptca({ /* next options */ });
```

Turbopack (`next dev --turbo`) — add a prebuild script:

```json
{ "scripts": { "predev": "node -e \"import('@scriptca/next').then(m => m.scriptcaBuild())\"", "dev": "next dev --turbo" } }
```
