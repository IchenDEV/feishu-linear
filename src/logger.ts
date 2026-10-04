import pino from "pino";

export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  transport:
    // pino-pretty 依赖 worker_threads，Workers（DB_MODE=per-request）里不可用
    process.env.NODE_ENV !== "production" &&
    process.env.DB_MODE !== "per-request"
      ? { target: "pino-pretty", options: { colorize: true } }
      : undefined,
});

export function createChildLogger(name: string) {
  return logger.child({ module: name });
}
