import fs from "node:fs";

const DEFAULT_SESSION_SECRET = "dev-session-secret";
const DEFAULT_CONFIG_HMAC_SECRET = "dev-config-secret";

function readSecret(name: string, fallback?: string): string | undefined {
  const filePath = process.env[`${name}_FILE`];
  if (filePath) {
    try {
      return fs.readFileSync(filePath, "utf8").trim();
    } catch {
      return fallback;
    }
  }
  return process.env[name] || fallback;
}

function readNumber(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export const config = {
  port: readNumber(process.env.PORT, 8787),
  appOrigin: process.env.APP_ORIGIN || "http://localhost:5173",
  appOrigins: (process.env.APP_ORIGINS || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean),
  sessionSecret: readSecret("SESSION_SECRET", DEFAULT_SESSION_SECRET) || DEFAULT_SESSION_SECRET,
  configHmacSecret: readSecret("CONFIG_HMAC_SECRET", DEFAULT_CONFIG_HMAC_SECRET) || DEFAULT_CONFIG_HMAC_SECRET,
  storeSimulationContent: (process.env.STORE_SIMULATION_CONTENT || "false") === "true",
  auditRetentionDays: readNumber(process.env.AUDIT_RETENTION_DAYS, 30),
  agnoBaseUrl: process.env.AGNO_BASE_URL || "http://localhost:8010",
  agnoEnabled: (process.env.AGNO_ENABLED || "true") === "true",
};

export function validateConfigForRuntime(): void {
  const isProduction = process.env.NODE_ENV === "production";
  if (!isProduction) return;

  const invalidSecrets: string[] = [];
  if (config.sessionSecret === DEFAULT_SESSION_SECRET) invalidSecrets.push("SESSION_SECRET");
  if (config.configHmacSecret === DEFAULT_CONFIG_HMAC_SECRET) invalidSecrets.push("CONFIG_HMAC_SECRET");

  if (invalidSecrets.length) {
    throw new Error(`Missing secure production secrets: ${invalidSecrets.join(", ")}`);
  }
}
