/**
 * Minimal forwarding HTTP proxy (plain HTTP + CONNECT tunnelling) with optional
 * Basic authentication. Used by tests and for trying proxy profiles locally.
 * Not intended for production use.
 */
import http from "node:http";
import net from "node:net";

export interface TestProxyOptions {
  port?: number;
  host?: string;
  auth?: { username: string; password: string };
}

export function createTestProxy(opts: TestProxyOptions = {}) {
  let requests = 0;
  const expected = opts.auth ? `Basic ${Buffer.from(`${opts.auth.username}:${opts.auth.password}`).toString("base64")}` : null;
  const authorized = (req: http.IncomingMessage) => !expected || req.headers["proxy-authorization"] === expected;

  const server = http.createServer((req, res) => {
    if (!authorized(req)) {
      res.writeHead(407, { "proxy-authenticate": 'Basic realm="test-proxy"' });
      return res.end();
    }
    requests++;
    let target: URL;
    try {
      target = new URL(req.url ?? "");
    } catch {
      res.writeHead(400);
      return res.end("Bad proxy request");
    }
    const headers = { ...req.headers };
    delete headers["proxy-authorization"];
    delete headers["proxy-connection"];
    const upstream = http.request(
      { host: target.hostname, port: target.port || 80, path: target.pathname + target.search, method: req.method, headers },
      (up) => {
        res.writeHead(up.statusCode ?? 502, up.headers);
        up.pipe(res);
      },
    );
    upstream.on("error", (e) => {
      res.writeHead(502);
      res.end(`Upstream error: ${e.message}`);
    });
    req.pipe(upstream);
  });

  server.on("connect", (req, clientSocket: net.Socket, head) => {
    if (!authorized(req)) {
      clientSocket.end('HTTP/1.1 407 Proxy Authentication Required\r\nProxy-Authenticate: Basic realm="test-proxy"\r\n\r\n');
      return;
    }
    requests++;
    const [host, port] = (req.url ?? "").split(":");
    const upstream = net.connect(Number(port) || 443, host, () => {
      clientSocket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      upstream.write(head);
      upstream.pipe(clientSocket);
      clientSocket.pipe(upstream);
    });
    upstream.on("error", () => clientSocket.end("HTTP/1.1 502 Bad Gateway\r\n\r\n"));
    clientSocket.on("error", () => upstream.destroy());
  });

  return {
    server,
    get requests() {
      return requests;
    },
    listen: () =>
      new Promise<number>((resolve) =>
        server.listen(opts.port ?? 0, opts.host ?? "127.0.0.1", () => resolve((server.address() as net.AddressInfo).port)),
      ),
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections?.();
        server.close(() => resolve());
      }),
  };
}
