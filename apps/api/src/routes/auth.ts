import type { FastifyInstance } from "fastify";
import { prisma } from "@js/database";
import { hashPassword, verifyPassword } from "@js/security";
import { loginInput, registerInput } from "@js/shared";
import { endSession, startSession } from "../lib/auth";
import { ApiError, parse } from "../lib/errors";
import { requireUser } from "../lib/access";
import { audit } from "../lib/audit";
import type { AppContext } from "../lib/context";

// Constant-time-ish defence against user enumeration on login.
const DUMMY_HASH = hashPassword("not-a-real-password-placeholder");

export async function authRoutes(app: FastifyInstance, ctx: AppContext) {
  const strict = { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } };

  app.post("/auth/register", strict, async (req, reply) => {
    const closed =
      ctx.config.registration === "closed" || (ctx.config.registration === "first-user" && (await prisma.user.count()) > 0);
    if (closed) throw new ApiError(403, "REGISTRATION_DISABLED", "Sign-up is closed on this installation. Ask the administrator for an account.");
    const input = parse(registerInput, req.body);
    const existing = await prisma.user.findUnique({ where: { email: input.email } });
    if (existing) throw new ApiError(409, "EMAIL_TAKEN", "An account with this email already exists");
    const isFirstUser = (await prisma.user.count()) === 0;
    const user = await prisma.user.create({
      data: { email: input.email, name: input.name || null, passwordHash: await hashPassword(input.password), isAdmin: isFirstUser },
      select: { id: true, email: true, name: true, isAdmin: true },
    });
    await startSession(reply, req, user.id, ctx.config);
    req.user = user;
    await audit(req, "user.registered", { targetType: "User", targetId: user.id });
    return reply.status(201).send({ user });
  });

  app.post("/auth/login", strict, async (req, reply) => {
    const input = parse(loginInput, req.body);
    const user = await prisma.user.findUnique({ where: { email: input.email } });
    const ok = user ? await verifyPassword(input.password, user.passwordHash) : (await verifyPassword(input.password, await DUMMY_HASH), false);
    if (!user || !ok) throw new ApiError(401, "INVALID_CREDENTIALS", "Incorrect email or password");
    await startSession(reply, req, user.id, ctx.config);
    req.user = { id: user.id, email: user.email, name: user.name, isAdmin: user.isAdmin };
    await audit(req, "user.login", { targetType: "User", targetId: user.id });
    return { user: req.user };
  });

  app.post("/auth/logout", async (req, reply) => {
    await endSession(reply, req);
    return { ok: true };
  });

  app.get("/auth/me", async (req) => ({ user: requireUser(req) }));
}
