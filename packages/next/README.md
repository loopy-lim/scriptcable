# @scriptcable/next

```js
// next.config.mjs
import { withScriptcable } from '@scriptcable/next';
export default withScriptcable({ /* next options */ });
```

Turbopack (`next dev --turbo`) — add a prebuild script:

```json
{ "scripts": { "predev": "node -e \"import('@scriptcable/next').then(m => m.scriptcableBuild())\"", "dev": "next dev --turbo" } }
```
