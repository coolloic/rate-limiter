import express from 'express';
import { afterEach, describe, expect, it } from 'vitest';

import { closeServers, listen } from './testServer';

afterEach(closeServers);

describe('listen', () => {
  // Bound to the wildcard (::), the OS may pick a port that another program (e.g. an IDE's local server) holds on
  // 127.0.0.1; the test's 127.0.0.1 requests would then reach that program. Binding 127.0.0.1 rules this out.
  it('binds 127.0.0.1, the address its URL points at', async () => {
    const app = express();
    app.get('/', (req, res) => {
      res.send(req.socket.localAddress ?? '');
    });

    const baseUrl = await listen(app);

    expect(baseUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    // A wildcard (::) server reports an IPv4-mapped address ("::ffff:127.0.0.1") for the same connection.
    expect(await (await fetch(baseUrl)).text()).toBe('127.0.0.1');
  });
});
