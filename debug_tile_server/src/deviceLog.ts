// Receives log lines from skills/navara-mobile-device-debug/probe.html on a device
// and appends them to a file.
// Usage: pnpm run device-log <port> <log file>
import { appendFileSync } from 'node:fs';

import { serve } from '@hono/node-server'
import { getConnInfo } from '@hono/node-server/conninfo';
import { Hono } from 'hono'

const [port, logFile] = process.argv.slice(2);
if (!port || !logFile) throw new Error('usage: device-log <port> <log file>');

// One request is one line (stack traces carry newlines), so every line keeps
// its run id.
const oneLine = (s = '') => s.replace(/[\u0000-\u001f\u007f]/g, ' ');

const app = new Hono();

app.get('/log', (c) => {
  const time = new Date().toTimeString().slice(0, 8);
  const ip = getConnInfo(c).remote.address;
  const { run, page, msg } = c.req.query();
  appendFileSync(logFile, `${time} ${ip} run=${oneLine(run)} page=${oneLine(page)} ${oneLine(msg)}\n`);
  return c.body(null, 204);
});

// The device reaches this over the LAN, so listen on every interface.
serve({ fetch: app.fetch, port: Number(port), hostname: '0.0.0.0' });
console.log(`Device log server on port ${port}, writing to ${logFile}`);
