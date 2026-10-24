import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma, type VerifiedDomain } from "@js/database";
import {
  assertPublicDestination,
  isIp,
  isPrivateAllowlisted,
  METADATA_HOSTNAMES,
  randomToken,
  verificationInstructions,
  verifyDomainOwnership,
} from "@js/security";
import { createDomainInput, verifyDomainInput } from "@js/shared";
import { requireProjectRole } from "../lib/access";
import { audit } from "../lib/audit";
import { ApiError, notFound, parse } from "../lib/errors";
import { pageArgs, pageResult } from "../lib/pagination";
import type { AppContext } from "../lib/context";
import type { FastifyRequest } from "fastify";

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
    attestedAt: d.attestedAt,
    lastCheckedAt: d.lastCheckedAt,
    lastCheckError: d.lastCheckError,
    createdAt: d.createdAt,
    instructions: verificationInstructions({
      hostname: d.hostname,
      port: d.port,
      scheme: d.scheme,
      method: d.method === "DNS_TXT" ? "DNS_TXT" : "HTTP_FILE",
      token: d.verificationToken,
    }),
  };
}

/**
 * Validate a host and register it for a project. SELF_ATTESTED domains are
 * usable immediately on the strength of the user's declaration, which is
 * recorded (who/when) and audited; DNS_TXT / HTTP_FILE start as PENDING.
 */
export async function createDomain(
  req: FastifyRequest,
  ctx: AppContext,
  input: { projectId: string; host: string; method: "DNS_TXT" | "HTTP_FILE" | "SELF_ATTESTED"; scheme: "http" | "https"; allowSubdomains: boolean; attestation?: boolean },
): Promise<VerifiedDomain> {
  const [hostname, portStr] = input.host.replace(/\.$/, "").split(":") as [string, string | undefined];
  const port = portStr ? Number(portStr) : null;
  if (port !== null && (port < 1 || port > 65535)) throw new ApiError(400, "INVALID_HOST", "Port must be between 1 and 65535");
  if (port === 80 || port === 443) throw new ApiError(400, "INVALID_HOST", "Omit default ports 80/443");

  const probe = new URL(`${input.scheme}://${hostname}${port ? `:${port}` : ""}/`);
  const allowlisted = isPrivateAllowlisted(probe, ctx.config.policy);
  if (METADATA_HOSTNAMES.has(hostname)) throw new ApiError(400, "INVALID_HOST", "Metadata hosts cannot be authorized");
  if (isIp(hostname) && !allowlisted) throw new ApiError(400, "INVALID_HOST", "Use the website's name (like shop.example.com), not an IP address");
  if (!hostname.split(".").every((l) => LABEL.test(l))) throw new ApiError(400, "INVALID_HOST", "Invalid website address");
  if (!hostname.includes(".") && !allowlisted) {
    throw new ApiError(400, "INVALID_HOST", "Single-label hostnames (like localhost) must be allowlisted by an administrator");
  }
  if (input.method === "DNS_TXT" && allowlisted && !hostname.includes(".")) {
    throw new ApiError(400, "INVALID_METHOD", "Use the hosted file method for local development hosts");
  }
  const user = req.user!;
  if (input.method === "SELF_ATTESTED") {
    if (!ctx.config.allowSelfAttested) {
      throw new ApiError(403, "ATTESTATION_DISABLED", "The administrator requires proof of ownership (DNS or hosted file) on this installation");
    }
    if (input.attestation !== true) {
      throw new ApiError(400, "ATTESTATION_REQUIRED", "Please confirm you own this website or have permission to test it");
    }
    // No ownership proof, so at least make sure it is a real public website.
    try {
      await assertPublicDestination(probe, ctx.config.policy);
    } catch (err) {
      throw new ApiError(400, "INVALID_HOST", `This website cannot be used: ${(err as Error).message}`);
    }
  }

  const existing = await prisma.verifiedDomain.findFirst({ where: { projectId: input.projectId, hostname, port } });
  if (existing) throw new ApiError(409, "DOMAIN_EXISTS", "This website is already registered in the project");
  const attested = input.method === "SELF_ATTESTED";
  const domain = await prisma.verifiedDomain.create({
    data: {
      projectId: input.projectId,
      hostname,
      port,
      allowSubdomains: input.allowSubdomains,
      method: input.method,
      scheme: input.scheme,
      verificationToken: randomToken(18),
      status: attested ? "ATTESTED" : "PENDING",
      attestedById: attested ? user.id : null,
      attestedAt: attested ? new Date() : null,
    },
  });
  await audit(req, attested ? "domain.attested" : "domain.added", {
    projectId: input.projectId,
    targetType: "VerifiedDomain",
    targetId: domain.id,
    metadata: attested
      ? { host: input.host, statement: "User confirmed they own this website or have explicit permission to test it" }
      : { host: input.host },
  });
  return domain;
}

export async function domainRoutes(app: FastifyInstance, ctx: AppContext) {
  app.post("/domains", async (req, reply) => {
    const input = parse(createDomainInput, req.body);
    await requireProjectRole(req, input.projectId, "ADMIN");
    const domain = await createDomain(req, ctx, input);
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
    const body = parse(verifyDomainInput, req.body ?? {});
    const method = body.method ?? (domain.method === "SELF_ATTESTED" ? "HTTP_FILE" : domain.method);
    const result = await verifyDomainOwnership(
      { hostname: domain.hostname, port: domain.port, scheme: domain.scheme, method, token: domain.verificationToken },
      ctx.config.policy,
    );
    // A failed check never removes access that was already granted (verified or self-declared).
    const keep = domain.status === "VERIFIED" || domain.status === "ATTESTED" ? domain.status : "FAILED";
    const updated = await prisma.verifiedDomain.update({
      where: { id },
      data: {
        method: result.ok ? method : domain.method,
        status: result.ok ? "VERIFIED" : keep,
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
