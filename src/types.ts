// 扩展 Koa Request 类型，添加 body 和 rawBody
declare module "koa" {
  interface Request {
    body: unknown;
    rawBody?: Buffer;
  }
}

export {};
