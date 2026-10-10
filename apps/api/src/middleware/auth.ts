// BE-02: verify Neon Auth JWTs on protected routes and attach req.user.
//
// Neon Auth signs access tokens with keys published at its JWKS URL; `sub` is the user id that
// keys the users table (DB-03). The first request from a new user creates their users and
// profiles rows, so every handler can rely on req.user.id existing in Neon.
import type { RequestHandler } from "express";
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";
import { HttpError } from "../http.js";

export interface AuthUser {
  id: string;
}

declare module "express-serve-static-core" {
  interface Request {
    user?: AuthUser;
  }
}

export type VerifyToken = (token: string) => Promise<AuthUser>;

export interface VerifierOptions {
  issuer?: string;
  audience?: string;
}

export function jwtVerifier(keys: JWTVerifyGetKey, options: VerifierOptions = {}): VerifyToken {
  return async (token) => {
    const { payload } = await jwtVerify(token, keys, {
      issuer: options.issuer,
      audience: options.audience,
    });
    if (typeof payload.sub !== "string" || payload.sub === "") throw new Error("token has no sub");
    return { id: payload.sub };
  };
}

export function neonAuthVerifier(jwksUrl: string, options: VerifierOptions = {}): VerifyToken {
  // jose caches the key set and refetches when it sees an unknown key id.
  return jwtVerifier(createRemoteJWKSet(new URL(jwksUrl)), options);
}

export function requireAuth(verify: VerifyToken, onUser?: (user: AuthUser) => Promise<void>): RequestHandler {
  return async (req, _res, next) => {
    const header = req.headers.authorization ?? "";
    const match = /^Bearer\s+(.+)$/i.exec(header);
    if (!match) throw new HttpError(401, "unauthorized", "Sign in to continue");

    let user: AuthUser;
    try {
      user = await verify(match[1]!.trim());
    } catch {
      throw new HttpError(401, "unauthorized", "Your session has expired. Sign in again.");
    }
    if (onUser) await onUser(user);
    req.user = user;
    next();
  };
}
