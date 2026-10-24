import { createTestProxy } from "./test-proxy";

const port = Number(process.env.DEV_PROXY_PORT ?? 8899);
const username = process.env.DEV_PROXY_USER;
const password = process.env.DEV_PROXY_PASS;
const proxy = createTestProxy({ port, host: process.env.DEV_PROXY_HOST ?? "127.0.0.1", auth: username && password ? { username, password } : undefined });
proxy.listen().then((p) =>
  console.log(
    JSON.stringify({ level: "info", msg: `Test proxy listening on 127.0.0.1:${p}${username ? " (basic auth required)" : ""}. Add 127.0.0.1:${p} to PRIVATE_HOST_ALLOWLIST.` }),
  ),
);
