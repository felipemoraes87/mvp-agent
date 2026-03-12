export const config = {
  port: Number(process.env.PORT || 8787),
  appOrigin: process.env.APP_ORIGIN || "http://localhost:5173",
  appOrigins: (process.env.APP_ORIGINS || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean),
  sessionSecret: process.env.SESSION_SECRET || "dev-session-secret",
  configHmacSecret: process.env.CONFIG_HMAC_SECRET || "dev-config-secret",
  storeSimulationContent: (process.env.STORE_SIMULATION_CONTENT || "false") === "true",
  auditRetentionDays: Number(process.env.AUDIT_RETENTION_DAYS || 30),
  agnoBaseUrl: process.env.AGNO_BASE_URL || "http://localhost:8010",
  agnoEnabled: (process.env.AGNO_ENABLED || "true") === "true",
};
