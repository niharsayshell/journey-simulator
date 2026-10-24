import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma, type ProxyProfile } from "@js/database";
import { isMetadataAddress, METADATA_HOSTNAMES } from "@js/security";
import { createProxyProfileInput, updateProxyProfileInput, type ProxyTestResult } from "@js/shared";
import { requireProjectRole } from "../lib/access";
import { audit } from "../lib/audit";
import { ApiError, notFound, parse } from "../lib/errors";
import { pageArgs, pageResult } from "../lib/pagination";
import type { AppContext } from "../lib/context";

const idParams = z.object({ id: z.string().min(1).max(64) });

/** Public view of a proxy profile. Credentials never leave the server. */
export function serializeProxy(p: ProxyProfile) {
  return {
    id: p.id,
    projectId: p.projectId,
    name: p.name,
    type: p.type,
    host: p.host,
    port: p.port,
    hasCredentials: p.hasCredentials,
    regionLabel: p.regionLabel,
    lastTest: p.lastTestAt
      ? { at: p.lastTestAt, ok: p.lastTestOk, egressIp: p.lastEgressIp, latencyMs: p.lastLatencyMs, error: p.lastTestError }
      : null,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
  };
}

function assertProxyHost(host: string) {
  if (METADATA_HOSTNAMES.has(host) || isMetadataAddress(host)) throw new ApiError(400, "INVALID_PROXY", "Metadata hosts cannot be used as proxies");
}

export async function proxyRoutes(app: FastifyInstance, ctx: AppContext) {
  app.post("/proxy-profiles", async (req, reply) => {
    const input = parse(createProxyProfileInput, req.body);
    await requireProjectRole(req, input.projectId, "ADMIN");
    assertProxyHost(input.host);
    const hasCredentials = Boolean(input.username || input.password);
    const profile = await prisma.proxyProfile.create({
      data: {
        project: { connect: { id: input.projectId } },
        name: input.name,
        type: input.type,
        host: input.host,
        port: input.port,
        regionLabel: input.regionLabel || null,
        hasCredentials,
        credentialSecret: hasCredentials
          ? {
              create: {
                projectId: input.projectId,
                kind: "PROXY_CREDENTIALS" as const,
                ciphertext: ctx.secrets.encrypt(JSON.stringify({ username: input.username ?? "", password: input.password ?? "" })),
              },
            }
          : undefined,
      },
    });
    await audit(req, "proxy_profile.created", {
      projectId: input.projectId,
      targetType: "ProxyProfile",
      targetId: profile.id,
      metadata: { host: input.host, port: input.port, type: input.type, hasCredentials },
    });
    return reply.status(201).send({ profile: serializeProxy(profile) });
  });

  app.get("/proxy-profiles", async (req) => {
    const { projectId } = parse(z.object({ projectId: z.string().min(1).max(64) }).passthrough(), req.query);
    await requireProjectRole(req, projectId);
    const { limit, prisma: page } = pageArgs(req.query);
    const rows = await prisma.proxyProfile.findMany({ where: { projectId }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], ...page });
    const { items, nextCursor } = pageResult(rows, limit);
    return { items: items.map(serializeProxy), nextCursor };
  });

  app.patch("/proxy-profiles/:id", async (req) => {
    const { id } = parse(idParams, req.params);
    const input = parse(updateProxyProfileInput, req.body);
    const existing = await prisma.proxyProfile.findUnique({ where: { id } });
    if (!existing) throw notFound("Proxy profile");
    await requireProjectRole(req, existing.projectId, "ADMIN");
    if (input.host) assertProxyHost(input.host);
    const { username, password, clearCredentials, ...fields } = input;
    const updated = await prisma.$transaction(async (tx) => {
      let credentialSecretId = existing.credentialSecretId;
      let hasCredentials = existing.hasCredentials;
      if (clearCredentials && credentialSecretId) {
        await tx.proxyProfile.update({ where: { id }, data: { credentialSecretId: null } });
        await tx.encryptedSecret.delete({ where: { id: credentialSecretId } });
        credentialSecretId = null;
        hasCredentials = false;
      }
      if (username !== undefined || password !== undefined) {
        const ciphertext = ctx.secrets.encrypt(JSON.stringify({ username: username ?? "", password: password ?? "" }));
        if (credentialSecretId) await tx.encryptedSecret.update({ where: { id: credentialSecretId }, data: { ciphertext } });
        else credentialSecretId = (await tx.encryptedSecret.create({ data: { projectId: existing.projectId, kind: "PROXY_CREDENTIALS", ciphertext } })).id;
        hasCredentials = true;
      }
      return tx.proxyProfile.update({
        where: { id },
        data: { ...fields, regionLabel: fields.regionLabel === "" ? null : fields.regionLabel, credentialSecretId, hasCredentials, lastTestAt: null, lastTestOk: null },
      });
    });
    await audit(req, "proxy_profile.updated", { projectId: existing.projectId, targetType: "ProxyProfile", targetId: id, metadata: { fields: Object.keys(input) } });
    return { profile: serializeProxy(updated) };
  });

  app.delete("/proxy-profiles/:id", async (req) => {
    const { id } = parse(idParams, req.params);
    const existing = await prisma.proxyProfile.findUnique({ where: { id } });
    if (!existing) throw notFound("Proxy profile");
    await requireProjectRole(req, existing.projectId, "ADMIN");
    await prisma.$transaction(async (tx) => {
      await tx.proxyProfile.delete({ where: { id } });
      if (existing.credentialSecretId) await tx.encryptedSecret.delete({ where: { id: existing.credentialSecretId } });
    });
    await audit(req, "proxy_profile.deleted", { projectId: existing.projectId, targetType: "ProxyProfile", targetId: id });
    return { ok: true };
  });

  /** Connectivity test runs on a worker through a real browser; the API waits for the result. */
  app.post("/proxy-profiles/:id/test", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (req) => {
    const { id } = parse(idParams, req.params);
    const existing = await prisma.proxyProfile.findUnique({ where: { id } });
    if (!existing) throw notFound("Proxy profile");
    await requireProjectRole(req, existing.projectId, "MEMBER");
    const job = await ctx.queues.proxyTests.add("test", { proxyProfileId: id }, { removeOnComplete: 100, removeOnFail: 100, attempts: 1 });
    let result: ProxyTestResult;
    try {
      result = (await job.waitUntilFinished(ctx.queues.proxyTestEvents, ctx.config.proxyTestTimeoutMs)) as ProxyTestResult;
    } catch (err) {
      throw new ApiError(504, "PROXY_TEST_TIMEOUT", `No worker completed the proxy test in time: ${(err as Error).message}`);
    }
    await audit(req, "proxy_profile.tested", { projectId: existing.projectId, targetType: "ProxyProfile", targetId: id, metadata: { ok: result.ok } });
    const profile = await prisma.proxyProfile.findUniqueOrThrow({ where: { id } });
    return { result, profile: serializeProxy(profile) };
  });
}
