declare module "koa" {
  interface Request {
    body: unknown;
    rawBody?: Buffer;
  }
}

export {};
