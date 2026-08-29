import { ActionGateway } from './action-gateway.js';
import { ToolRegistry } from './tool-registry.js';

const BROWSER_TOOL_ID = 'browser.run';

/** Build the explicit tool allowlist available to production policy rules. */
export function createProductionToolRegistry({ browserRuntime = null } = {}) {
  const tools = [];

  if (browserRuntime) {
    tools.push({
      id: BROWSER_TOOL_ID,
      type: 'browser',
      risk: 'medium',
      description: 'Run a policy-approved browser task within explicit domain and time bounds',
      timeoutMs: 180_000,
      async execute(context, signal) {
        const parameters = context.parameters ?? {};
        return browserRuntime.runTask({
          task: String(parameters.task ?? ''),
          sessionId: `${context.tenantId}:${context.customerId}`,
          allowedDomains: parameters.allowedDomains,
          timeoutMs: parameters.timeoutMs ?? 60_000
        }, { signal });
      }
    });
  }

  return new ToolRegistry({ tools });
}

/** Create the production action gateway with both legacy browser and registered-tool paths. */
export function createProductionActionGateway({ browserRuntime = null } = {}) {
  const toolRegistry = createProductionToolRegistry({ browserRuntime });
  return new ActionGateway({ browserRuntime, toolRegistry });
}
