import { IncomingMessage, ServerResponse } from "node:http";
import { Socket } from "node:net";
import type { Express } from "express";

/** Run the real Express middleware stack without binding a test TCP port. */
export function appRequest(
  app: Express,
  method: string,
  path: string,
  headers: Record<string, string> = {},
  body?: unknown
): Promise<{ status: number; body: any; headers: Record<string, any> }> {
  return new Promise((resolve, reject) => {
    const socket = new Socket();
    Object.defineProperty(socket, "remoteAddress", { value: "127.0.0.1" });
    const req = new IncomingMessage(socket);
    req.method = method;
    req.url = path;
    req.headers = Object.fromEntries(Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]));
    const payload = body === undefined ? undefined : JSON.stringify(body);
    if (payload !== undefined) {
      req.headers["content-type"] = "application/json";
      req.headers["content-length"] = String(Buffer.byteLength(payload));
      req.push(payload);
    }
    req.push(null);
    const res = new ServerResponse(req);
    res.end = ((chunk?: any) => {
      const text = chunk === undefined ? "" : Buffer.isBuffer(chunk) ? chunk.toString() : String(chunk);
      let result: unknown = text;
      if (text && res.getHeader("content-type")?.toString().includes("application/json")) result = JSON.parse(text);
      resolve({ status: res.statusCode, body: result, headers: res.getHeaders() });
      res.emit("finish");
      return res;
    }) as typeof res.end;
    app(req as any, res as any, (error?: unknown) => {
      if (error) reject(error);
      else { res.statusCode = 404; res.end(); }
    });
  });
}
