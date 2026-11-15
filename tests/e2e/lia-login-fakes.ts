// A refreshable lia login for tests: writeLiaLogin seeds ~/.lia/auth.json the
// way `lia login` saves it when LIA_DISABLE_KEYCHAIN=1 is set, rotateLiaLogin
// stands in for another lia process that refreshed the same login, and
// startFakeIssuer answers discovery, token refreshes, and team lookups. Pass
// the issuer's URL to lia as LIA_TEST_OAUTH_ISSUER_URL.
import { chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const LIA_LOGIN_TEAM_ID = "team_fixture";

export function liaLoginPath(home: string): string {
  return join(home, ".lia", "auth.json");
}

export function writeLiaLogin(
  home: string,
  issuerUrl: string,
  accessToken: string,
  options: { refreshToken?: string; expiresAtMs?: number } = {},
): void {
  const liaDir = join(home, ".lia");
  mkdirSync(liaDir, { recursive: true, mode: 0o700 });
  chmodSync(liaDir, 0o700);
  writeLoginFile(home, {
    version: 1,
    issuer: issuerUrl,
    client_id: "test-client",
    access_token: accessToken,
    refresh_token: options.refreshToken ?? "seeded-refresh-token",
    expires_at_ms: options.expiresAtMs ?? Date.now() + 60 * 60 * 1000,
    scope: "openid offline_access use:ai-gateway",
    token_type: "Bearer",
    team_id: LIA_LOGIN_TEAM_ID,
    team_slug: "example-team",
  });
}

/// Saves a new access token into the login another lia process shares, as its
/// own refresh would. The file is replaced in one rename.
export function rotateLiaLogin(home: string, accessToken: string, refreshToken = `${accessToken}-refresh`): void {
  const login = JSON.parse(readFileSync(liaLoginPath(home), "utf8"));
  login.access_token = accessToken;
  login.refresh_token = refreshToken;
  login.expires_at_ms = Date.now() + 60 * 60 * 1000;
  writeLoginFile(home, login);
}

/// Saves a login for another team, as `lia login` in another lia process would.
export function signInLiaLoginToTeam(home: string, accessToken: string, teamId: string): void {
  const login = JSON.parse(readFileSync(liaLoginPath(home), "utf8"));
  login.access_token = accessToken;
  login.refresh_token = `${accessToken}-refresh`;
  login.expires_at_ms = Date.now() + 60 * 60 * 1000;
  login.team_id = teamId;
  login.team_slug = `${teamId}-slug`;
  writeLoginFile(home, login);
}

/// The access token the login file holds now.
export function storedLiaLoginToken(home: string): string {
  return JSON.parse(readFileSync(liaLoginPath(home), "utf8")).access_token;
}

function writeLoginFile(home: string, login: Record<string, unknown>): void {
  const path = liaLoginPath(home);
  const staged = `${path}.rotating`;
  writeFileSync(staged, JSON.stringify(login) + "\n", { mode: 0o600 });
  chmodSync(staged, 0o600);
  renameSync(staged, path);
}

export type FakeIssuerOptions = {
  /// The access token each refresh issues, or a Response to send instead,
  /// such as a 500 or an invalid_grant error. Called once per refresh.
  refresh?: (count: number) => string | Response | Promise<string | Response>;
};

export function startFakeIssuer(options: FakeIssuerOptions = {}) {
  const refreshes: Array<{ body: string; at: number }> = [];
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      const url = new URL(request.url);
      const issuer = `http://127.0.0.1:${server.port}`;
      if (url.pathname === "/.well-known/openid-configuration") {
        return Response.json({
          issuer,
          device_authorization_endpoint: `${issuer}/oauth/device`,
          token_endpoint: `${issuer}/oauth/token`,
          revocation_endpoint: `${issuer}/oauth/revoke`,
        });
      }
      if (url.pathname === "/oauth/token") {
        refreshes.push({ body: await request.text(), at: Date.now() });
        const issued = await (options.refresh ?? ((count) => `issued-token-${count}`))(refreshes.length);
        if (issued instanceof Response) return issued;
        return Response.json({
          access_token: issued,
          refresh_token: `${issued}-refresh`,
          expires_in: 3600,
          scope: "openid offline_access use:ai-gateway",
          token_type: "Bearer",
        });
      }
      if (url.pathname === "/v2/teams") {
        return Response.json({ teams: [{ id: LIA_LOGIN_TEAM_ID, slug: "example-team", name: "Example Team" }] });
      }
      if (url.pathname === "/oauth/revoke") return Response.json({ revoked: true });
      return new Response("not found", { status: 404 });
    },
  });
  return {
    issuerUrl: `http://127.0.0.1:${server.port}`,
    refreshes,
    stop() {
      server.stop(true);
    },
  };
}

/// A gateway answer for a request whose bearer token it no longer accepts.
export function unauthorized(): Response {
  return Response.json({ error: { message: "Invalid token", type: "authentication_error" } }, { status: 401 });
}

export function bearer(headers: Headers): string {
  return (headers.get("authorization") ?? "").replace(/^Bearer /, "");
}
