import { waitUntil as vercelWaitUntil } from "@vercel/functions";
import { currentDbScope } from "../db/index.js";
import { createChildLogger } from "../logger.js";

const log = createChildLogger("background");

type WaitUntil = (promise: Promise<unknown>) => void;

// 默认：Vercel 的 waitUntil（非 Vercel 环境下是 no-op，进程长驻无需保活）
let waitUntilImpl: WaitUntil = vercelWaitUntil;

/** 运行时适配：Cloudflare Workers 入口会注册 `cloudflare:workers` 的 waitUntil */
export function setWaitUntil(fn: WaitUntil) {
  waitUntilImpl = fn;
}

export function waitUntil(promise: Promise<unknown>) {
  waitUntilImpl(promise);
}

/**
 * 响应发出后再执行的后台任务。
 * - 长驻进程（VPS/Docker）：setImmediate 让出事件循环，进程不会被冻结，任务自然跑完
 * - Vercel / Workers：waitUntil 延长调用生命周期直到任务结束
 *   （Vercel 受函数 maxDuration 限制；Workers 响应后最多再给 30 秒）
 */
export function runInBackground(
  name: string,
  task: () => Promise<unknown>,
): void {
  const p = new Promise<void>((resolve) => setImmediate(resolve))
    .then(task)
    .catch((err) => log.error({ err, task: name }, "后台任务失败"));
  // per-request 数据库：登记任务，请求连接池要等它结束后才关闭
  currentDbScope()?.tasks.push(p);
  waitUntil(p);
}
