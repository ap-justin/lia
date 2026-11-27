// lia doctor through the built binary: each check against a local stand-in
// that works, fails, or hangs on purpose.
import { afterEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync, realpathSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { createConfiguredProviderFixture } from "./fixtures/chat-completions";
import { join } from "node:path";
import { cleanupIsolatedTestHome, createIsolatedTestHome, LIA_BIN } from "../evals/eval-helpers";

const MODEL = "fake/doctor-model";
const MODERN_FIXTURE = join(import.meta.dirname, "fixtures", "mcp-modern-stdio.mjs");
const TIMEOUT = 40_000;

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()!();
});

type Root = { root: string; home: string; workspace: string; bin: string };

function makeRoot(): Root {
  const root = createIsolatedTestHome();
  cleanups.push(() => cleanupIsolatedTestHome(root));
  const home = join(root, "home");
  const workspace = join(root, "workspace");
  const bin = join(root, "bin");
  for (const dir of [join(home, ".lia"), workspace, bin]) mkdirSync(dir, { recursive: true, mode: 0o700 });
  return { root, home, workspace, bin };
}

/** A gateway that serves the models list, with `answer` deciding each reply. */
function gateway(answer: (req: Request) => Response | Promise<Response>) {
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    idleTimeout: 0,
    fetch(req) {
      if (new URL(req.url).pathname !== "/coding-agent/v1/models") return new Response("not found", { status: 404 });
      return answer(req);
    },
  });
  cleanups.push(() => server.stop(true));
  const base = `http://127.0.0.1:${server.port}`;
  return { LIA_GATEWAY_BASE_URL: base, LIA_TEST_GATEWAY_MODELS_URL: `${base}/coding-agent/v1/models` };
}

const models = (ids: string[]) => Response.json({ data: ids.map((id) => ({ id, type: "language", tags: ["tool-use"] })) });
const acceptingGateway = () => gateway(() => models([MODEL]));

/**
 * Only the parent's locale and temp folder pass through, so no credential in
 * it, such as GH_TOKEN, GITHUB_TOKEN, or AI_GATEWAY_API_KEY, reaches doctor or
 * its children. PATH is the test's own bin folder alone, so a gh or lia the
 * machine has never runs; fixtures name every other tool by its full path.
 */
const PASSED_ENV = ["TMPDIR", "LANG", "LC_ALL", "LC_CTYPE", "TZ"];

function env(r: Root, extra: Record<string, string | undefined> = {}): Record<string, string> {
  const merged: Record<string, string | undefined> = {
    ...Object.fromEntries(PASSED_ENV.map((k) => [k, process.env[k]])),
    HOME: r.home,
    PATH: r.bin,
    LIA_SOUND: "0",
    LIA_DISABLE_KEYCHAIN: "1",
    LIA_MODEL: MODEL,
    ...extra,
  };
  return Object.fromEntries(Object.entries(merged).filter(([, v]) => v !== undefined)) as Record<string, string>;
}

/** doctor's text report: a check line is two spaces, its mark, its name in
 * a column, and its detail; its fix, when it has one, is the next line. */
const MARK = { ok: "\u2713", warn: "!", fail: "\u2717" } as const;
const FIX = `${" ".repeat(15)}fix: `;

/** A RegExp source for the start of a check line, up to its detail. */
function rowStart(status: keyof typeof MARK, name: string): string {
  return `^  ${MARK[status]} ${name} +`;
}

/** The warn and fail lines in text output that no `fix:` line follows. */
function problemsWithoutFix(stdout: string): string[] {
  const lines = stdout.split("\n");
  return lines.filter((line, i) => /^  (!|✗) /.test(line) && !(lines[i + 1] ?? "").startsWith(FIX));
}

async function doctor(r: Root, environment: Record<string, string>, args: string[] = [], cwd = r.workspace) {
  const started = performance.now();
  const proc = Bun.spawn([LIA_BIN, "doctor", ...args], { env: environment, cwd, stdout: "pipe", stderr: "pipe" });
  const killer = setTimeout(() => proc.kill("SIGKILL"), 30_000);
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  clearTimeout(killer);
  // Every problem doctor reports comes with a fix, in text and in JSON.
  if (code === 0 || code === 1) {
    if (args.includes("--json")) {
      const unfixed = JSON.parse(stdout).checks.filter((check: any) => check.status !== "ok" && !check.fix);
      expect(unfixed).toEqual([]);
    } else {
      expect(problemsWithoutFix(stdout)).toEqual([]);
    }
  }
  return { stdout, stderr, code, ms: performance.now() - started };
}

/** Processes whose command line contains `marker`. */
function running(marker: string): string {
  return spawnSync("/usr/bin/pgrep", ["-f", marker]).stdout.toString().trim();
}

/** An lia login with no team, which loads only the public model list. */
function writeTeamlessLiaLogin(home: string) {
  writeFileSync(join(home, ".lia", "auth.json"), JSON.stringify({
    version: 1, issuer: "https://vercel.com", client_id: "test-client", access_token: "doctor-teamless-token",
    refresh_token: "doctor-refresh", expires_at_ms: Date.now() + 3_600_000, scope: "openid", token_type: "Bearer",
  }) + "\n", { mode: 0o600 });
}

function writeScript(path: string, body: string) {
  writeFileSync(path, `#!/bin/sh\n${body}\n`);
  chmodSync(path, 0o755);
}

/** A git repository at the workspace, with `origin` at `url` when given. */
function gitRepo(r: Root, url: string | null = "https://github.com/example/repo.git") {
  expect(spawnSync("/usr/bin/git", ["init", "-q", r.workspace]).status).toBe(0);
  if (url) expect(spawnSync("/usr/bin/git", ["-C", r.workspace, "remote", "add", "origin", url]).status).toBe(0);
}

describe("lia doctor provider", () => {
  test("a refused key fails even when the public model list loads", async () => {
    const r = makeRoot();
    const g = gateway((req) => req.headers.get("authorization") ? new Response("unauthorized", { status: 401 }) : models([MODEL]));
    const result = await doctor(r, env(r, { ...g, AI_GATEWAY_API_KEY: "doctor-refused-key" }));
    expect(result.stdout).toMatch(/^  ✗ auth +/m);
    expect(result.stdout).toContain("lia login");
    expect(result.stdout).not.toContain("doctor-refused-key");
    expect(result.code).toBe(1);
  }, TIMEOUT);

  test("a gateway error, a rate limit, and an unreadable answer each say what happened", async () => {
    const cases: Array<[() => Response, number, RegExp, string]> = [
      [() => new Response("boom", { status: 500 }), 1, /^  ✗ provider +AI Gateway answered the check with an error$/m, "run lia doctor again later"],
      [() => new Response("slow down", { status: 429 }), 0, /^  ! provider +AI Gateway rate-limited the check/m, "run lia doctor again in a minute"],
      [() => new Response("not json", { status: 200, headers: { "content-type": "application/json" } }), 1, /^  ✗ provider +AI Gateway sent a model list lia cannot read$/m, "run lia doctor again later"],
    ];
    for (const [answer, code, line, fix] of cases) {
      const r = makeRoot();
      const result = await doctor(r, env(r, { ...gateway(answer), AI_GATEWAY_API_KEY: "doctor-key" }));
      expect(result.code).toBe(code);
      expect(result.stdout).toMatch(line);
      expect(result.stdout).toContain(`${FIX}${fix}`);
      expect(result.stdout).toMatch(/^  ! auth +.*the provider did not confirm it$/m);
    }
  }, 60_000);

  test("a model the provider does not list fails", async () => {
    const r = makeRoot();
    const result = await doctor(r, env(r, { ...acceptingGateway(), AI_GATEWAY_API_KEY: "doctor-key", LIA_MODEL: "nope/missing" }));
    expect(result.stdout).toMatch(/^  ✓ auth +/m);
    expect(result.stdout).toMatch(/^  ✗ model +.*nope\/missing/m);
    expect(result.stdout).toContain("lia models");
    expect(result.code).toBe(1);
  }, TIMEOUT);

  test("a gateway that never answers fails inside the time limit", async () => {
    const r = makeRoot();
    const g = gateway(() => new Promise<Response>(() => {}));
    const result = await doctor(r, env(r, { ...g, AI_GATEWAY_API_KEY: "doctor-key", LIA_TEST_DOCTOR_DEADLINE_MS: "1000" }));
    expect(result.ms).toBeLessThan(4_000);
    expect(result.stdout).toMatch(/^  ✗ provider +could not reach AI Gateway in 1 s$/m);
    expect(result.code).toBe(1);
  }, TIMEOUT);

  test("an answer just inside the deadline counts and one just past it does not", async () => {
    const early = makeRoot();
    const fast = gateway(async () => {
      await Bun.sleep(200);
      return models([MODEL]);
    });
    const inside = await doctor(early, env(early, { ...fast, AI_GATEWAY_API_KEY: "doctor-key", LIA_TEST_DOCTOR_DEADLINE_MS: "1500" }));
    expect(inside.stdout).toMatch(/^  ✓ auth +/m);
    expect(inside.stdout).toMatch(/^  ✓ model +/m);

    const late = makeRoot();
    const slow = gateway(async () => {
      await Bun.sleep(2_500);
      return models([MODEL]);
    });
    const past = await doctor(late, env(late, { ...slow, AI_GATEWAY_API_KEY: "doctor-key", LIA_TEST_DOCTOR_DEADLINE_MS: "1000" }));
    expect(past.stdout).toMatch(/^  ✗ provider +.*could not reach/m);
    expect(past.stdout).not.toMatch(/^  ✓ auth +/m);
  }, TIMEOUT);

  test("a public list does not confirm the credential, and a team-less lia login is told to pick a team", async () => {
    const r = makeRoot();
    writeTeamlessLiaLogin(r.home);
    let authorized = 0;
    let anonymous = 0;
    const g = gateway((req) => {
      if (req.headers.get("authorization")) authorized += 1;
      else anonymous += 1;
      return models([MODEL]);
    });
    const result = await doctor(r, env(r, g));
    expect(authorized).toBe(0);
    expect(anonymous).toBe(1);
    expect(result.stdout).not.toContain("accepted the credential");
    expect(result.stdout).toMatch(/^  ! auth +AI Gateway sent only its public model list, so the credential is not confirmed\n               fix: lia teams$/m);
    expect(result.stdout).not.toContain("doctor-teamless-token");
  }, TIMEOUT);

  test("a configured provider is not asked, so nothing claims it accepted the credential", async () => {
    const f = createConfiguredProviderFixture();
    cleanups.push(() => f.close());
    f.settings.provider = "remote";
    f.save();
    const r: Root = { root: f.home, home: f.home, workspace: f.workspace, bin: join(f.home, "bin") };
    mkdirSync(r.bin, { mode: 0o700 });
    const result = await doctor(r, env(r, { LIA_MODEL: undefined, LIA_TEST_PROVIDER_TOKEN: "wrong-token" }));
    expect(f.requests).toEqual([]);
    expect(result.stdout).not.toContain("accepted the credential");
    expect(result.stdout).not.toMatch(/^  [✓!✗] (provider|model) +/m);
    expect(result.stdout).toMatch(/^  ✓ auth +/m);
  }, TIMEOUT);

  test("with no credential the auth check fails without any request", async () => {
    const r = makeRoot();
    let hits = 0;
    const g = gateway(() => {
      hits += 1;
      return models([MODEL]);
    });
    const result = await doctor(r, env(r, { ...g }));
    expect(result.stdout).toMatch(/^  ✗ auth +/m);
    expect(result.stdout).toContain("lia login");
    expect(hits).toBe(0);
    expect(result.code).toBe(1);
  }, TIMEOUT);
});

describe("lia doctor exit code and output", () => {
  test("warnings alone exit 0", async () => {
    const r = makeRoot();
    const result = await doctor(r, env(r, { ...acceptingGateway(), AI_GATEWAY_API_KEY: "doctor-key" }));
    expect(result.stdout).not.toMatch(/^  ✗ /m);
    expect(result.stdout).toMatch(/^  ! /m);
    expect(result.code).toBe(0);
  }, TIMEOUT);

  test("--json carries the version, each fix, and the same exit code", async () => {
    const r = makeRoot();
    const result = await doctor(r, env(r, { ...acceptingGateway() }), ["--json"]);
    const json = JSON.parse(result.stdout);
    expect(typeof json.version).toBe("string");
    const auth = json.checks.find((check: any) => check.name === "auth");
    expect(auth.status).toBe("fail");
    expect(auth.fix).toContain("lia login");
    expect(json.fail_count).toBeGreaterThan(0);
    expect(result.code).toBe(1);
  }, TIMEOUT);

  test("the text report shows what doctor ran with, each check under its group, and the totals, with no color in a pipe", async () => {
    const r = makeRoot();
    gitRepo(r);
    const result = await doctor(r, env(r, { ...acceptingGateway(), AI_GATEWAY_API_KEY: "doctor-key" }));
    const out = result.stdout;
    expect(out).toMatch(/^lia doctor  lia \S+\n\n/);
    expect(out).toContain(`  Workspace    ${realpathSync(r.workspace)}\n`);
    expect(out).toContain(`  Model        ${MODEL}\n`);
    expect(out).toContain("  Auth         AI_GATEWAY_API_KEY\n");
    expect(out).toMatch(/^  Permissions  \S+$/m);
    expect(out).toMatch(/^  Step limit   \S+$/m);
    // Groups come in a fixed order, each under its own heading.
    const headings = out.split("\n").filter((line) => /^[A-Z]/.test(line));
    expect(headings).toEqual(["Install", "Config", "Auth and model", "Sessions", "Tools"]);
    const tools = out.slice(out.indexOf("\nTools\n"));
    expect(tools).toMatch(/^  ✓ git +/m);
    expect(out).toMatch(/\n\n\d+ ok \u00b7 \d+ warnings? \u00b7 0 failures\n$/);
    expect(out).not.toContain("[doctor]");
    expect(out).not.toContain("\x1b");
    expect(result.code).toBe(0);
  }, TIMEOUT);

  test("--help names --fix and --deep, and a bad flag still exits 2, named as the flag that is wrong", async () => {
    const r = makeRoot();
    const help = await doctor(r, env(r), ["--help"]);
    expect(help.stdout).toContain("--fix");
    expect(help.stdout).toContain("--deep");
    const bad = await doctor(r, env(r), ["--nope"]);
    expect(bad.code).toBe(2);
    const afterFix = await doctor(r, env(r), ["--fix", "--bogus"]);
    expect(afterFix.code).toBe(2);
    expect(afterFix.stderr).toContain("lia doctor: unknown flag --bogus");
    expect(afterFix.stderr).not.toContain("unknown flag --fix");
    const json = await doctor(r, env(r), ["--json", "--fix", "--bogus"]);
    expect(json.code).toBe(2);
    expect(JSON.parse(json.stdout).error).toBe("unknown flag --bogus");
  }, TIMEOUT);
});

describe("lia doctor local checks", () => {
  test("a malformed settings file fails with its path, and a bad env value says what lia uses", async () => {
    const r = makeRoot();
    writeFileSync(join(r.home, ".lia", "settings.json"), "{not json");
    const result = await doctor(r, env(r, { ...acceptingGateway(), AI_GATEWAY_API_KEY: "doctor-key", LIA_PERMISSION_MODE: "garbage", LIA_MAX_AGENT_STEPS: "abc" }));
    expect(result.stdout).toMatch(/^  ✗ config +.*settings\.json/m);
    expect(result.stdout).not.toMatch(/no config files found/);
    expect(result.stdout).toMatch(/^  ! env +LIA_PERMISSION_MODE=garbage .*auto/m);
    expect(result.stdout).toMatch(/^  ! env +LIA_MAX_AGENT_STEPS=abc /m);
    expect(result.code).toBe(1);
  }, TIMEOUT);

  test("git is found from a repository subfolder and missing outside one", async () => {
    const r = makeRoot();
    expect(spawnSync("/usr/bin/git", ["init", "-q", r.workspace]).status).toBe(0);
    const sub = join(r.workspace, "src", "deep");
    mkdirSync(sub, { recursive: true });
    const inside = await doctor(r, env(r, { ...acceptingGateway(), AI_GATEWAY_API_KEY: "doctor-key" }), [], sub);
    expect(inside.stdout).toMatch(/^  ✓ git +/m);

    const outside = makeRoot();
    const away = await doctor(outside, env(outside, { ...acceptingGateway(), AI_GATEWAY_API_KEY: "doctor-key" }));
    expect(away.stdout).toMatch(/^  ! git +/m);
  }, TIMEOUT);

  test("lia has no GitHub CLI check: a gh on PATH is never run", async () => {
    const r = makeRoot();
    gitRepo(r);
    const ran = join(r.root, "gh-ran");
    writeScript(join(r.bin, "gh"), `: > '${ran}'`);
    const result = await doctor(r, env(r, { ...acceptingGateway(), AI_GATEWAY_API_KEY: "doctor-key" }));
    expect(result.stdout).toMatch(/^  ✓ git +/m);
    expect(result.stdout).not.toMatch(/^\[(ok|warn|fail)\] gh: /m);
    expect(existsSync(ran)).toBe(false);
  }, TIMEOUT);

  test("install shows the version and warns about another lia on PATH", async () => {
    const r = makeRoot();
    writeScript(join(r.bin, "lia"), "exit 0");
    const result = await doctor(r, env(r, { ...acceptingGateway(), AI_GATEWAY_API_KEY: "doctor-key" }));
    expect(result.stdout).toMatch(/^  ✓ install +lia \S+ at /m);
    expect(result.stdout).toMatch(new RegExp(`${rowStart("warn", "install")}.*${r.bin.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/lia`, "m"));
  }, TIMEOUT);

  test("a skill file that does not load shows with its path", async () => {
    const r = makeRoot();
    const skill = join(r.workspace, ".agents", "skills", "broken");
    mkdirSync(skill, { recursive: true });
    writeFileSync(join(skill, "SKILL.md"), "---\nname: not a safe name/../x\n---\nbody\n");
    const result = await doctor(r, env(r, { ...acceptingGateway(), AI_GATEWAY_API_KEY: "doctor-key" }));
    expect(result.stdout).toMatch(/^  ! skills +.*broken/m);
  }, TIMEOUT);
});

describe("lia doctor MCP", () => {
  test("each server gets its own line, a hanging one fails in time, and an unapproved one never starts", async () => {
    const r = makeRoot();
    const hang = Bun.serve({ hostname: "127.0.0.1", port: 0, idleTimeout: 0, fetch: () => new Promise<Response>(() => {}) });
    cleanups.push(() => hang.stop(true));
    const marker = join(r.root, "project-server-started");
    writeFileSync(join(r.home, ".lia", "mcp.json"), JSON.stringify({
      mcp: {
        ready1: { command: [process.execPath, MODERN_FIXTURE] },
        hang1: { type: "http", url: `http://127.0.0.1:${hang.port}/mcp`, startup_timeout_ms: 60_000 },
      },
    }));
    writeFileSync(join(r.workspace, ".mcp.json"), JSON.stringify({
      mcpServers: { project: { command: "/bin/sh", args: ["-c", `: > '${marker}'; /bin/sleep 30`] } },
    }));
    const trace = join(r.root, "trace.log");
    const result = await doctor(r, env(r, { ...acceptingGateway(), AI_GATEWAY_API_KEY: "doctor-key", LIA_TEST_DOCTOR_DEADLINE_MS: "3000", LIA_TRACE_LOG: trace, LIA_TRACE_SCOPES: "doctor" }));
    expect(result.ms).toBeLessThan(6_000);
    // Doctor itself starts a check only for an approved server.
    const started = readFileSync(trace, "utf8");
    expect(started).toContain("starting check ready1");
    expect(started).not.toContain("starting check project");
    expect(result.stdout).toMatch(/^  ✓ mcp +ready1\b/m);
    expect(result.stdout).toMatch(/^  ✗ mcp +hang1 did not answer in \d+\.\d s, when doctor's 3 s limit ended$/m);
    expect(result.stdout).toMatch(/^  ! mcp +project .*approv/m);
    await Bun.sleep(300);
    expect(existsSync(marker)).toBe(false);
    expect(result.code).toBe(1);
  }, TIMEOUT);

  test("each server's row in the report says what doctor found for it", async () => {
    const r = makeRoot();
    writeFileSync(join(r.home, ".lia", "mcp.json"), JSON.stringify({
      mcp: {
        ready1: { command: [process.execPath, MODERN_FIXTURE] },
        broken: { command: ["/bin/sh", "-c", "exit 0"] },
      },
    }));
    writeFileSync(join(r.workspace, ".mcp.json"), JSON.stringify({ mcpServers: { project: { command: "/bin/sh", args: ["-c", "exit 0"] } } }));
    const result = await doctor(r, env(r, { ...acceptingGateway(), AI_GATEWAY_API_KEY: "doctor-key", LIA_TEST_DOCTOR_DEADLINE_MS: "3000" }), ["--json"]);
    const report = JSON.parse(result.stdout);
    expect(report.mcp.connection_check).toBe("checked");
    const row = (name: string) => report.mcp.servers.find((s: any) => s.name === name);
    expect([row("ready1").connection, row("ready1").authentication]).toEqual(["ready", "ok"]);
    expect([row("broken").connection, row("broken").authentication]).toEqual(["failed", "not_checked"]);
    // An unapproved server gets no child, so doctor did not check it.
    expect([row("project").connection, row("project").authentication]).toEqual(["not_checked", "not_checked"]);
    expect(report.checks.find((c: any) => c.name === "mcp" && c.detail.startsWith("ready1")).status).toBe("ok");
    expect(report.checks.find((c: any) => c.name === "mcp" && c.detail.startsWith("broken")).status).toBe("fail");
  }, TIMEOUT);

  test("a server whose name starts with a dash is not checked, and says why and how to fix it", async () => {
    const r = makeRoot();
    writeFileSync(join(r.home, ".lia", "mcp.json"), JSON.stringify({
      mcp: {
        "--help": { command: [process.execPath, MODERN_FIXTURE] },
        "-x": { command: [process.execPath, MODERN_FIXTURE] },
        "-s": { type: "sse", url: "https://mcp.invalid.example/rpc" },
        "-h": { type: "http", url: "https://mcp.invalid.example/mcp", bearer_token_env: "NOPE_TOKEN_1677" },
        normal: { command: [process.execPath, MODERN_FIXTURE] },
      },
    }));
    // A project server waits for approval, which `lia mcp approve -w` cannot give.
    writeFileSync(join(r.workspace, ".mcp.json"), JSON.stringify({ mcpServers: { "-w": { command: "/bin/sh", args: ["-c", "exit 0"] } } }));
    const trace = join(r.root, "trace.log");
    const result = await doctor(r, env(r, { ...acceptingGateway(), AI_GATEWAY_API_KEY: "doctor-key", LIA_TEST_DOCTOR_DEADLINE_MS: "3000", LIA_TRACE_LOG: trace, LIA_TRACE_SCOPES: "doctor" }));
    for (const name of ["--help", "-x"]) {
      expect(result.stdout).toContain(`  ! mcp        ${name} was not checked: lia mcp show reads a name that starts with "-" as an option\n               fix: rename the server in ~/.lia/mcp.json so its name does not start with "-"\n`);
      expect(readFileSync(trace, "utf8")).not.toContain(`starting check ${name}`);
    }
    expect(result.stdout).toContain('  ! mcp        -s uses a transport lia does not support\n               fix: rename the server in ~/.lia/mcp.json so its name does not start with "-"\n');
    // Also in a state whose fix would otherwise name the variable to set.
    expect(result.stdout).toContain('  ✗ mcp        -h needs NOPE_TOKEN_1677\n               fix: rename the server in ~/.lia/mcp.json so its name does not start with "-"\n');
    expect(result.stdout).toContain('  ! mcp        -w is waiting for approval\n               fix: rename the server in .mcp.json so its name does not start with "-"\n');
    expect(result.stdout).not.toMatch(/fix: lia mcp \w+ -/);
    expect(result.stdout).toMatch(/^  ✓ mcp +normal ready, 1 tool$/m);
    expect(result.code).toBe(1);
  }, TIMEOUT);

  test("a fix line passes a server name from .mcp.json to a shell as one word, and runs as written", async () => {
    const r = makeRoot();
    const marker = join(r.root, "pwned");
    const names = [`x; touch '${marker}' #`, `$(touch '${marker}2')`, "it's `id`", "two words"];
    writeFileSync(join(r.workspace, ".mcp.json"), JSON.stringify({
      mcpServers: Object.fromEntries(names.map((name) => [name, { command: "/bin/sh", args: ["-c", "exit 0"] }])),
    }));
    const result = await doctor(r, env(r));
    const fixes = result.stdout.split("\n").filter((line) => line.startsWith(`${FIX}lia mcp approve `)).map((line) => line.slice(FIX.length));
    expect(fixes).toHaveLength(names.length);
    // A stand-in lia records the words a shell hands it.
    const fake = join(r.root, "fake-bin");
    mkdirSync(fake);
    const argsLog = join(r.root, "args.log");
    writeScript(join(fake, "lia"), `for a in "$@"; do printf '[%s]' "$a"; done >> '${argsLog}'; echo >> '${argsLog}'`);
    for (const fix of fixes) expect(spawnSync("/bin/sh", ["-c", fix], { env: { PATH: `${fake}:/usr/bin:/bin` } }).status).toBe(0);
    expect(existsSync(marker) || existsSync(`${marker}2`)).toBe(false);
    const got = readFileSync(argsLog, "utf8").trim().split("\n").sort();
    expect(got).toEqual(names.map((name) => `[mcp][approve][${name}]`).sort());

    // The real lia approves each one from the same line.
    const real = join(r.root, "real-bin");
    mkdirSync(real);
    symlinkSync(LIA_BIN, join(real, "lia"));
    for (const fix of fixes) {
      expect(spawnSync("/bin/sh", ["-c", fix], { cwd: r.workspace, env: env(r, { PATH: `${real}:/usr/bin:/bin` }) }).status).toBe(0);
    }
    expect(existsSync(marker) || existsSync(`${marker}2`)).toBe(false);
    const after = await doctor(r, env(r));
    expect(after.stdout).not.toContain("is waiting for approval");
  }, TIMEOUT);

  test("SIGINT or SIGTERM while doctor starts its checks leaves no check and no server running", async () => {
    const r = makeRoot();
    // Names and a server line unique to this run, so no other lia on the
    // machine matches them.
    const run = `${process.pid}${Date.now() % 100_000}`;
    const check = `mcp show sig${run}_`;
    const server = `sleep 55.${run}`;
    const mcp: Record<string, unknown> = {};
    // Servers that ignore SIGTERM, so only doctor's kill of each check with
    // everything it started ends them at once.
    for (let i = 0; i < 50; i++) mcp[`sig${run}_${i}`] = { command: ["/bin/sh", "-c", `trap '' TERM; exec /bin/${server}`] };
    writeFileSync(join(r.home, ".lia", "mcp.json"), JSON.stringify({ mcp }));
    cleanups.push(() => {
      spawnSync("/usr/bin/pkill", ["-KILL", "-f", server]);
      spawnSync("/usr/bin/pkill", ["-KILL", "-f", check]);
    });
    for (const signal of ["SIGINT", "SIGTERM"] as const) {
      for (const delay of [0, 10, 40]) {
        const proc = Bun.spawn([LIA_BIN, "doctor"], { env: env(r, { LIA_TEST_DOCTOR_DEADLINE_MS: "30000" }), cwd: r.workspace, stdout: "ignore", stderr: "ignore" });
        const started = performance.now();
        while (running(check) === "" && performance.now() - started < 10_000) await Bun.sleep(1);
        if (delay > 0) await Bun.sleep(delay);
        proc.kill(signal);
        await proc.exited;
        expect(proc.signalCode).toBe(signal);
        expect(running(check)).toBe("");
        await Bun.sleep(3_000);
        expect(running(server)).toBe("");
      }
    }
  }, 120_000);

  test("a project .mcp.json that skips servers fails with a fix, as ~/.lia/mcp.json does", async () => {
    const unreadable = makeRoot();
    writeFileSync(join(unreadable.workspace, ".mcp.json"), "{not json\n");
    const whole = await doctor(unreadable, env(unreadable, { ...acceptingGateway(), AI_GATEWAY_API_KEY: "doctor-key" }));
    expect(whole.stdout).toContain("  ✗ mcp_config .mcp.json server 'unknown' was skipped: invalid_json.\n               fix: fix .mcp.json, then run lia doctor again\n");
    expect(whole.code).toBe(1);

    const oneBad = makeRoot();
    writeFileSync(join(oneBad.workspace, ".mcp.json"), JSON.stringify({ mcpServers: { odd: { type: "weird", url: "x" }, docs: { command: "/bin/sh", args: ["-c", "exit 0"] } } }));
    const entry = await doctor(oneBad, env(oneBad, { ...acceptingGateway(), AI_GATEWAY_API_KEY: "doctor-key" }));
    expect(entry.stdout).toContain("  ✗ mcp_config .mcp.json server 'odd' was skipped: its \"type\" isn't valid.\n               fix: fix .mcp.json, then run lia doctor again\n");
    expect(entry.stdout).toMatch(/^  ! mcp +docs is waiting for approval$/m);
    expect(entry.code).toBe(1);
  }, TIMEOUT);

  test("servers doctor could not start before its deadline each get a line that says so", async () => {
    const r = makeRoot();
    // More servers than doctor checks at once (16 at most). A check of one
    // never ends on its own, so no slot frees before the 1 ms deadline, and
    // the servers past the cap are never started: dropped by the start
    // cutoff when a slot is free and too little of the limit is left, or at
    // the limit when every slot is still taken.
    const names = Array.from({ length: 20 }, (_, i) => `late${i}`);
    const mcp: Record<string, unknown> = {};
    for (const name of names) mcp[name] = { command: "/bin/sh", args: ["-c", `: > '${join(r.root, name)}'; /bin/sleep 30`] };
    writeFileSync(join(r.home, ".lia", "mcp.json"), JSON.stringify({ mcp }));
    const trace = join(r.root, "trace.log");
    const result = await doctor(r, env(r, { LIA_TEST_DOCTOR_DEADLINE_MS: "1", LIA_TRACE_LOG: trace, LIA_TRACE_SCOPES: "doctor" }));
    expect(result.code).toBe(1);
    const cutoff = "was not checked: too little of doctor's 1 s limit was left to start it";
    const atLimit = "was not checked: doctor reached its 1 s limit before it could start the check";
    const notChecked = names.filter((name) => {
      expect(result.stdout).toMatch(new RegExp(`${rowStart("fail", "mcp")}${name} (${cutoff}|${atLimit}|did not answer in \\d+\\.\\d s, when doctor's 1 s limit ended)\\n               fix: lia mcp show ${name}$`, "m"));
      return result.stdout.includes(`  ✗ mcp        ${name} was not checked`);
    });
    expect(notChecked.length).toBeGreaterThanOrEqual(names.length - 16);
    for (const name of notChecked) expect(existsSync(join(r.root, name))).toBe(false);
    // The trace names every check doctor dropped without starting it, with
    // the reason its line gives.
    const traced = readFileSync(trace, "utf8");
    for (const name of notChecked) {
      const why = result.stdout.includes(`  ✗ mcp        ${name} ${cutoff}`) ? "too little of doctor's limit was left to start it" : "doctor's limit came while it waited for a slot";
      expect(traced.split(`check ${name} was never started, since ${why}; dropping it`).length).toBe(2);
    }
    spawnSync("/usr/bin/pkill", ["-KILL", "-f", `${r.root}/late`]);
  }, TIMEOUT);

  test("with more servers than doctor checks at once, each is checked as a slot frees", async () => {
    const r = makeRoot();
    const mcp: Record<string, unknown> = {};
    for (let i = 0; i < 24; i++) mcp[`queued${i}`] = { command: [process.execPath, MODERN_FIXTURE] };
    writeFileSync(join(r.home, ".lia", "mcp.json"), JSON.stringify({ mcp }));
    const result = await doctor(r, env(r, { ...acceptingGateway(), AI_GATEWAY_API_KEY: "doctor-key", LIA_TEST_DOCTOR_DEADLINE_MS: "30000" }));
    expect((result.stdout.match(/^  ✓ mcp +queued\d+ ready, 1 tool$/gm) ?? []).length).toBe(24);
    expect(result.code).toBe(0);
  }, TIMEOUT);

  test("a healthy server with thousands of tools is ready, however long its answer", async () => {
    const r = makeRoot();
    const server = join(r.root, "many-tools.mjs");
    writeFileSync(server, [
      'import { createInterface } from "node:readline";',
      'const tools = Array.from({ length: 3000 }, (_, i) => ({ name: `tool_${i}`, description: "d".repeat(120), inputSchema: { type: "object", properties: {} } }));',
      'createInterface({ input: process.stdin }).on("line", (line) => {',
      '  const m = JSON.parse(line);',
      '  if (m.id === undefined) return;',
      '  const result = m.method === "initialize" ? { protocolVersion: m.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: "many", version: "1" } } : m.method === "tools/list" ? { tools } : {};',
      '  process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: m.id, result }) + "\\n");',
      '});',
    ].join("\n"));
    writeFileSync(join(r.home, ".lia", "mcp.json"), JSON.stringify({ mcp: { many: { command: [process.execPath, server] } } }));
    const e = env(r, { ...acceptingGateway(), AI_GATEWAY_API_KEY: "doctor-key" });
    const shown = spawnSync(LIA_BIN, ["mcp", "show", "many", "--json"], { env: e, cwd: r.workspace });
    expect(shown.status).toBe(0);
    expect(shown.stdout.length).toBeGreaterThan(64 * 1024);
    const result = await doctor(r, e);
    expect(result.stdout).toMatch(/^  ✓ mcp +many ready, 3000 tools$/m);
  }, TIMEOUT);

  test("no MCP servers configured adds no MCP line", async () => {
    const r = makeRoot();
    const result = await doctor(r, env(r, { ...acceptingGateway(), AI_GATEWAY_API_KEY: "doctor-key" }));
    expect(result.stdout).not.toMatch(/^  [✓!✗] mcp +/m);
  }, TIMEOUT);
});

describe("lia doctor cleanup", () => {
  test("old side folders are listed without --fix and removed only with it", async () => {
    const r = makeRoot();
    const files = join(r.home, ".lia", "session-files");
    const old = join(files, "OldOrphan0001");
    const young = join(files, "NewOrphan0002");
    for (const dir of [old, young]) mkdirSync(dir, { recursive: true, mode: 0o700 });
    const twoDaysAgo = (Date.now() - 2 * 24 * 3600 * 1000) / 1000;
    utimesSync(old, twoDaysAgo, twoDaysAgo);
    const e = env(r, { ...acceptingGateway(), AI_GATEWAY_API_KEY: "doctor-key" });

    const look = await doctor(r, e);
    expect(look.stdout).toContain("lia doctor --fix");
    expect(existsSync(old)).toBe(true);

    const fix = await doctor(r, e, ["--fix"]);
    expect(fix.stdout).toMatch(/removed 1 /);
    expect(existsSync(old)).toBe(false);
    expect(existsSync(young)).toBe(true);
  }, TIMEOUT);
});
