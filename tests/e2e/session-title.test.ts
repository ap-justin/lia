import { expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LIA_BIN, runLia } from "../evals/eval-helpers";
import { logLines, rootSessionIds, storeRoot } from "./saved-sessions";
import {
  bearer,
  rotateLiaLogin,
  signInLiaLoginToTeam,
  startFakeIssuer,
  storedLiaLoginToken,
  unauthorized,
  writeLiaLogin,
} from "./lia-login-fakes";
import {
  fakeGatewayFinalText,
  startDynamicFakeGateway,
} from "./fake-gateway";

const MAIN_MODEL = "openai/gpt-5.5";
const TITLE_MODEL = "openai/gpt-5.6-luna";
const GENERATED_TITLE = "Renderer Loop Refactor";

type FixtureRoot = {
  root: string;
  home: string;
  workspace: string;
};

function createFixtureRoot(label: string, settings: string = "{}"): FixtureRoot {
  const root = realpathSync(mkdtempSync(join(tmpdir(), `lia-session-title-${label}-`)));
  const home = join(root, "home");
  const workspace = join(root, "workspace");
  mkdirSync(join(home, ".lia"), { recursive: true });
  mkdirSync(workspace, { recursive: true });
  writeFileSync(join(home, ".lia", "settings.json"), settings);
  return { root, home, workspace: realpathSync(workspace) };
}

function startTitleAwareGateway() {
  return startDynamicFakeGateway(_raw => fakeGatewayFinalText("MAIN_ANSWER_OK"), {
    models: [{ id: MAIN_MODEL, type: "language", tags: ["tool-use"] }],
    titleResponses: [fakeGatewayFinalText(GENERATED_TITLE)],
  });
}

function baseEnv(root: FixtureRoot, gateway: { baseUrl: string; chatUrl: string }) {
  return {
    PATH: process.env.PATH ?? "/usr/bin:/bin",
    HOME: root.home,
    AI_GATEWAY_API_KEY: "synthetic-title",
    LIA_DISABLE_KEYCHAIN: "1",
    LIA_E2E_DISABLE_DOTENV: "1",
    LIA_SOUND: "0",
    LIA_TEST_SKIP_ONBOARDING: "1",
    LIA_MODEL: MAIN_MODEL,
    LIA_PERMISSION_MODE: "full-access",
    LIA_MAX_AGENT_STEPS: "2",
    LIA_GATEWAY_BASE_URL: gateway.baseUrl,
    LIA_GATEWAY_CHAT_URL: gateway.chatUrl,
    LIA_TEST_GATEWAY_CHAT_URL: gateway.chatUrl,
    LIA_TEST_GATEWAY_MODELS_URL: `${gateway.baseUrl}/coding-agent/v1/models`,
  };
}

/// Each saved session's title: its log's newest title setting.
function sessionTitles(root: FixtureRoot): string[] {
  if (!existsSync(storeRoot(root.home))) return [];
  return rootSessionIds(root.home).flatMap((id) => {
    const title = (logLines(root.home, id) as any[]).filter((line) => line.kind === "set" && line.key === "title").at(-1)?.value;
    return typeof title === "string" ? [title] : [];
  });
}

function titleRequests(gateway: ReturnType<typeof startTitleAwareGateway>) {
  return gateway.titleRequests;
}

test("lia ask generates a model title for a fresh session", async () => {
  const root = createFixtureRoot("ask");
  const gateway = startTitleAwareGateway();
  try {
    const result = await runLia(["ask", "refactor the renderer loop to fix the crash"], {
      cwd: root.workspace,
      env: baseEnv(root, gateway),
      timeoutMs: 30_000,
    });
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("MAIN_ANSWER_OK");

    const titleCalls = titleRequests(gateway);
    expect(titleCalls.length).toBe(1);
    expect(titleCalls[0].headers.get("ai-language-model-id")).toBe(TITLE_MODEL);
    expect(titleCalls[0].body).toContain("refactor the renderer loop");

    expect(sessionTitles(root)).toContain(GENERATED_TITLE);

    const list = await runLia(["sessions", "--json"], {
      cwd: root.workspace,
      env: baseEnv(root, gateway),
      timeoutMs: 15_000,
    });
    expect(list.code).toBe(0);
    expect(list.stdout).toContain(GENERATED_TITLE);
  } finally {
    gateway.stop();
  }
});

test("lia ask keeps the derived title when session_titles is off", async () => {
  const root = createFixtureRoot("disabled", JSON.stringify({ session_titles: false }));
  const gateway = startTitleAwareGateway();
  try {
    const result = await runLia(["ask", "refactor the renderer loop to fix the crash"], {
      cwd: root.workspace,
      env: baseEnv(root, gateway),
      timeoutMs: 30_000,
    });
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("MAIN_ANSWER_OK");
    expect(titleRequests(gateway).length).toBe(0);
    expect(sessionTitles(root)).not.toContain(GENERATED_TITLE);
  } finally {
    gateway.stop();
  }
});

test("lia ask keeps the derived title when the title model output is unusable", async () => {
  const root = createFixtureRoot("unusable");
  const gateway = startDynamicFakeGateway(_raw => fakeGatewayFinalText("MAIN_ANSWER_OK"), {
    models: [{ id: MAIN_MODEL, type: "language", tags: ["tool-use"] }],
    titleResponses: [fakeGatewayFinalText("\n  \n")],
  });
  try {
    const result = await runLia(["ask", "refactor the renderer loop to fix the crash"], {
      cwd: root.workspace,
      env: baseEnv(root, gateway),
      timeoutMs: 30_000,
    });
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("MAIN_ANSWER_OK");
    const titles = sessionTitles(root);
    expect(titles.length).toBe(1);
    expect(titles[0]).not.toBe(GENERATED_TITLE);
    expect(titles[0].length).toBeGreaterThan(0);
  } finally {
    gateway.stop();
  }
});

test("lia ask exits soon after its answer while the title request never answers", async () => {
  const root = createFixtureRoot("title-hang");
  let titleArrived = false;
  const gateway = startDynamicFakeGateway(_raw => fakeGatewayFinalText("MAIN_ANSWER_OK"), {
    models: [{ id: MAIN_MODEL, type: "language", tags: ["tool-use"] }],
    titleResponses: [() => {
      titleArrived = true;
      return new Promise<Response>(() => {});
    }],
  });
  try {
    const started = Date.now();
    const result = await runLia(["ask", "refactor the renderer loop to fix the crash"], {
      cwd: root.workspace,
      env: baseEnv(root, gateway),
      timeoutMs: 30_000,
    });
    const elapsedMs = Date.now() - started;
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("MAIN_ANSWER_OK");
    expect(titleArrived).toBe(true);
    // The title call's own deadline is 15 s; lia gives it a short grace after
    // the answer and then leaves.
    expect(elapsedMs).toBeLessThan(8_000);

    // The session keeps the title derived from its first prompt.
    const titles = sessionTitles(root);
    expect(titles).toHaveLength(1);
    expect(titles[0]).toContain("refactor the renderer loop");
    const list = await runLia(["sessions", "--json"], {
      cwd: root.workspace,
      env: baseEnv(root, gateway),
      timeoutMs: 15_000,
    });
    expect(list.code).toBe(0);
    expect(list.stdout).toContain(titles[0]);
  } finally {
    gateway.stop();
    rmSync(root.root, { recursive: true, force: true });
  }
}, 45_000);

test("lia ask keeps a generated title that arrives soon after its answer", async () => {
  const root = createFixtureRoot("title-late");
  const gateway = startDynamicFakeGateway(_raw => fakeGatewayFinalText("MAIN_ANSWER_OK"), {
    models: [{ id: MAIN_MODEL, type: "language", tags: ["tool-use"] }],
    titleResponses: [() => Bun.sleep(1_000).then(() => fakeGatewayFinalText(GENERATED_TITLE))],
  });
  try {
    const result = await runLia(["ask", "refactor the renderer loop to fix the crash"], {
      cwd: root.workspace,
      env: baseEnv(root, gateway),
      timeoutMs: 30_000,
    });
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("MAIN_ANSWER_OK");
    expect(sessionTitles(root)).toContain(GENERATED_TITLE);
  } finally {
    gateway.stop();
    rmSync(root.root, { recursive: true, force: true });
  }
}, 45_000);

test("lia ask exits promptly on SIGINT while its title request never answers", async () => {
  const root = createFixtureRoot("interrupt");
  let chatArrived!: () => void;
  let titleArrived!: () => void;
  const chatRequest = new Promise<void>((resolve) => { chatArrived = resolve; });
  const titleRequest = new Promise<void>((resolve) => { titleArrived = resolve; });
  // Neither request ever gets response headers.
  const gateway = startDynamicFakeGateway(() => {
    chatArrived();
    return new Promise<Response>(() => {});
  }, {
    models: [{ id: MAIN_MODEL, type: "language", tags: ["tool-use"] }],
    titleResponses: [() => {
      titleArrived();
      return new Promise<Response>(() => {});
    }],
  });
  const child = Bun.spawn([LIA_BIN, "ask", "refactor the renderer loop to fix the crash"], {
    cwd: root.workspace,
    env: baseEnv(root, gateway),
    stdout: "pipe",
    stderr: "pipe",
  });
  try {
    await Promise.all([chatRequest, titleRequest]);
    const signalledAt = Date.now();
    child.kill("SIGINT");
    // The title call's own deadline is 15 s, so an exit that waits for it
    // lands far past this bound.
    const code = await Promise.race([child.exited, Bun.sleep(8_000).then(() => null)]);
    expect(Date.now() - signalledAt).toBeLessThan(2_000);
    expect(code).toBe(130);
  } finally {
    if (child.exitCode === null) child.kill("SIGKILL");
    await child.exited;
    gateway.stop();
    rmSync(root.root, { recursive: true, force: true });
  }
}, 30_000);

// Title requests made with a refreshable sign-in. Another lia process can
// refresh the shared lia login after this one has read it, so the token it holds
// in memory is rejected while the store already holds a newer one. The title
// request sends the stored token, and after a 401 sends once more only with a
// stored token that replaced the rejected one. It never refreshes the login
// itself (tests/tla/session_title/SessionTitle.tla BackgroundNeverRefreshes).

const FIRST_PROMPT = "refactor the renderer loop to fix the crash";

function loginEnv(root: FixtureRoot, gateway: { baseUrl: string; chatUrl: string }, issuer: { issuerUrl: string }) {
  return {
    ...baseEnv(root, gateway),
    AI_GATEWAY_API_KEY: undefined,
    VERCEL_OIDC_TOKEN: undefined,
    LIA_TEST_OAUTH_ISSUER_URL: issuer.issuerUrl,
    LIA_OAUTH_CLIENT_ID: "test-client",
    LIA_NO_OPEN_BROWSER: "1",
  };
}

/// A title channel that answers with the generated title only for `accepts`.
function titleFor(accepts: (token: string) => boolean) {
  return (_body: string, headers: Headers) =>
    accepts(bearer(headers)) ? fakeGatewayFinalText(GENERATED_TITLE) : unauthorized();
}

function titleTokens(gateway: ReturnType<typeof startDynamicFakeGateway>): string[] {
  return gateway.titleRequests.map((request) => bearer(request.headers));
}

function lastTitle(root: FixtureRoot): string | undefined {
  return sessionTitles(root).at(-1);
}

function startLoginGateway(titles: Array<(body: string, headers: Headers) => Response>) {
  return startDynamicFakeGateway(_raw => fakeGatewayFinalText("MAIN_ANSWER_OK"), {
    models: [{ id: MAIN_MODEL, type: "language", tags: ["tool-use"] }],
    titleResponses: titles,
  });
}

async function askWithLogin(label: string, titles: (home: string) => Array<(body: string, headers: Headers) => Response>) {
  const root = createFixtureRoot(label);
  const issuer = startFakeIssuer({ refresh: () => "unexpected-refresh" });
  writeLiaLogin(root.home, issuer.issuerUrl, "launch-token");
  const gateway = startLoginGateway(titles(root.home));
  try {
    const result = await runLia(["ask", FIRST_PROMPT], { cwd: root.workspace, env: loginEnv(root, gateway, issuer), timeoutMs: 30_000 });
    expect(result.code, result.stderr).toBe(0);
    expect(result.stdout).toContain("MAIN_ANSWER_OK");
    // A title request never refreshes the login all lia processes share.
    expect(issuer.refreshes).toHaveLength(0);
    return { tokens: titleTokens(gateway), title: lastTitle(root), stored: storedLiaLoginToken(root.home) };
  } finally {
    gateway.stop();
    issuer.stop();
    rmSync(root.root, { recursive: true, force: true });
  }
}

test("lia ask keeps the derived title without refreshing the login when the gateway rejects the stored one", async () => {
  const rejected = titleFor(() => false);
  const run = await askWithLogin("login-401-stored", () => [rejected, rejected]);
  expect(run.tokens).toEqual(["launch-token"]);
  expect(run.stored).toBe("launch-token");
  expect(run.title).toContain("refactor the renderer loop");
}, 45_000);

test("lia ask sends a rejected title with the login another lia already renewed, without refreshing", async () => {
  const accept = titleFor((token) => token === "other-lia-token");
  // The first title request arrives after another lia renewed the login.
  const run = await askWithLogin("login-401-renewed-elsewhere", (home) => [(body, headers) => {
    rotateLiaLogin(home, "other-lia-token");
    return accept(body, headers);
  }, accept, accept]);
  expect(run.tokens).toEqual(["launch-token", "other-lia-token"]);
  expect(run.title).toBe(GENERATED_TITLE);
}, 45_000);

test("lia ask sends the title at most twice while another lia keeps renewing the login", async () => {
  let renewals = 0;
  const run = await askWithLogin("login-401-always", (home) => Array.from({ length: 3 }, () => () => {
    renewals += 1;
    rotateLiaLogin(home, `other-lia-token-${renewals}`);
    return unauthorized();
  }));
  expect(run.tokens).toEqual(["launch-token", "other-lia-token-1"]);
  expect(run.title).toContain("refactor the renderer loop");
}, 45_000);

test("lia ask never sends the title with the login another lia signed in to another team", async () => {
  const any = titleFor(() => true);
  const run = await askWithLogin("login-other-team", (home) => [() => {
    signInLiaLoginToTeam(home, "other-team-token", "team_other");
    return unauthorized();
  }, any, any]);
  expect(run.tokens).toEqual(["launch-token"]);
  expect(run.stored).toBe("other-team-token");
  expect(run.title).toContain("refactor the renderer loop");
}, 45_000);

test("lia ask does not send the title again when the gateway refuses it with 403", async () => {
  const forbidden = () => Response.json({ error: { message: "Model not allowed", type: "permission_error" } }, { status: 403 });
  const run = await askWithLogin("login-403", (home) => [() => {
    rotateLiaLogin(home, "other-lia-token");
    return forbidden();
  }, forbidden]);
  expect(run.tokens).toEqual(["launch-token"]);
}, 45_000);

test("lia ask sends a static key's rejected title once", async () => {
  const root = createFixtureRoot("static-key-401");
  const rejected = titleFor(() => false);
  const gateway = startLoginGateway([rejected, rejected]);
  try {
    const result = await runLia(["ask", FIRST_PROMPT], { cwd: root.workspace, env: baseEnv(root, gateway), timeoutMs: 30_000 });
    expect(result.code, result.stderr).toBe(0);
    expect(titleTokens(gateway)).toEqual(["synthetic-title"]);
    expect(lastTitle(root)).toContain("refactor the renderer loop");
  } finally {
    gateway.stop();
    rmSync(root.root, { recursive: true, force: true });
  }
}, 45_000);
