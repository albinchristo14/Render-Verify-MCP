import http from 'node:http';
import { fileURLToPath } from 'node:url';
import type { AddressInfo } from 'node:net';

export async function startFixtureServer() {
  const hits: string[] = [];
  const sockets = new Set<import('node:net').Socket>();
  const server = http.createServer((req, res) => {
    const path = new URL(req.url ?? '/', 'http://fixture').pathname;
    hits.push(path);
    if (path === '/verification-broken') {
      res.setHeader('content-type', 'text/html');
      res.end(`<!doctype html><title>Verification broken fixture</title>
        <style>body{margin:0}.wide{width:1600px}</style><main class="wide"><h1>Broken verification</h1>
        <img src="/missing.png"><p id="api-complete" hidden>API complete</p></main>
        <script>console.error('verification console failure');
        fetch('/api-error').then(() => document.querySelector('#api-complete').hidden=false);
        throw new Error('verification uncaught failure');</script>`);
    } else if (path === '/login') {
      res.setHeader('content-type', 'text/html');
      res.end(`<!doctype html><title>Fixture login</title>
        <main><h1>Sign in</h1><nav aria-label="Fixture navigation"><a href="/clean">Clean page</a></nav>
        <form id="login-form" aria-label="Sign in form">
          <label for="email">Email</label><input id="email" type="email" autocomplete="username">
          <label for="password">Password</label><input id="password" type="password" autocomplete="current-password">
          <button id="submit" type="submit">Sign in</button>
        </form><p id="login-status" role="status" hidden></p></main>
        <script>
          document.querySelector('form').addEventListener('submit', async (event) => {
            event.preventDefault();
            console.error('fixture submit console error');
            setTimeout(() => { throw new Error('fixture submit page error'); }, 0);
            const response = await fetch('/api/login', {method:'POST'});
            const status = document.querySelector('#login-status');
            status.textContent = 'Login failed: HTTP ' + response.status;
            status.hidden = false;
          });
        </script>`);
    } else if (path === '/api/login') {
      res.writeHead(500, { 'content-type': 'application/json' });
      res.end('{"error":"intentional fixture login failure"}');
    } else if (path === '/interactions') {
      res.setHeader('content-type', 'text/html');
      res.end(`<!doctype html><title>Interaction fixture</title><h1>Interactions</h1>
        <input id="entry" aria-label="Entry"><button id="navigate" onclick="location.href='/clean'">Go to clean page</button>
        <button id="flood" onclick="for(let i=0;i<510;i++)console.error('flood '+i);document.querySelector('#done').hidden=false">Emit errors</button>
        <p id="done" hidden>Done</p><p id="entered" hidden>Entered</p><p id="resized" hidden>Resized</p>
        <script>
          document.querySelector('#entry').addEventListener('keydown', event => { if(event.key==='Enter') document.querySelector('#entered').hidden=false; });
          window.addEventListener('resize', () => { console.warn('fixture resize warning'); document.querySelector('#resized').hidden=false; });
        </script>`);
    } else if (path === '/broken') {
      res.setHeader('content-type', 'text/html');
      res.end(`<!doctype html><title>Broken fixture</title><h1>Broken fixture</h1>
        <img src="/missing.png"><script>
          console.error('fixture console failure');
          console.warn('fixture warning');
          throw new Error('fixture uncaught failure');
        </script>`);
    } else if (path === '/clean') {
      res.setHeader('content-type', 'text/html');
      res.end(
        '<!doctype html><title>Clean fixture</title><h1>Clean fixture</h1>',
      );
    } else if (path === '/cookie') {
      res.setHeader('content-type', 'text/html');
      res.end(
        '<!doctype html><script>document.cookie="fixture=isolated; path=/";</script>',
      );
    } else if (path === '/redirect-private') {
      res.writeHead(302, {
        location: `http://localhost:${(server.address() as AddressInfo).port}/secret`,
      });
      res.end();
    } else if (path === '/slow') {
      // Hold response until the client timeout closes the connection.
    } else if (path === '/reset') {
      req.socket.destroy();
    } else if (path === '/missing.png') {
      res.writeHead(404);
      res.end('Deliberately missing fixture image');
    } else if (path === '/api-error') {
      res.setHeader('access-control-allow-origin', '*');
      res.writeHead(500);
      res.end('Deliberate API failure');
    } else {
      res.writeHead(404);
      res.end('Not found');
    }
  });
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    baseUrl,
    hits,
    close: async () => {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const fixture = await startFixtureServer();
  console.log(`Fixture server: ${fixture.baseUrl}`);
  process.once('SIGINT', () => {
    void fixture.close();
  });
  process.once('SIGTERM', () => {
    void fixture.close();
  });
}
