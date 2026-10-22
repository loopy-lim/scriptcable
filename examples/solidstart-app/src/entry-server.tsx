import { createHandler, StartServer } from '@solidjs/start/server';

// Present for completeness — SPA mode (ssr: false) renders the shell from
// the client graph, but the start plugin still resolves this module.
export default createHandler(() => (
  <StartServer
    document={({ assets, children, scripts }) => (
      <html lang="en">
        <head>
          <meta charset="utf-8" />
          {assets}
        </head>
        <body>
          <div id="app">{children}</div>
          {scripts}
        </body>
      </html>
    )}
  />
));
