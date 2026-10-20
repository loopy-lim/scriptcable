# @scriptcable/next

```js
// next.config.mjs
import { withScriptca } from '@scriptcable/next';
export default withScriptca({ /* next options */ });
```

Turbopack (`next dev --turbo`) — add a prebuild script:

```json
{ "scripts": { "predev": "node -e \"import('@scriptcable/next').then(m => m.scriptcableBuild())\"", "dev": "next dev --turbo" } }
```
