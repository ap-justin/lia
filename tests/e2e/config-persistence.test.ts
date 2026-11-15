import { describe, expect, test } from "bun:test";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runLia } from "../evals/eval-helpers";

const serialTest = test.serial;

const NO_AUTH = {
  AI_GATEWAY_API_KEY: "",
  VERCEL_OIDC_TOKEN: "",
  LIA_MODEL: undefined,
  NO_COLOR: "1",
};

/** The names of the checks `lia doctor --json` failed, in order. */
function failedDoctorChecks(stdout: string): string[] {
  return JSON.parse(stdout).checks
    .filter((check: { status: string }) => check.status === "fail")
    .map((check: { name: string }) => check.name);
}

describe("config persistence", () => {
  serialTest("config diagnostics preserve invalid, oversized, and unsafe primaries", async () => {
    const root = mkdtempSync(join(tmpdir(), "lia-config-diagnostics-"));
    try {
      const home = join(root, "home");
      const workspace = join(root, "workspace");
      mkdirSync(join(home, ".lia"), { recursive: true, mode: 0o700 });
      mkdirSync(workspace);
      const workspaceRoot = realpathSync(workspace);
      const settingsPath = join(home, ".lia", "settings.json");

      const malformed = "{bad\n";
      writeFileSync(settingsPath, malformed, { mode: 0o600 });
      const malformedStatus = await runLia(["status", "--json"], {
        cwd: workspaceRoot,
        env: { HOME: home },
      });
      expect(malformedStatus.code).toBe(0);
      expect(malformedStatus.stderr).toContain("malformed_settings");
      expect(readFileSync(settingsPath, "utf8")).toBe(malformed);

      // statusLine is retired, so a value of any type loads without a warning.
      const retiredStatusLine = "{\"statusLine\":{\"context\":1}}\n";
      writeFileSync(settingsPath, retiredStatusLine, { mode: 0o600 });
      const retiredStatusLineStatus = await runLia(["status", "--json"], {
        cwd: workspaceRoot,
        env: { HOME: home },
      });
      expect(retiredStatusLineStatus.code).toBe(0);
      expect(retiredStatusLineStatus.stderr).not.toContain("malformed_settings");
      expect(readFileSync(settingsPath, "utf8")).toBe(retiredStatusLine);

      const inertOutputSettings =
        JSON.stringify({
          output_level: { legacy: true },
          workspaces: {
            [workspaceRoot]: {
              output_level: ["quiet", 7],
            },
          },
        }) + "\n";
      writeFileSync(settingsPath, inertOutputSettings, { mode: 0o600 });
      const inertStatus = await runLia(["status", "--json"], {
        cwd: workspaceRoot,
        env: { HOME: home },
      });
      expect(inertStatus.code).toBe(0);
      expect(inertStatus.stderr).not.toContain("legacy_workspace_preferences");
      // No credential here, so doctor's auth check fails and nothing else does.
      const inertDoctor = await runLia(["doctor", "--json"], {
        cwd: workspaceRoot,
        env: { ...NO_AUTH, HOME: home, LIA_DISABLE_KEYCHAIN: "1" },
      });
      expect(inertDoctor.code).toBe(1);
      expect(failedDoctorChecks(inertDoctor.stdout)).toEqual(["auth"]);
      expect(inertDoctor.stdout).not.toContain("legacy_workspace_preferences");

      expect(readFileSync(settingsPath, "utf8")).toBe(inertOutputSettings);

      const oversized = JSON.stringify({ padding: "x".repeat(65 * 1024) }) + "\n";
      writeFileSync(settingsPath, oversized, { mode: 0o600 });
      const oversizedDoctor = await runLia(["doctor", "--json"], {
        cwd: workspaceRoot,
        env: { ...NO_AUTH, HOME: home, LIA_DISABLE_KEYCHAIN: "1" },
      });
      expect(oversizedDoctor.code).toBe(1);
      expect(failedDoctorChecks(oversizedDoctor.stdout)).toEqual(["config", "auth"]);
      expect(oversizedDoctor.stdout).toContain("settings_too_large");
      expect(readFileSync(settingsPath, "utf8")).toBe(oversized);

      const external = join(root, "external-settings.json");
      writeFileSync(external, "{\"model\":\"external\"}\n", { mode: 0o600 });
      rmSync(settingsPath);
      symlinkSync(external, settingsPath);
      const unsafeStatus = await runLia(["status", "--json"], {
        cwd: workspaceRoot,
        env: { HOME: home },
      });
      expect(unsafeStatus.code).toBe(0);
      expect(unsafeStatus.stderr).toContain("durable_path_unsafe");
      expect(readFileSync(external, "utf8")).toBe("{\"model\":\"external\"}\n");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
