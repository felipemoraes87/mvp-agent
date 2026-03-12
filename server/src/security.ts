import crypto from "node:crypto";

const SECRET_PATTERNS = [
  /-----BEGIN (?:RSA|EC|OPENSSH|PRIVATE) KEY-----/i,
  /(?:xox[baprs]-|ghp_|gho_|glpat-|AKIA[0-9A-Z]{16})/i,
  /(?:api[_-]?key|token|secret)\s*[:=]\s*['\"]?[A-Za-z0-9_\-]{12,}/i,
];

const INJECTION_PATTERNS = [
  /ignore\s+all\s+previous\s+instructions/i,
  /system\s*prompt/i,
  /do\s+anything\s+now/i,
  /bypass\s+security/i,
  /rm\s+-rf/i,
  /powershell\s+-enc/i,
  /curl\s+http/i,
];

export function sha256(input: string): string {
  return crypto.createHash("sha256").update(input).digest("hex");
}

export function sanitizeText(input: string): string {
  return input.replace(/[<>]/g, "").trim();
}

export function detectSecrets(input: string): boolean {
  return SECRET_PATTERNS.some((p) => p.test(input));
}

export function redactSecrets(input: string): string {
  let out = input;
  for (const pattern of SECRET_PATTERNS) {
    out = out.replace(pattern, "[REDACTED_SECRET]");
  }
  return out;
}

export function detectPromptInjection(input: string): boolean {
  return INJECTION_PATTERNS.some((p) => p.test(input));
}

export function validateSafeSimulationInput(input: string): { ok: boolean; reason?: string; sanitized: string } {
  const sanitized = sanitizeText(input);
  if (!sanitized) return { ok: false, reason: "Empty message", sanitized };
  if (detectSecrets(sanitized)) {
    return { ok: false, reason: "Secrets detected. Remove sensitive data before simulation.", sanitized: redactSecrets(sanitized) };
  }
  if (detectPromptInjection(sanitized)) {
    return { ok: false, reason: "Prompt-injection/unsafe content pattern detected.", sanitized };
  }
  return { ok: true, sanitized };
}
