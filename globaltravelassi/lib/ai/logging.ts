/** Structured logs. Secret-looking fields are redacted before anything is printed. */
const SECRET_PATTERN = /(key|secret|token|password|authorization)/i;

export function redact(value: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) {
    out[k] = SECRET_PATTERN.test(k) ? "[redacted]" : v;
  }
  return out;
}

export interface Logger {
  info(event: string, fields?: Record<string, unknown>): void;
  error(event: string, fields?: Record<string, unknown>): void;
}

export const consoleLogger: Logger = {
  info(event, fields = {}) {
    console.log(JSON.stringify({ level: "info", event, ts: new Date().toISOString(), ...redact(fields) }));
  },
  error(event, fields = {}) {
    console.error(JSON.stringify({ level: "error", event, ts: new Date().toISOString(), ...redact(fields) }));
  },
};

export const silentLogger: Logger = { info() {}, error() {} };
