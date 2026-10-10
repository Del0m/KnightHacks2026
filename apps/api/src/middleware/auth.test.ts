// BE-02: token verification with locally generated keys standing in for Neon Auth's JWKS.
import express from "express";
import request from "supertest";
import { beforeAll, describe, expect, it } from "vitest";
import { createKeys } from "../../test/helpers.js";
import { errorHandler } from "../http.js";
import { requireAuth } from "./auth.js";

let keys: Awaited<ReturnType<typeof createKeys>>;
let app: express.Express;
const seen: string[] = [];

beforeAll(async () => {
  keys = await createKeys();
  app = express();
  app.use(
    requireAuth(keys.verify, async (u) => {
      seen.push(u.id);
    }),
  );
  app.get("/whoami", (req, res) => res.json({ id: req.user!.id }));
  app.use(errorHandler);
});

describe("requireAuth", () => {
  it("returns 401 without a token", async () => {
    const res = await request(app).get("/whoami");
    expect(res.status).toBe(401);
    expect(res.body.error).toBe("unauthorized");
  });

  it("returns 401 for a malformed header", async () => {
    expect((await request(app).get("/whoami").set("Authorization", "Token abc")).status).toBe(401);
  });

  it("returns 401 for garbage and for a token signed by someone else", async () => {
    expect((await request(app).get("/whoami").set("Authorization", "Bearer not.a.jwt")).status).toBe(401);
    const other = await createKeys();
    const forged = await other.sign("user-1");
    expect((await request(app).get("/whoami").set("Authorization", `Bearer ${forged}`)).status).toBe(401);
  });

  it("returns 401 for an expired token or the wrong issuer", async () => {
    const expired = await keys.sign("user-1", { expiresIn: "-1m" });
    expect((await request(app).get("/whoami").set("Authorization", `Bearer ${expired}`)).status).toBe(401);
    const wrongIssuer = await keys.sign("user-1", { issuer: "https://evil.example" });
    expect((await request(app).get("/whoami").set("Authorization", `Bearer ${wrongIssuer}`)).status).toBe(
      401,
    );
  });

  it("attaches req.user.id from the token subject", async () => {
    const token = await keys.sign("neon-user-42");
    const res = await request(app).get("/whoami").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ id: "neon-user-42" });
    expect(seen).toContain("neon-user-42");
  });
});
