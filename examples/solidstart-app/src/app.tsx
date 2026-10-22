import { Router } from '@solidjs/router';
import { FileRoutes } from '@solidjs/start/router';

// SolidStart 2's required app entry — file routes under src/routes.
export default function App() {
  return (
    <Router>
      <FileRoutes />
    </Router>
  );
}
