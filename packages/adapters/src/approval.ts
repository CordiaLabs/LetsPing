import { z } from "zod";

import { letsPing } from "./vercel";
import { createLetsPingTool } from "./langchain";
import { createLetsPingCloudflareTool, createLetsPingCloudflareDeferTool, type CloudflareAdapterContext } from "./cloudflare";

export type ApprovalToolKind = "vercel" | "langchain" | "cloudflare";

export type CreateApprovalToolOptions<T extends z.ZodType> = {
  kind: ApprovalToolKind;
  name: string;
  description: string;
  schema: T;
  apiKey: string;
  service?: string;
  priority?: "low" | "medium" | "high" | "critical";
  timeoutMs?: number;
  timeout?: number;
  handler?: (args: z.infer<T>) => Promise<unknown> | unknown;
  cloudflare?: CloudflareAdapterContext;
  defer?: boolean;
  onIntercepted?: (params: { request_id: string; triage_url: string }) => void;
};

/**
 * Opinionated helper that returns the right LetsPing approval tool for your framework.
 *
 * - kind="vercel": returns a Vercel AI SDK CoreTool
 * - kind="langchain": returns a LangChain DynamicStructuredTool
 * - kind="cloudflare": returns an object with { name, description, schema, execute }
 */
export function createApprovalTool<T extends z.ZodType>(options: CreateApprovalToolOptions<T>) {
  if (options.kind === "vercel") {
    return letsPing({
      name: options.name,
      description: options.description,
      schema: options.schema,
      apiKey: options.apiKey,
      service: options.service,
      priority: options.priority,
      timeout: options.timeoutMs ?? options.timeout,
      handler: options.handler as any
    });
  }

  if (options.kind === "langchain") {
    return createLetsPingTool({
      name: options.name,
      description: options.description,
      schema: options.schema,
      apiKey: options.apiKey,
      service: options.service,
      priority: options.priority,
      timeout: options.timeoutMs ?? options.timeout,
      handler: options.handler as any
    });
  }

  if (options.kind === "cloudflare") {
    if (options.defer) {
      return createLetsPingCloudflareDeferTool({
        name: options.name,
        description: options.description,
        schema: options.schema,
        apiKey: options.apiKey,
        service: options.service,
        priority: options.priority,
        timeoutMs: options.timeoutMs ?? options.timeout,
        handler: options.handler as any,
        cloudflare: options.cloudflare,
        onIntercepted: options.onIntercepted
      });
    }
    return createLetsPingCloudflareTool({
      name: options.name,
      description: options.description,
      schema: options.schema,
      apiKey: options.apiKey,
      service: options.service,
      priority: options.priority,
      timeoutMs: options.timeoutMs ?? options.timeout,
      handler: options.handler as any,
      cloudflare: options.cloudflare
    });
  }

  const exhaustive: never = options.kind;
  return exhaustive;
}

