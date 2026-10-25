// utilityProcess entry point for the agent host.

import { createAgentHost, type ToHost } from './agentHostCore';

const port = process.parentPort;
const host = createAgentHost((m) => port.postMessage(m));
port.on('message', (e) => host.handle(e.data as ToHost));
process.on('exit', () => host.dispose());
