import type { Server } from 'node:http';

import type { Express } from 'express';

const running = new Set<Server>();

/**
 * Test helper: starts `app` on an ephemeral port on 127.0.0.1 and returns its base URL. Close with `closeServers()`.
 * It binds 127.0.0.1, not the wildcard, so the OS can't pick a port another program holds there.
 */
export async function listen(app: Express): Promise<string> {
  const server = app.listen(0, '127.0.0.1');
  running.add(server);
  await new Promise<void>((resolve, reject) => {
    server.once('listening', resolve).once('error', reject);
  });
  const address = server.address();
  // A TCP server's address is an object; it is a string only for pipes/sockets.
  if (address === null || typeof address === 'string') throw new Error('Expected a TCP address');
  return `http://127.0.0.1:${String(address.port)}`;
}

/** Test helper: closes every server started by `listen()`; call it in `afterEach`. */
export async function closeServers(): Promise<void> {
  const servers = [...running];
  running.clear();
  await Promise.all(
    servers.map(
      (server) =>
        new Promise<void>((resolve, reject) => {
          server.close((error) => {
            if (error === undefined) resolve();
            else reject(error);
          });
          // fetch keeps connections alive; drop them so `close` doesn't wait for the idle timeout.
          server.closeAllConnections();
        }),
    ),
  );
}
