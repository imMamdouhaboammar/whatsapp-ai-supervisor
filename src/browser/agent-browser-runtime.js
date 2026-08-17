import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { BrowserRuntime, validateBrowserTask } from './browser-runtime.js';

const execFileAsync = promisify(execFile);

function safeSessionId(value) {
  return `was-${createHash('sha256').update(String(value)).digest('hex').slice(0, 24)}`;
}

function parseOutput(stdout) {
  const text = String(stdout ?? '').trim();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { text };
  }
}

export class AgentBrowserRuntime extends BrowserRuntime {
  constructor({
    command = 'agent-browser',
    engine = 'chrome',
    maxOutput = 50_000,
    execFileImpl = execFileAsync
  } = {}) {
    super();
    if (!['chrome', 'lightpanda'].includes(engine)) throw new Error(`Unsupported agent-browser engine: ${engine}`);
    this.command = command;
    this.engine = engine;
    this.maxOutput = Number(maxOutput);
    this.execFileImpl = execFileImpl;
  }

  async probe() {
    try {
      const { stdout, stderr } = await this.execFileImpl(this.command, ['doctor', '--json', '--offline', '--quick'], {
        timeout: 15_000,
        windowsHide: true,
        shell: false,
        maxBuffer: 1_000_000
      });
      const parsed = parseOutput(stdout || stderr);
      return { available: true, backend: 'agent-browser', detail: parsed?.version ?? this.engine };
    } catch (error) {
      const detail = error?.code === 'ENOENT' ? 'command not found' : String(error?.message ?? error).slice(0, 300);
      return { available: false, backend: 'agent-browser', detail };
    }
  }

  async runTask(input) {
    const task = validateBrowserTask(input);
    const args = [
      '--json',
      '--content-boundaries',
      '--max-output', String(this.maxOutput),
      '--session', safeSessionId(task.sessionId),
      '--allowed-domains', task.allowedDomains.join(','),
      '--engine', this.engine,
      'chat', task.task
    ];

    try {
      const { stdout, stderr } = await this.execFileImpl(this.command, args, {
        timeout: task.timeoutMs,
        windowsHide: true,
        shell: false,
        maxBuffer: Math.max(this.maxOutput * 4, 1_000_000)
      });
      const output = parseOutput(stdout || stderr);
      const ok = output?.success === false ? false : true;
      if (!ok) throw new Error(`browser_task_failed: ${output?.error ?? 'agent-browser returned failure'}`);
      return { ok: true, backend: 'agent-browser', engine: this.engine, output: output?.data ?? output };
    } catch (error) {
      if (error?.killed || error?.signal === 'SIGTERM' || error?.code === 'ETIMEDOUT') {
        throw new Error('browser_task_timeout');
      }
      if (error?.code === 'ENOENT') throw new Error('browser_runtime_unavailable: agent-browser command not found');
      if (String(error?.message ?? '').startsWith('browser_task_failed:')) throw error;
      const detail = String(error?.stderr ?? error?.message ?? error).trim().slice(0, 500);
      throw new Error(`browser_task_failed: ${detail}`);
    }
  }
}
