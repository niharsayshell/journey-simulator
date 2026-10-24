import type { FastifyRequest } from "fastify";
import { prisma } from "@js/database";

/** Append an audit record. Never pass secrets in metadata. */
export async function audit(
  req: FastifyRequest,
  action: string,
  opts: { projectId?: string; targetType?: string; targetId?: string; metadata?: Record<string, unknown> } = {},
) {
  try {
    await prisma.auditLog.create({
      data: {
        action,
        projectId: opts.projectId,
        targetType: opts.targetType,
        targetId: opts.targetId,
        metadata: (opts.metadata ?? undefined) as object | undefined,
        userId: req.user?.id,
        ip: req.ip,
      },
    });
  } catch (err) {
    req.log.warn({ err, action }, "failed to write audit log");
  }
}
