import type { FastifyError, FastifyReply, FastifyRequest } from "fastify";
import { ZodError, type ZodTypeAny, type z } from "zod";

export class ApiError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
  }
}

export const notFound = (what = "Resource") => new ApiError(404, "NOT_FOUND", `${what} not found`);
export const forbidden = (msg = "You do not have permission to perform this action") => new ApiError(403, "FORBIDDEN", msg);

/** Validate untrusted input; throws a structured 400 on failure. */
export function parse<S extends ZodTypeAny>(schema: S, data: unknown): z.infer<S> {
  const r = schema.safeParse(data);
  if (!r.success) throw validationError(r.error);
  return r.data;
}

export function validationError(err: ZodError) {
  return new ApiError(
    400,
    "VALIDATION_ERROR",
    "Request validation failed",
    err.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
  );
}

/** All errors leave the API as { error: { code, message, details? } }. */
export function errorHandler(err: FastifyError | ApiError | Error, req: FastifyRequest, reply: FastifyReply) {
  if (err instanceof ApiError) {
    return reply.status(err.statusCode).send({ error: { code: err.code, message: err.message, details: err.details } });
  }
  if (err instanceof ZodError) {
    const e = validationError(err);
    return reply.status(400).send({ error: { code: e.code, message: e.message, details: e.details } });
  }
  const fe = err as FastifyError;
  if (fe.statusCode === 429) return reply.status(429).send({ error: { code: "RATE_LIMITED", message: "Too many requests" } });
  if (fe.statusCode && fe.statusCode < 500) {
    return reply.status(fe.statusCode).send({ error: { code: fe.code ?? "BAD_REQUEST", message: fe.message } });
  }
  req.log.error({ err }, "unhandled error");
  return reply.status(500).send({ error: { code: "INTERNAL", message: "Internal server error" } });
}
