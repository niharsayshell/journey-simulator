import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "@js/database";
import { createProjectInput, updateProjectSettingsInput } from "@js/shared";
import { requireProjectRole, requireUser } from "../lib/access";
import { audit } from "../lib/audit";
import { parse } from "../lib/errors";
import { pageArgs, pageResult } from "../lib/pagination";
import type { AppContext } from "../lib/context";

const idParams = z.object({ id: z.string().min(1).max(64) });

export const projectSelect = {
  id: true,
  name: true,
  description: true,
  testHeaderEnabled: true,
  testHeaderName: true,
  testHeaderValue: true,
  artifactRetentionDays: true,
  createdAt: true,
  updatedAt: true,
} as const;

export async function projectRoutes(app: FastifyInstance, _ctx: AppContext) {
  app.post("/projects", async (req, reply) => {
    const user = requireUser(req);
    const input = parse(createProjectInput, req.body);
    const project = await prisma.project.create({
      data: {
        name: input.name,
        description: input.description,
        memberships: { create: { userId: user.id, role: "OWNER" } },
        browserProfiles: { create: { name: "Desktop Chrome (default)", engine: "chromium", devicePreset: "Desktop Chrome" } },
      },
      select: projectSelect,
    });
    await audit(req, "project.created", { projectId: project.id, targetType: "Project", targetId: project.id });
    return reply.status(201).send({ project: { ...project, role: "OWNER" } });
  });

  app.get("/projects", async (req) => {
    const user = requireUser(req);
    const { limit, prisma: page } = pageArgs(req.query);
    const memberships = await prisma.projectMembership.findMany({
      where: { userId: user.id },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      ...page,
      include: {
        project: {
          select: {
            ...projectSelect,
            _count: { select: { scenarios: true, domains: { where: { status: { in: ["VERIFIED", "ATTESTED"] } } }, batches: true } },
          },
        },
      },
    });
    const { items, nextCursor } = pageResult(memberships, limit);
    return { items: items.map((m) => ({ ...m.project, role: m.role })), nextCursor };
  });

  app.get("/projects/:id", async (req) => {
    const { id } = parse(idParams, req.params);
    const m = await requireProjectRole(req, id);
    const project = await prisma.project.findUniqueOrThrow({ where: { id }, select: projectSelect });
    return { project: { ...project, role: m.role } };
  });

  app.patch("/projects/:id/settings", async (req) => {
    const { id } = parse(idParams, req.params);
    await requireProjectRole(req, id, "ADMIN");
    const input = parse(updateProjectSettingsInput, req.body);
    const project = await prisma.project.update({ where: { id }, data: input, select: projectSelect });
    await audit(req, "project.settings_updated", { projectId: id, targetType: "Project", targetId: id, metadata: { fields: Object.keys(input) } });
    return { project };
  });

  app.get("/projects/:id/audit-logs", async (req) => {
    const { id } = parse(idParams, req.params);
    await requireProjectRole(req, id, "ADMIN");
    const { limit, prisma: page } = pageArgs(req.query);
    const rows = await prisma.auditLog.findMany({
      where: { projectId: id },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      ...page,
      select: { id: true, action: true, targetType: true, targetId: true, metadata: true, createdAt: true, user: { select: { email: true } } },
    });
    return pageResult(rows, limit);
  });
}
