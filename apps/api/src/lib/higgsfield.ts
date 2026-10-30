import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const CLI_BIN = process.env.HIGGSFIELD_CLI_PATH ?? "higgsfield";
const CLI_TIMEOUT_MS = Number(process.env.HIGGSFIELD_CLI_TIMEOUT_MS ?? 15_000);
const CACHE_TTL_MS = Number(process.env.HIGGSFIELD_STATUS_CACHE_MS ?? 10_000);

export type HiggsfieldStatus =
  | "healthy"
  | "cli_not_installed"
  | "unauthenticated"
  | "out_of_credits"
  | "error";

export interface HiggsfieldStatusResponse {
  status: HiggsfieldStatus;
  ok: boolean;
  message: string;
  checkedAt: string;
  cli?: {
    installed: boolean;
    version?: string;
  };
  account?: {
    workspaceId?: string;
    workspaceName?: string | null;
    plan?: string | null;
    credits?: number;
  };
  error?: string;
}

interface CliResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

interface HiggsfieldWorkspace {
  id: string;
  name: string | null;
  plan_type: string | null;
  credits: number;
  is_selected: boolean;
  user_role: string | null;
}

class CliNotInstalledError extends Error {
  constructor() {
    super(`Higgsfield CLI not found (tried "${CLI_BIN}").`);
    this.name = "CliNotInstalledError";
  }
}

class CliTimeoutError extends Error {
  constructor() {
    super(`Higgsfield CLI timed out after ${CLI_TIMEOUT_MS}ms.`);
    this.name = "CliTimeoutError";
  }
}

async function runCli(args: string[]): Promise<CliResult> {
  try {
    const { stdout, stderr } = await execFileAsync(CLI_BIN, args, {
      timeout: CLI_TIMEOUT_MS,
      maxBuffer: 1024 * 1024,
      env: { ...process.env, NO_COLOR: "1" },
    });

    return { stdout, stderr, exitCode: 0 };
  } catch (error) {
    const err = error as NodeJS.ErrnoException & {
      stdout?: string;
      stderr?: string;
      code?: number | string;
      killed?: boolean;
      signal?: string;
    };

    if (err.code === "ENOENT") {
      throw new CliNotInstalledError();
    }

    if (err.killed || err.signal) {
      throw new CliTimeoutError();
    }

    return {
      stdout: err.stdout ?? "",
      stderr: err.stderr ?? "",
      exitCode: typeof err.code === "number" ? err.code : 1,
    };
  }
}

function isAuthError(result: CliResult): boolean {
  const output = `${result.stderr}\n${result.stdout}`;

  return (
    result.exitCode === 2 ||
    /not authenticated|session expired|unauthori[sz]ed|invalid token|401|auth login/i.test(
      output,
    )
  );
}

function parseVersion(stdout: string): string | undefined {
  const match = stdout.match(/^higgsfield\s+(\S+)/m);
  return match?.[1];
}

export interface ImageCostParams {
  model: string;
  aspectRatio?: string;
  resolution?: string;
  quality?: string;
  extras?: Record<string, string>;
}

export class CostEstimateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CostEstimateError";
  }
}

/**
 * Estimated credits for one generation, via `higgsfield generate cost` — the
 * CLI prices the request without creating a job. Costs only depend on the
 * model and its params, so a placeholder prompt satisfies models that require
 * one; prompt text is intentionally not part of the request.
 */
export async function estimateImageCost({
  model,
  aspectRatio,
  resolution,
  quality,
  extras,
}: ImageCostParams): Promise<number> {
  const args = ["generate", "cost", model, "--json", "--prompt", " "];

  if (aspectRatio) args.push("--aspect_ratio", aspectRatio);
  if (resolution) args.push("--resolution", resolution);
  if (quality) args.push("--quality", quality);

  for (const [key, value] of Object.entries(extras ?? {})) {
    args.push(`--${key}`, value);
  }

  const result = await runCli(args);

  if (result.exitCode !== 0) {
    const message = (result.stderr || result.stdout).trim();
    throw new CostEstimateError(message || "Could not estimate the cost.");
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(result.stdout);
  } catch {
    throw new CostEstimateError("Unexpected `generate cost` output.");
  }

  const credits = (parsed as { credits?: unknown } | null)?.credits;

  if (typeof credits !== "number" || !Number.isFinite(credits) || credits < 0) {
    throw new CostEstimateError("Unexpected `generate cost` output.");
  }

  return credits;
}

function parseWorkspaces(stdout: string): HiggsfieldWorkspace[] {
  const parsed: unknown = JSON.parse(stdout);

  if (!Array.isArray(parsed)) {
    throw new Error("Unexpected `higgsfield workspace list --json` output.");
  }

  return parsed as HiggsfieldWorkspace[];
}

function pickWorkspace(
  workspaces: HiggsfieldWorkspace[],
): HiggsfieldWorkspace | undefined {
  const selected = workspaces.find((workspace) => workspace.is_selected);

  if (selected) {
    return selected;
  }

  return workspaces.reduce<HiggsfieldWorkspace | undefined>(
    (best, workspace) =>
      best === undefined || workspace.credits > best.credits ? workspace : best,
    undefined,
  );
}

function response(
  status: HiggsfieldStatus,
  message: string,
  extra: Omit<
    HiggsfieldStatusResponse,
    "status" | "ok" | "message" | "checkedAt"
  > = {},
): HiggsfieldStatusResponse {
  return {
    status,
    ok: status === "healthy",
    message,
    checkedAt: new Date().toISOString(),
    ...extra,
  };
}

let cached: { expiresAt: number; value: HiggsfieldStatusResponse } | undefined;
let inFlight: Promise<HiggsfieldStatusResponse> | undefined;

async function checkHiggsfieldStatus(): Promise<HiggsfieldStatusResponse> {
  let cli: HiggsfieldStatusResponse["cli"];

  try {
    const versionResult = await runCli(["version"]);

    if (versionResult.exitCode !== 0) {
      return response("error", "The Higgsfield CLI failed to run.", {
        cli: { installed: true },
        error: (versionResult.stderr || versionResult.stdout).trim(),
      });
    }

    cli = {
      installed: true,
      version: parseVersion(versionResult.stdout),
    };
  } catch (error) {
    if (error instanceof CliNotInstalledError) {
      return response(
        "cli_not_installed",
        "The Higgsfield CLI is not installed or not available on PATH.",
        { cli: { installed: false }, error: error.message },
      );
    }

    return response("error", "Unable to check the Higgsfield CLI.", {
      error: error instanceof Error ? error.message : String(error),
    });
  }

  try {
    const tokenResult = await runCli(["auth", "token"]);

    if (tokenResult.exitCode !== 0 || tokenResult.stdout.trim() === "") {
      return response(
        "unauthenticated",
        "The Higgsfield CLI is not authenticated. Run `higgsfield auth login`.",
        { cli },
      );
    }
  } catch (error) {
    return response("error", "Unable to check Higgsfield authentication.", {
      cli,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  let workspace: HiggsfieldWorkspace | undefined;

  try {
    const workspaceResult = await runCli(["workspace", "list", "--json"]);

    if (workspaceResult.exitCode !== 0) {
      if (isAuthError(workspaceResult)) {
        return response(
          "unauthenticated",
          "The Higgsfield CLI session is expired or invalid. Run `higgsfield auth login`.",
          { cli },
        );
      }

      return response("error", "Unable to read Higgsfield workspaces.", {
        cli,
        error: (workspaceResult.stderr || workspaceResult.stdout).trim(),
      });
    }

    workspace = pickWorkspace(parseWorkspaces(workspaceResult.stdout));
  } catch (error) {
    return response("error", "Unable to read Higgsfield workspaces.", {
      cli,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  const account = workspace
    ? {
        workspaceId: workspace.id,
        workspaceName: workspace.name,
        plan: workspace.plan_type,
        credits: workspace.credits,
      }
    : undefined;

  if (workspace && workspace.credits <= 0) {
    return response(
      "out_of_credits",
      "The Higgsfield account has no credits left.",
      { cli, account },
    );
  }

  return response("healthy", "The Higgsfield CLI is ready.", { cli, account });
}

export async function getHiggsfieldStatus({
  refresh = false,
}: { refresh?: boolean } = {}): Promise<HiggsfieldStatusResponse> {
  const now = Date.now();

  if (!refresh && cached && cached.expiresAt > now) {
    return cached.value;
  }

  if (!refresh && inFlight) {
    return inFlight;
  }

  const pending = checkHiggsfieldStatus()
    .then((value) => {
      cached = { expiresAt: Date.now() + CACHE_TTL_MS, value };
      return value;
    })
    .finally(() => {
      inFlight = undefined;
    });

  inFlight = pending;

  return pending;
}
