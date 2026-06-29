/**
 * logger.ts — structured JSON logging to stdout/stderr.
 * stdout-only approach: systemd/pm2 will capture output.
 * JSON lines format for grep/jq filtering.
 */

export function logError(context: string, err: unknown, extra?: Record<string, unknown>): void {
  const entry = {
    level: 'error',
    ts: new Date().toISOString(),
    ctx: context,
    msg: err instanceof Error ? err.message : String(err),
    stack: err instanceof Error ? err.stack : undefined,
    ...extra,
  };
  console.error(JSON.stringify(entry));
}

export function logInfo(context: string, msg: string, extra?: Record<string, unknown>): void {
  const entry = { level: 'info', ts: new Date().toISOString(), ctx: context, msg, ...extra };
  console.log(JSON.stringify(entry));
}
