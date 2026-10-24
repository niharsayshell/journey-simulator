import type { FastifyRequest } from "fastify";
import { prisma } from "@js/database";
import type { ProjectRole } from "@js/shared";
import { ApiError, notFound } from "./errors";

const RANK: Record<ProjectRole, number> = { VIEWER: 0, MEMBER: 1, ADMIN: 2, OWNER: 3 };

export function requireUser(req: FastifyRequest) {
  if (!req.user) throw new ApiError(401, "UNAUTHENTICATED", "Sign in to continue");
  return req.user;
}

/**
 * Project-scoped authorization. Non-members get 404 rather than 403 so that
 * project ids cannot be probed.
 */
export async function requireProjectRole(req: FastifyRequest, projectId: string, minRole: ProjectRole = "VIEWER") {
  const user = requireUser(req);
  const m = await prisma.projectMembership.findUnique({ where: { projectId_userId: { projectId, userId: user.id } } });
  if (!m) throw notFound("Project");
  if (RANK[m.role] < RANK[minRole]) throw new ApiError(403, "FORBIDDEN", `This action requires the ${minRole} role`);
  return m;
}

/** Ids of every project the user belongs to. */
export async function memberProjectIds(userId: string): Promise<string[]> {
  const ms = await prisma.projectMembership.findMany({ where: { userId }, select: { projectId: true } });
  return ms.map((m) => m.projectId);
}
