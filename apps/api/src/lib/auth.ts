import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { prisma } from "@js/database";
import { randomToken, sha256 } from "@js/security";
import type { ApiConfig } from "../config";

export const SESSION_COOKIE = "js_session";

export interface AuthUser {
  id: string;
  email: string;
  name: string | null;
  isAdmin: boolean;
}

declare module "fastify" {
  interface FastifyRequest {
    user: AuthUser | null;
    sessionId: string | null;
  }
}

/** Resolve the session cookie to a user on every request. */
export function registerAuth(app: FastifyInstance) {
  app.decorateRequest("user", null);
  app.decorateRequest("sessionId", null);
  app.addHook("onRequest", async (req) => {
    const token = req.cookies[SESSION_COOKIE];
    if (!token) return;
    const session = await prisma.authSession.findUnique({
      where: { tokenHash: sha256(token) },
      include: { user: { select: { id: true, email: true, name: true, isAdmin: true } } },
    });
    if (!session || session.expiresAt < new Date()) return;
    req.user = session.user;
    req.sessionId = session.id;
  });
}

export async function startSession(reply: FastifyReply, req: FastifyRequest, userId: string, config: ApiConfig) {
  const token = randomToken(32);
  const expiresAt = new Date(Date.now() + config.sessionTtlHours * 3_600_000);
  await prisma.authSession.create({
    data: { tokenHash: sha256(token), userId, expiresAt, userAgent: req.headers["user-agent"]?.slice(0, 300) },
  });
  reply.setCookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: config.cookieSecure,
    path: "/",
    expires: expiresAt,
  });
}

export async function endSession(reply: FastifyReply, req: FastifyRequest) {
  if (req.sessionId) await prisma.authSession.deleteMany({ where: { id: req.sessionId } });
  reply.clearCookie(SESSION_COOKIE, { path: "/" });
}
