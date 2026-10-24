import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma, type VerifiedDomain } from "@js/database";
import {
  isIp,
  isPrivateAllowlisted,
  METADATA_HOSTNAMES,
  randomToken,
  verificationInstructions,
  verifyDomainOwnership,
} from "@js/security";
import { createDomainInput } from "@js/shared";
import { requireProjectRole } from "../lib/access";
import { audit } from "../lib/audit";
import { ApiError, notFound, parse } from "../lib/errors";
import { pageArgs, pageResult } from "../lib/pagination";
import type { AppContext } from "../lib/context";

const idParams = z.object({ id: z.string().min(1).max(64) });
const LABEL = /^(?!-)[a-z0-9-]{1,63}(?<!-)$/;

export function serializeDomain(d: VerifiedDomain) {
  return {
    id: d.id,
    projectId: d.projectId,
    hostname: d.hostname,
    port: d.port,
    host: d.port ? `${d.hostname}:${d.port}` : d.hostname,
    allowSubdomains: d.allowSubdomains,
    method: d.method,
    scheme: d.scheme,
    status: d.status,
    verifiedAt: d.verifiedAt,
    lastCheckedAt: d.lastCheckedAt,
    lastCheckError: d.lastCheckError,
    createdAt: d.createdAt,
    instructions: verificationInstructions({ hostname: d.hostname, port: d.port, scheme: d.scheme, method: d.method, token: d.verificationToken }),
  };
}

export async function domainRoutes(app: FastifyInstance, ctx: AppContext) {
  app.post("/domains", async (req, reply) => {
    const input = parse(createDomainInput, req.body);
    await requireProjectRole(req, input.projectId, "ADMIN");
    const [hostname, portStr] = input.host.replace(/\.$/, "").split(":") as [string, string | undefined];
    const port = portStr ? Number(portStr) : null;
    if (port !== null && (port < 1 || port > 65535)) throw new ApiError(400, "INVALID_HOST", "Port must be between 1 and 65535");
    if (port === 80 || port === 443) throw new ApiError(400, "INVALID_HOST", "Omit default ports 80/443");

    const probe = new URL(`${input.scheme}://${hostname}${port ? `:${port}` : ""}/`);
    const allowlisted = isPrivateAllowlisted(probe, ctx.config.policy);
    if (METADATA_HOSTNAMES.has(hostname)) throw new ApiError(400, "INVALID_HOST", "Metadata hosts cannot be authorized");
    if (isIp(hostname) && !allowlisted) throw new ApiError(400, "INVALID_HOST", "Register a hostname, not an IP address");
    if (!hostname.split(".").every((l) => LABEL.test(l))) throw new ApiError(400, "INVALID_HOST", "Invalid hostname");
    if (!hostname.includes(".") && !allowlisted) {
      throw new ApiError(400, "INVALID_HOST", "Single-label hostnames (like localhost) must be allowlisted by an administrator");
    }
    if (input.method === "DNS_TXT" && allowlisted && !hostname.includes(".")) {
      throw new ApiError(400, "INVALID_METHOD", "Use the hosted file method for local development hosts");
    }

    const existing = await prisma.verifiedDomain.findFirst({ where: { projectId: input.projectId, hostname, port } });
    if (existing) throw new ApiError(409, "DOMAIN_EXISTS", "This domain is already registered in the project");
    const domain = await prisma.verifiedDomain.create({
      data: {
        projectId: input.projectId,
        hostname,
        port,
        allowSubdomains: input.allowSubdomains,
        method: input.method,
        scheme: input.scheme,
        verificationToken: randomToken(18),
      },
    });
    await audit(req, "domain.added", { projectId: input.projectId, targetType: "VerifiedDomain", targetId: domain.id, metadata: { host: input.host } });
    return reply.status(201).send({ domain: serializeDomain(domain) });
  });

  app.get("/domains", async (req) => {
    const { projectId } = parse(z.object({ projectId: z.string().min(1).max(64) }).passthrough(), req.query);
    await requireProjectRole(req, projectId);
    const { limit, prisma: page } = pageArgs(req.query);
    const rows = await prisma.verifiedDomain.findMany({ where: { projectId }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], ...page });
    const { items, nextCursor } = pageResult(rows, limit);
    return { items: items.map(serializeDomain), nextCursor };
  });

  app.post("/domains/:id/verify", { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } }, async (req) => {
    const { id } = parse(idParams, req.params);
    const domain = await prisma.verifiedDomain.findUnique({ where: { id } });
    if (!domain) throw notFound("Domain");
    await requireProjectRole(req, domain.projectId, "ADMIN");
    if (domain.status === "REVOKED") throw new ApiError(409, "REVOKED", "This domain was revoked; add it again to re-verify");
    const result = await verifyDomainOwnership(
      { hostname: domain.hostname, port: domain.port, scheme: domain.scheme, method: domain.method, token: domain.verificationToken },
      ctx.config.policy,
    );
    const updated = await prisma.verifiedDomain.update({
      where: { id },
      data: {
        status: result.ok ? "VERIFIED" : domain.status === "VERIFIED" ? "VERIFIED" : "FAILED",
        verifiedAt: result.ok ? new Date() : domain.verifiedAt,
        lastCheckedAt: new Date(),
        lastCheckError: result.ok ? null : result.detail,
      },
    });
    await audit(req, result.ok ? "domain.verified" : "domain.verification_failed", {
      projectId: domain.projectId,
      targetType: "VerifiedDomain",
      targetId: id,
      metadata: { detail: result.detail },
    });
    return { domain: serializeDomain(updated), result };
  });

  /** Revoke: runs targeting this domain are blocked immediately (checked by workers before every run). */
  app.delete("/domains/:id", async (req) => {
    const { id } = parse(idParams, req.params);
    const domain = await prisma.verifiedDomain.findUnique({ where: { id } });
    if (!domain) throw notFound("Domain");
    await requireProjectRole(req, domain.projectId, "ADMIN");
    await prisma.verifiedDomain.delete({ where: { id } });
    await audit(req, "domain.removed", { projectId: domain.projectId, targetType: "VerifiedDomain", targetId: id, metadata: { host: domain.hostname } });
    return { ok: true };
  });
}
