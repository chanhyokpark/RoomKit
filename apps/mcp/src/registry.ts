import { z } from 'zod';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { ApiClient, ApiError } from './http.js';
import { toInputJsonSchema } from './schemas.js';
import { SessionState, ToolError } from './session.js';
import type { VirtualDeviceManager } from './virtual-device.js';

export interface ToolContext {
  api: ApiClient;
  state: SessionState;
  devices: VirtualDeviceManager;
}

export interface ToolDef<S extends z.ZodType = z.ZodType> {
  name: string;
  description: string;
  inputSchema: S;
  handler: (input: z.infer<S>, ctx: ToolContext) => Promise<unknown>;
}

/** Identity helper that ties the handler's input type to the schema. */
export function defineTool<S extends z.ZodType>(def: ToolDef<S>): ToolDef {
  return def as unknown as ToolDef;
}

export interface ResourceDef {
  uri: string;
  name: string;
  description: string;
  mimeType: string;
  text: () => string | Promise<string>;
}

/**
 * Registers tools on the low-level Server, converting each zod input schema
 * to JSON Schema ourselves and validating call arguments ourselves — the SDK
 * never sees a zod object, so its zod-version interop is irrelevant.
 */
export function createServer(
  tools: ToolDef[],
  resources: ResourceDef[],
  ctx: ToolContext,
): Server {
  const server = new Server(
    { name: 'roomkit', version: '0.2.0' },
    { capabilities: { tools: {}, resources: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, () => ({
    tools: tools.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: toInputJsonSchema(t.inputSchema) as { type: 'object' },
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const tool = tools.find((t) => t.name === req.params.name);
    if (!tool) return errorResult(`Unknown tool: ${req.params.name}`);

    let input: unknown;
    try {
      input = tool.inputSchema.parse(req.params.arguments ?? {});
    } catch (err) {
      if (err instanceof z.ZodError) {
        return errorResult(
          `Input validation failed:\n${z.prettifyError(err)}\n\nCall describe_commands / describe_asset_kind for the exact JSON shapes.`,
        );
      }
      return errorResult(String(err));
    }

    try {
      const result = await tool.handler(input, ctx);
      return {
        content: [
          {
            type: 'text' as const,
            text:
              result === undefined
                ? 'OK'
                : typeof result === 'string'
                  ? result
                  : JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (err) {
      return errorResult(describeError(err));
    }
  });

  server.setRequestHandler(ListResourcesRequestSchema, () => ({
    resources: resources.map(({ uri, name, description, mimeType }) => ({
      uri,
      name,
      description,
      mimeType,
    })),
  }));

  server.setRequestHandler(ReadResourceRequestSchema, async (req) => {
    const resource = resources.find((r) => r.uri === req.params.uri);
    if (!resource) throw new Error(`Unknown resource: ${req.params.uri}`);
    return {
      contents: [
        { uri: resource.uri, mimeType: resource.mimeType, text: await resource.text() },
      ],
    };
  });

  return server;
}

function errorResult(text: string) {
  return { content: [{ type: 'text' as const, text }], isError: true };
}

function describeError(err: unknown): string {
  if (err instanceof ApiError) {
    let text = `HTTP ${err.status}: ${err.message}`;
    if (err.status === 400) {
      text +=
        '\nHint: call describe_commands or describe_asset_kind to check the expected JSON shape.';
    }
    return text;
  }
  if (err instanceof z.ZodError) {
    return `Server response failed validation:\n${z.prettifyError(err)}`;
  }
  if (err instanceof ToolError) return err.message;
  if (err instanceof Error) return err.message;
  return String(err);
}
