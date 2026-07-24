import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { randomBytes } from "node:crypto";
import { hash, verify } from "@node-rs/argon2";
import { prisma } from "@opennpc/db";

declare module "fastify" {
  interface FastifyRequest {
    /** Set by authHook when a valid session cookie is present. */
    userId?: string;
  }
}

export const SESSION_COOKIE = "opennpc_session";
const SESSION_TTL_DAYS = 7;

export function hashPassword(password: string): Promise<string> {
  return hash(password);
}
export function verifyPassword(hashed: string, password: string): Promise<boolean> {
  return verify(hashed, password);
}

function cookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    path: "/",
    secure: process.env.NODE_ENV === "production",
    maxAge: SESSION_TTL_DAYS * 24 * 60 * 60,
  };
}

async function startSession(reply: FastifyReply, userId: string): Promise<void> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000);
  await prisma.session.create({ data: { id: token, userId, expiresAt } });
  reply.setCookie(SESSION_COOKIE, token, cookieOptions());
}

async function resolveSessionUser(token: string): Promise<string | null> {
  const session = await prisma.session.findUnique({ where: { id: token } });
  if (!session) return null;
  if (session.expiresAt.getTime() < Date.now()) {
    await prisma.session.deleteMany({ where: { id: token } });
    return null;
  }
  return session.userId;
}

/** onRequest hook: populate req.userId from the session cookie (non-rejecting). */
export async function authHook(req: FastifyRequest): Promise<void> {
  const token = req.cookies?.[SESSION_COOKIE];
  if (!token) return;
  const userId = await resolveSessionUser(token);
  if (userId) req.userId = userId;
}

/** preHandler guard: reject unauthenticated requests. */
export async function requireAuth(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (!req.userId) {
    await reply.code(401).send({ error: "unauthorized" });
  }
}

export async function authRoutes(app: FastifyInstance): Promise<void> {
  app.post("/auth/signup", async (req, reply) => {
    const { email, password, name } = (req.body ?? {}) as {
      email?: string;
      password?: string;
      name?: string;
    };
    const e = email?.trim().toLowerCase();
    if (!e || !e.includes("@")) return reply.code(400).send({ error: "a valid email is required" });
    if (!password || password.length < 8) {
      return reply.code(400).send({ error: "password must be at least 8 characters" });
    }
    if (await prisma.user.findUnique({ where: { email: e } })) {
      return reply.code(409).send({ error: "email already registered" });
    }
    const user = await prisma.user.create({
      data: { email: e, passwordHash: await hashPassword(password), name: name?.trim() || null },
    });
    await startSession(reply, user.id);
    return reply.code(201).send({ id: user.id, email: user.email, name: user.name });
  });

  app.post("/auth/login", async (req, reply) => {
    const { email, password } = (req.body ?? {}) as { email?: string; password?: string };
    const e = email?.trim().toLowerCase();
    const user = e ? await prisma.user.findUnique({ where: { email: e } }) : null;
    if (!user || !password || !(await verifyPassword(user.passwordHash, password))) {
      return reply.code(401).send({ error: "invalid email or password" });
    }
    await startSession(reply, user.id);
    return { id: user.id, email: user.email, name: user.name };
  });

  app.post("/auth/logout", async (req, reply) => {
    const token = req.cookies?.[SESSION_COOKIE];
    if (token) await prisma.session.deleteMany({ where: { id: token } });
    reply.clearCookie(SESSION_COOKIE, { path: "/" });
    return { ok: true };
  });

  app.get("/auth/me", async (req, reply) => {
    if (!req.userId) return reply.code(401).send({ error: "unauthorized" });
    const user = await prisma.user.findUnique({
      where: { id: req.userId },
      select: { id: true, email: true, name: true },
    });
    if (!user) return reply.code(401).send({ error: "unauthorized" });
    return user;
  });
}
