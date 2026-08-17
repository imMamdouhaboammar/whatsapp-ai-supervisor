import { createServer } from 'vite';

const vite = await createServer({
  configFile: false,
  root: new URL('../..', import.meta.url).pathname,
  appType: 'custom',
  server: { middlewareMode: true }
});

try {
  const { runRealtimeTests } = await vite.ssrLoadModule('/tests/use-realtime-ui.test.ts');
  await runRealtimeTests();
  console.log('ui realtime tests passed');
} finally {
  await vite.close();
}
