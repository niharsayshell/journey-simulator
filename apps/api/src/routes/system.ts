import type { FastifyInstance } from "fastify";
import { prisma } from "@js/database";
import { IMPLEMENTED_STEP_TYPES, IMPLEMENTED_SESSION_MODES, PLANNED_STEP_TYPES } from "@js/shared";
import { requireUser } from "../lib/access";
import type { AppContext } from "../lib/context";
import { workerEngines } from "./profiles";

export async function systemRoutes(app: FastifyInstance, ctx: AppContext) {
  app.get("/health", { config: { rateLimit: false } }, async (_req, reply) => {
    const checks: Record<string, string> = {};
    try {
      await prisma.$queryRaw`SELECT 1`;
      checks.database = "ok";
    } catch {
      checks.database = "error";
    }
    try {
      checks.redis = (await ctx.redis.ping()) === "PONG" ? "ok" : "error";
    } catch {
      checks.redis = "error";
    }
    const ok = Object.values(checks).every((v) => v === "ok");
    return reply.status(ok ? 200 : 503).send({ status: ok ? "ok" : "degraded", checks });
  });

  app.get("/system/info", async (req) => {
    requireUser(req);
    return {
      limits: ctx.config.limits,
      workerEngines: await workerEngines(ctx),
      privateHostAllowlist: ctx.config.policy.privateHostAllowlist,
      allowSelfAttested: ctx.config.allowSelfAttested,
      features: {
        stepTypes: IMPLEMENTED_STEP_TYPES,
        plannedStepTypes: PLANNED_STEP_TYPES,
        sessionModes: IMPLEMENTED_SESSION_MODES,
      },
    };
  });
}
