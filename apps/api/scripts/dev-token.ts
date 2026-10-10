// npm run dev:token: sign in to Neon Auth (Better Auth) and print a JWT for testing the API by hand.
//
// Neon Auth issues a session cookie on sign-in; its JWT plugin exchanges that cookie at /token for
// a short-lived JWT, which is what the API verifies against NEON_AUTH_JWKS_URL. Tokens expire
// after about 15 minutes; run this again to get a fresh one.
//
// Use a test account. The password is read with echo off and only sent to Neon Auth.
import { createInterface } from "node:readline/promises";

const jwksUrl = process.env.NEON_AUTH_JWKS_URL;
if (!jwksUrl) {
  console.error("NEON_AUTH_JWKS_URL is not set in apps/api/.env");
  process.exit(1);
}
const base = jwksUrl.replace(/\/\.well-known\/jwks\.json$/, "");
// Better Auth rejects cookie-based POSTs without a trusted Origin; its own origin is always trusted.
const origin = new URL(base).origin;

async function ask(question: string, hidden = false): Promise<string> {
  if (!hidden || !process.stdin.isTTY) {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const answer = await rl.question(question);
    rl.close();
    return answer.trim();
  }
  process.stdout.write(question);
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.setEncoding("utf8");
  return new Promise((resolve) => {
    let value = "";
    const onData = (ch: string) => {
      if (ch === "\r" || ch === "\n" || ch === "\u0004") {
        process.stdin.setRawMode(false);
        process.stdin.pause();
        process.stdin.off("data", onData);
        process.stdout.write("\n");
        resolve(value);
      } else if (ch === "\u0003") {
        process.exit(130); // Ctrl+C
      } else if (ch === "\u007f" || ch === "\b") {
        value = value.slice(0, -1);
      } else {
        value += ch;
      }
    };
    process.stdin.on("data", onData);
  });
}

// `npm run dev:signup` (dev-token.ts --sign-up) creates the account first. The Neon console's "Create user"
// dialog makes users without a password, so test accounts are created here instead.
const signUp = process.argv.includes("--sign-up");

const email = process.env.DEV_TOKEN_EMAIL || (await ask("Neon Auth email: "));
const name = signUp ? (await ask("Name: ")) || email.split("@")[0]! : "";
const password = await ask(
  signUp ? "Choose a password, 8+ characters (hidden): " : "Password (hidden): ",
  true,
);
if (signUp && password !== (await ask("Repeat password (hidden): ", true))) {
  console.error("Passwords don't match.");
  process.exit(1);
}

const signIn = await fetch(`${base}/${signUp ? "sign-up" : "sign-in"}/email`, {
  method: "POST",
  headers: { "Content-Type": "application/json", Origin: origin },
  body: JSON.stringify(signUp ? { email, password, name } : { email, password }),
});
if (!signIn.ok) {
  console.error(
    `${signUp ? "Sign-up" : "Sign-in"} failed (HTTP ${signIn.status}): ${(await signIn.text()).slice(0, 300)}`,
  );
  process.exit(1);
}
const cookie = signIn.headers
  .getSetCookie()
  .map((c) => c.split(";")[0])
  .join("; ");
const user = ((await signIn.json()) as { user?: { id: string } }).user;
if (!cookie) {
  console.error(
    "Neon Auth didn't start a session. If it requires email verification, turn that off for testing " +
      "(Neon console -> Better Auth -> settings), then run `npm run dev:token` to sign in.",
  );
  process.exit(1);
}

const tokenRes = await fetch(`${base}/token`, { headers: { Cookie: cookie, Origin: origin } });
if (!tokenRes.ok) {
  console.error(`Token exchange failed (HTTP ${tokenRes.status}): ${(await tokenRes.text()).slice(0, 300)}`);
  process.exit(1);
}
const { token } = (await tokenRes.json()) as { token: string };

console.log(
  `\nSigned in as ${email}${user ? ` (user id ${user.id})` : ""}. Token is valid for about 15 minutes.\n`,
);
console.log("PowerShell:");
console.log(`$env:TOKEN = "${token}"\n`);
console.log("Git Bash:");
console.log(`export TOKEN="${token}"`);
