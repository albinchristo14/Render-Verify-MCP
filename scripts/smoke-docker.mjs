import assert from 'node:assert/strict';
import process from 'node:process';
import { Buffer } from 'node:buffer';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const image = process.argv[2] ?? 'render-verify-mcp:phase3';
const client = new Client({ name: 'docker-browser-smoke', version: '1.0.0' });
const transport = new StdioClientTransport({
  command: 'docker',
  args: [
    'run',
    '--rm',
    '--init',
    '-i',
    '--network',
    'none',
    '--shm-size=1g',
    image,
  ],
  stderr: 'pipe',
  ...(process.env.DOCKER_CONFIG
    ? { env: { DOCKER_CONFIG: process.env.DOCKER_CONFIG } }
    : {}),
});
let diagnostic = '';
transport.stderr?.on('data', (chunk) => {
  diagnostic = (diagnostic + chunk.toString()).slice(-8192);
});
try {
  await client.connect(transport);
  const call = async (name, args) => {
    const result = await client.callTool({ name, arguments: args });
    assert.notEqual(result.isError, true, `Tool ${name} failed`);
    return result;
  };
  const hello = await call('hello_world', {});
  assert.equal(hello.structuredContent.phase, 'phase_3');
  const opened = await call('open_url', {
    html: '<h1>Container browser</h1><label for="entry">Entry</label><input id="entry"><button id="act" onclick="console.error(\'container action error\');document.querySelector(\'p\').hidden=false">Act</button><p hidden>Done</p>',
  });
  const session_id = opened.structuredContent.session_id;
  const snapshot = await call('get_page_snapshot', { session_id });
  assert.equal(
    snapshot.structuredContent.headings[0].name,
    'Container browser',
  );
  const cleanReport = await call('verify_page', { session_id });
  assert.equal(cleanReport.structuredContent.status, 'passed');
  assert.equal(cleanReport.structuredContent.score, 100);
  await call('type_text', {
    session_id,
    selector: '#entry',
    text: 'container test input',
  });
  const clicked = await call('click', {
    session_id,
    selector: '#act',
    wait_for: { selector: 'p' },
  });
  assert(
    clicked.structuredContent.new_errors.console.some(
      (entry) => entry.text === 'container action error',
    ),
  );
  const failedReport = await call('verify_page', { session_id });
  assert.equal(failedReport.structuredContent.status, 'failed');
  assert(
    failedReport.structuredContent.evidence.some(
      (entry) => entry.type === 'console',
    ),
  );
  await call('set_viewport', { session_id, width: 360, height: 800 });
  const shot = await call('screenshot', { session_id });
  const bytes = Buffer.from(shot.content[0].data, 'base64');
  assert.deepEqual(
    bytes.subarray(0, 8),
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  );
  assert.equal(bytes.readUInt32BE(16), 360);
  await call('close_session', { session_id });
  process.stdout.write(
    'Docker MCP initialization, Chromium rendering, interactions, snapshot, verification, screenshot, and cleanup passed.\n',
  );
} catch (error) {
  if (diagnostic) process.stderr.write(diagnostic);
  throw error;
} finally {
  await client.close();
}
