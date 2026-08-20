import { NextFunction, Request, RequestHandler, Response } from "express";

// Route params are single-valued in every route we register. The default
// ParamsDictionary widens values to string | string[], which every existing
// handler body would trip over once wrapping hides Express's path-string
// param inference.
type Params = Record<string, string>;

/** Wraps an async route handler so a rejected promise flows to the Express
 *  error middleware instead of crashing the process. Express 4 ignores the
 *  promise an async handler returns, so without this wrapper a rejected query
 *  is an unhandled rejection — fatal under Node's default
 *  --unhandled-rejections=throw. Every router registration must use it;
 *  route-error-handling.test.ts pins the wiring. */
export function asyncRoute(
  handler: (req: Request<Params>, res: Response) => Promise<unknown>
): RequestHandler<Params> {
  // Returns the caught promise — Express ignores it, but tests that invoke a
  // router layer's handle directly rely on awaiting the handler's completion.
  return (req: Request<Params>, res: Response, next: NextFunction) =>
    handler(req, res).catch(next);
}
