import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { REDIS_CHANNELS, type PlatformEvent } from "@js/shared";
import { requireProjectRole } from "../lib/access";
import { parse } from "../lib/errors";
import type { AppContext } from "../lib/context";

/**
 * Server-Sent Events stream of execution updates for one project.
 * Membership is checked once at connect time.
 */
export async function eventRoutes(app: FastifyInstance, ctx: AppContext) {
  app.get("/events/stream", { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (req, reply) => {
    const { projectId, batchId } = parse(z.object({ projectId: z.string().min(1).max(64), batchId: z.string().max(64).optional() }), req.query);
    await requireProjectRole(req, projectId);

    reply.hijack();
    const res = reply.raw;
    res.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    });
    res.write(`retry: 3000\n\n`);
    res.write(`event: ready\ndata: {}\n\n`);

    const sub = ctx.createSubscriber();
    const onMessage = (_channel: string, raw: string) => {
      try {
        const evt = JSON.parse(raw) as PlatformEvent;
        if (evt.projectId !== projectId) return;
        if (batchId && "batchId" in evt && evt.batchId !== batchId) return;
        res.write(`event: ${evt.type}\ndata: ${raw}\n\n`);
      } catch {
        /* ignore */
      }
    };
    sub.on("message", onMessage);
    await sub.subscribe(REDIS_CHANNELS.events);
    const ping = setInterval(() => res.write(`: ping\n\n`), 15_000);
    req.raw.on("close", () => {
      clearInterval(ping);
      sub.off("message", onMessage);
      void sub.quit().catch(() => undefined);
    });
  });
}
