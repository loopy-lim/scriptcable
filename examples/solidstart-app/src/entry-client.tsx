import { mount, StartClient } from '@solidjs/start/client';

// SolidStart 2's client entry — mounts the router-rendered app.
mount(() => <StartClient />, document.getElementById('app')!);
