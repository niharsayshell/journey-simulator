import Fastify, { type FastifyInstance } from "fastify";
import cookie from "@fastify/cookie";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import { registerAuth } from "./lib/auth";
import { ApiError, errorHandler } from "./lib/errors";
import type { AppContext } from "./lib/context";
import { authRoutes } from "./routes/auth";
import { projectRoutes } from "./routes/projects";
import { domainRoutes } from "./routes/domains";
import { scenarioRoutes } from "./routes/scenarios";
import { browserProfileRoutes } from "./routes/profiles";
import { proxyRoutes } from "./routes/proxies";
import { batchRoutes } from "./routes/batches";
import { runRoutes } from "./routes/runs";
import { reportRoutes } from "./routes/reports";
import { eventRoutes } from "./routes/events";
import { systemRoutes } from "./routes/system";
import { quickStartRoutes } from "./routes/quickstart";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export async function buildApp(ctx: AppContext, opts: { logger?: boolean | object } = {}): Promise<FastifyInstance> {
  const app = Fastify({
    logger: opts.logger ?? { level: ctx.config.logLevel, redact: ["req.headers.cookie", "req.headers.authorization", "*.password"] },
    trustProxy: ctx.config.trustProxy,
    bodyLimit: 1024 * 1024,
    genReqId: () => crypto.randomUUID(),
  });

  await app.register(helmet, { contentSecurityPolicy: false });
  await app.register(cookie);
  await app.register(rateLimit, {
    global: true,
    max: ctx.config.rateLimitPerMinute,
    timeWindow: "1 minute",
    redis: ctx.redis,
    nameSpace: "js-rl:",
    keyGenerator: (req) => req.ip,
  });
  app.setErrorHandler(errorHandler);
  app.setNotFoundHandler((_req, reply) => reply.status(404).send({ error: { code: "NOT_FOUND", message: "Route not found" } }));

  // CSRF defence: state-changing requests must be JSON and, when the browser
  // sends an Origin, come from the web app's origin. Cookies are SameSite=Lax.
  app.addHook("onRequest", async (req) => {
    if (SAFE_METHODS.has(req.method)) return;
    const origin = req.headers.origin;
    if (origin && origin !== ctx.config.appOrigin) throw new ApiError(403, "BAD_ORIGIN", "Cross-origin request rejected");
    const ct = req.headers["content-type"];
    if (req.headers["content-length"] && req.headers["content-length"] !== "0" && !ct?.startsWith("application/json")) {
      throw new ApiError(415, "UNSUPPORTED_MEDIA_TYPE", "Use application/json");
    }
  });

  registerAuth(app);

  await app.register(
    async (v1) => {
      // Empty JSON bodies (e.g. POST /cancel) are fine.
      v1.addContentTypeParser("application/json", { parseAs: "string" }, (_req, body, done) => {
        try {
          done(null, body === "" ? {} : JSON.parse(body as string));
        } catch {
          done(new ApiError(400, "INVALID_JSON", "Request body is not valid JSON"), undefined);
        }
      });
      await authRoutes(v1, ctx);
      await projectRoutes(v1, ctx);
      await domainRoutes(v1, ctx);
      await scenarioRoutes(v1, ctx);
      await browserProfileRoutes(v1, ctx);
      await proxyRoutes(v1, ctx);
      await batchRoutes(v1, ctx);
      await runRoutes(v1, ctx);
      await reportRoutes(v1, ctx);
      await eventRoutes(v1, ctx);
      await systemRoutes(v1, ctx);
      await quickStartRoutes(v1, ctx);
    },
    { prefix: "/api/v1" },
  );

  return app;
}
