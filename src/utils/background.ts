import { waitUntil } from "@vercel/functions";
import { createChildLogger } from "../logger.js";

const log = createChildLogger("background");

/**
 * 响应发出后再执行的后台任务。
 * - 长驻进程（VPS/Docker）：setImmediate 让出事件循环，进程不会被冻结，任务自然跑完
 * - Vercel：waitUntil 延长函数生命周期直到任务结束（受函数 maxDuration 限制）
 */
export function runInBackground(
  name: string,
  task: () => Promise<unknown>,
): void {
  const p = new Promise<void>((resolve) => setImmediate(resolve))
    .then(task)
    .catch((err) => log.error({ err, task: name }, "后台任务失败"));
  waitUntil(p);
}
