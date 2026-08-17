import { AgentBrowserRuntime } from './agent-browser-runtime.js';
import { RemoteBrowserRuntime } from './remote-browser-runtime.js';

export function createBrowserRuntime({
  mode = 'none',
  command = 'agent-browser',
  engine = 'chrome',
  workerUrl = null,
  workerToken = null,
  fetchImpl,
  execFileImpl
} = {}) {
  const normalized = String(mode).toLowerCase();
  if (normalized === 'none' || normalized === 'disabled') return null;
  if (normalized === 'agent-browser') return new AgentBrowserRuntime({ command, engine, execFileImpl });
  if (normalized === 'remote') return new RemoteBrowserRuntime({ baseUrl: workerUrl, token: workerToken, fetchImpl });
  throw new Error(`Unsupported browser runtime: ${mode}`);
}
