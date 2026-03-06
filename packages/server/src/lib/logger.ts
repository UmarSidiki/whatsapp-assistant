// Structured logger. Off by default — set LOG_ENABLED=true to enable.
const enabled = process.env.LOG_ENABLED === "true";

const fmt = (level: string, msg: string, data?: unknown) => {
  const ts = new Date().toISOString();
  return data
    ? `[${ts}] ${level.toUpperCase()} ${msg} ${JSON.stringify(data)}`
    : `[${ts}] ${level.toUpperCase()} ${msg}`;
};

export const logger = {
  info: (msg: string, data?: unknown) =>
    enabled && console.log(fmt("info", msg, data)),
  warn: (msg: string, data?: unknown) =>
    enabled && console.warn(fmt("warn", msg, data)),
  error: (msg: string, data?: unknown) =>
    enabled && console.error(fmt("error", msg, data)),
  debug: (msg: string, data?: unknown) =>
    enabled && console.debug(fmt("debug", msg, data)),
};
