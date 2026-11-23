// The OpenAI ⇄ Anthropic translation the local translator proxy runs
// (bin/proxy.ts), as pure JSON functions: an Anthropic `/v1/messages` request
// is turned into an OpenAI `chat/completions` request on the way out, and the
// answer (a whole JSON body, or the stream of its chunks) is turned back on
// the way in. Claude Code speaks only the Anthropic shape; an OpenAI endpoint
// (Ninfer, LM Studio, Ollama) speaks only the other. The model name arrives
// already resolved to the endpoint's own (`modelFlagForEndpoint` at the
// launch) — the translation never names a model.
//
// What the translation cannot carry, and what it does about it:
// - extended thinking: dropped (a local server has no thinking budget);
// - unknown block types: a loud error, naming the type — a new Claude Code
//   block the translation has no spelling for is a fact, not a gap to fill;
// - the response's usage: the input tokens an OpenAI stream reports only at
//   its end sit in the final `message_delta`, with `message_start` carrying
//   zeros (the Agent SDK folds usage from both).

/** An Anthropic content block as a request carries it. */
type AnthropicBlock = { type: string } & Record<string, unknown>;
type AnthropicMessage = {
  role: "user" | "assistant";
  content: string | AnthropicBlock[];
};

/** The body of an Anthropic `POST /v1/messages`. */
export interface AnthropicRequest {
  model?: string;
  system?: string | AnthropicBlock[];
  messages?: AnthropicMessage[];
  max_tokens?: number;
  temperature?: number;
  top_p?: number;
  top_k?: number;
  stop_sequences?: string[];
  stream?: boolean;
  tools?: Array<Record<string, unknown>>;
  tool_choice?: Record<string, unknown>;
  [key: string]: unknown;
}

/** An OpenAI `chat/completions` message, as the endpoint takes it. */
export type OpenAIMessage =
  | { role: "system" | "user" | "tool"; content: string; tool_call_id?: string }
  | {
      role: "user";
      content: Array<
        | { type: "text"; text: string }
        | { type: "image_url"; image_url: { url: string } }
      >;
    }
  | {
      role: "assistant";
      content: string | null;
      tool_calls?: OpenAIToolCall[];
    };

export interface OpenAIToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

/** The body of an OpenAI `POST /chat/completions`. */
export interface OpenAIRequest {
  model?: string;
  messages: OpenAIMessage[];
  max_tokens?: number;
  temperature?: number;
  top_p?: number;
  stop?: string[];
  stream?: boolean;
  stream_options?: { include_usage: boolean };
  tools?: Array<{ type: "function"; function: Record<string, unknown> }>;
  tool_choice?: string | { type: "function"; function: { name: string } };
}

// ── Request: Anthropic → OpenAI ────────────────────────────────────────────

function systemText(system: NonNullable<AnthropicRequest["system"]>): string {
  if (typeof system === "string") return system;
  return system
    .filter((b) => b.type === "text" && typeof b.text === "string")
    .map((b) => b.text as string)
    .join("\n\n");
}

/** The text a tool_result block's content is (its parts, joined). */
function toolResultContent(content: unknown): string {
  if (content === undefined) return "";
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return String(content);
  return content
    .map((part) => {
      if (typeof part === "string") return part;
      if (
        part !== null &&
        typeof part === "object" &&
        (part as { type?: unknown }).type === "text" &&
        typeof (part as { text?: unknown }).text === "string"
      )
        return (part as { text: string }).text;
      // A tool result the translation has no text for becomes its shape,
      // loudly: the model sees what happened, the user sees why it is odd.
      return JSON.stringify(part);
    })
    .join("\n");
}

/**
 * One Anthropic `POST /v1/messages` body as the OpenAI endpoint receives it.
 * Throws when a block the translation has no spelling for arrives.
 */
export function translateRequest(body: AnthropicRequest): OpenAIRequest {
  const messages: OpenAIMessage[] = [];
  const system = body.system === undefined ? "" : systemText(body.system);
  if (system.trim() !== "") messages.push({ role: "system", content: system });

  for (const message of body.messages ?? []) {
    if (typeof message.content === "string") {
      messages.push({
        role: message.role,
        content: message.content,
      } as OpenAIMessage);
      continue;
    }
    const isUser = message.role === "user";
    let textParts: string[] = [];
    const images: Array<{ media_type: string; data: string }> = [];
    const toolCalls: OpenAIToolCall[] = [];
    let text = "";
    for (const block of message.content) {
      switch (block.type) {
        case "text": {
          if (typeof block.text !== "string") break;
          if (isUser) textParts.push(block.text);
          else text = text === "" ? block.text : `${text}\n\n${block.text}`;
          break;
        }
        case "image": {
          const source = block.source as
            | {
                type?: string;
                media_type?: string;
                data?: string;
                url?: string;
              }
            | undefined;
          if (
            isUser &&
            source?.type === "base64" &&
            source.data &&
            source.media_type
          )
            images.push({ media_type: source.media_type, data: source.data });
          else if (isUser && source?.type === "url" && source.url)
            images.push({ media_type: "image/png", data: source.url });
          break;
        }
        case "tool_use":
          if (
            !isUser &&
            typeof block.name === "string" &&
            typeof block.id === "string"
          )
            toolCalls.push({
              id: block.id,
              type: "function",
              function: {
                name: block.name,
                arguments: JSON.stringify(block.input ?? {}),
              },
            });
          break;
        case "tool_result":
          // Each result is its own OpenAI message, after this one's text.
          if (isUser && typeof block.tool_use_id === "string") {
            flushText();
            messages.push({
              role: "tool",
              content: toolResultContent(block.content),
              tool_call_id: block.tool_use_id,
            });
          }
          break;
        // Reasoning content is not replayed: a local server has no budget for
        // it, and dropping it changes nothing the endpoint can do.
        case "thinking":
        case "redacted_thinking":
          break;
        default:
          throw new Error(
            `The LLM proxy cannot translate a "${block.type}" content block — its translation knows text, images, tool calls and tool results`,
          );
      }
    }
    function flushText(): void {
      if (textParts.length === 0 && images.length === 0) return;
      if (textParts.length === 1 && images.length === 0) {
        const part = textParts[0];
        if (part === undefined)
          throw new Error("unreachable: the flush's one text part is absent");
        messages.push({ role: "user", content: part });
      } else {
        messages.push({
          role: "user",
          content: [
            ...textParts.map((t) => ({ type: "text" as const, text: t })),
            ...images.map((img) => ({
              type: "image_url" as const,
              image_url: {
                url: img.data.startsWith("http")
                  ? img.data
                  : `data:${img.media_type};base64,${img.data}`,
              },
            })),
          ],
        });
      }
      textParts = [];
      images.length = 0;
    }
    if (isUser) flushText();
    else if (text !== "" || toolCalls.length > 0)
      messages.push({
        role: "assistant",
        content: text === "" ? null : text,
        ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
      });
  }

  const tools: OpenAIRequest["tools"] = body.tools
    ?.filter(
      (t) =>
        t.type === "function" || (t.type === undefined && t.name !== undefined),
    )
    .map((t) => ({
      type: "function",
      function: {
        name: t.name,
        ...(t.description !== undefined ? { description: t.description } : {}),
        parameters: t.input_schema ?? {
          type: "object",
          properties: {} as Record<string, unknown>,
        },
      },
    }));
  let toolChoice: OpenAIRequest["tool_choice"];
  if (body.tool_choice) {
    const tc = body.tool_choice;
    if (tc.type === "auto") toolChoice = "auto";
    else if (tc.type === "any") toolChoice = "required";
    else if (tc.type === "none") toolChoice = "none";
    else if (tc.type === "tool" && typeof tc.name === "string")
      toolChoice = { type: "function", function: { name: tc.name } };
  }

  return {
    ...(body.model !== undefined ? { model: body.model } : {}),
    messages,
    ...(body.max_tokens !== undefined ? { max_tokens: body.max_tokens } : {}),
    ...(body.temperature !== undefined
      ? { temperature: body.temperature }
      : {}),
    ...(body.top_p !== undefined ? { top_p: body.top_p } : {}),
    ...(body.stop_sequences !== undefined ? { stop: body.stop_sequences } : {}),
    ...(body.stream === true
      ? { stream: true, stream_options: { include_usage: true } }
      : body.stream === false
        ? { stream: false }
        : {}),
    ...(tools && tools.length > 0 ? { tools } : {}),
    ...(toolChoice !== undefined ? { tool_choice: toolChoice } : {}),
  };
}

// ── Upstream errors: the Anthropic shape Claude Code must read ─────────────

/** What an upstream failure becomes on its way back to Claude Code. */
export interface UpstreamErrorShape {
  status: number;
  errorType: "api_error" | "invalid_request_error";
  message: string;
}

/**
 * The words local servers use to refuse a prompt that overflows their context
 * window (Ninfer's `max_context`, OpenAI's `context_length_exceeded`, …). A
 * MISS costs nothing (the refusal reads as a plain error, Claude Code retries
 * the turn); a FALSE HIT burns a compaction on every typo'd model name, so
 * the list stays narrow.
 */
const CONTEXT_LENGTH_RE =
  /(maximum context length|context length exceeded|context window exceeded|context_length_exceeded|exceeds.{0,48}max(imum)?[_ ]context|prompt is too long|too many tokens)/i;

/**
 * An upstream failure's shape as Claude Code must read it. A context-length
 * refusal — status 400, with the server's own words naming its window (or its
 * `context_length_exceeded` code) — becomes the canonical Anthropic
 * `invalid_request_error` “prompt is too long…”: only in that shape does
 * Claude Code's built-in prompt-too-long rescue engage (drop the oldest
 * messages and retry; compact after a refused turn). Everything else keeps
 * the plain mapping — auth refusals stay 401, server failures read 502, the
 * rest pass through — all as `api_error`.
 */
export function shapeUpstreamError(
  status: number,
  detail: string,
  code: string | undefined,
  what: string,
): UpstreamErrorShape {
  if (
    status === 400 &&
    (code === "context_length_exceeded" || CONTEXT_LENGTH_RE.test(detail))
  )
    return {
      status: 400,
      errorType: "invalid_request_error",
      message: `prompt is too long: ${detail}`,
    };
  return {
    status:
      status === 401 || status === 403 ? 401 : status >= 500 ? 502 : status,
    errorType: "api_error",
    message: `${what} refused (${status})${detail === "" ? "" : `: ${detail}`}`,
  };
}

// ── Response: OpenAI → Anthropic (non-streaming) ───────────────────────────

export function finishReasonToStopReason(
  finishReason: string | null | undefined,
): string {
  if (finishReason === "length") return "max_tokens";
  if (finishReason === "tool_calls" || finishReason === "function_call")
    return "tool_use";
  return "end_turn";
}

/**
 * The usage an OpenAI report says, in Anthropic's split (cached out of input).
 * No report at all (some endpoints omit it) reads as zero — a missing number
 * is not a failed request.
 */
export function usageOf(
  o?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    prompt_tokens_details?: { cached_tokens?: number };
  } | null,
): {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens: number;
} {
  const prompt = o?.prompt_tokens ?? 0;
  const cached = o?.prompt_tokens_details?.cached_tokens ?? 0;
  return {
    input_tokens: Math.max(0, prompt - cached),
    output_tokens: o?.completion_tokens ?? 0,
    cache_read_input_tokens: cached,
  };
}

/** An OpenAI `chat/completions` JSON answer as the Anthropic messages shape. */
export function mapResponse(
  resp: Record<string, unknown>,
  requestModel: string,
): Record<string, unknown> {
  const choice = (
    resp.choices as Array<Record<string, unknown>> | undefined
  )?.[0];
  const message = (choice?.message ?? {}) as Record<string, unknown>;
  const content: Array<Record<string, unknown>> = [];
  if (typeof message.content === "string" && message.content !== "")
    content.push({ type: "text", text: message.content });
  const toolCalls = (message.tool_calls ?? []) as Array<
    Record<string, unknown>
  >;
  for (const call of toolCalls) {
    const fn = (call.function ?? {}) as Record<string, unknown>;
    let input: unknown = {};
    if (typeof fn.arguments === "string" && fn.arguments !== "") {
      try {
        input = JSON.parse(fn.arguments);
      } catch (err) {
        if (!(err instanceof SyntaxError)) throw err;
        // A fragment the endpoint left unparseable is carried as-is: the
        // caller's next turn reports it, instead of the translation dying on it.
        input = { raw: fn.arguments };
      }
    }
    content.push({
      type: "tool_use",
      id: typeof call.id === "string" ? call.id : "",
      name: typeof fn.name === "string" ? fn.name : "",
      input,
    });
  }
  const usage = usageOf(resp.usage as Parameters<typeof usageOf>[0]);
  return {
    id: typeof resp.id === "string" ? resp.id : "msg_proxy",
    type: "message",
    role: "assistant",
    model: typeof resp.model === "string" ? resp.model : requestModel,
    content,
    stop_reason: finishReasonToStopReason(
      choice?.finish_reason as string | null | undefined,
    ),
    stop_sequence: null,
    usage,
  };
}

// ── Response: OpenAI → Anthropic (streaming) ───────────────────────────────

const sse = (type: string, data: unknown): string =>
  `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;

/**
 * The state of one translated stream: each OpenAI chunk is pushed in and the
 * Anthropic SSE events it produced come out — `message_start` first, the
 * content blocks as they arrive, `message_delta` and `message_stop` from
 * {@link finish}.
 */
export class StreamMapper {
  private started = false;
  private messageId = `msg_proxy_${Math.random().toString(36).slice(2, 10)}`;
  private nextBlock = 0;
  private textBlock: number | null = null;
  /** The OpenAI tool_call index each open tool_use block answers. */
  private toolBlocks = new Map<number, number>();
  private stopReason: string | null = null;
  private usage = {
    input_tokens: 0,
    output_tokens: 0,
    cache_read_input_tokens: 0,
  };

  constructor(private readonly requestModel: string) {}

  /** One OpenAI `chat/completions` stream chunk → the SSE events it yields. */
  push(chunk: Record<string, unknown>): string[] {
    const events: string[] = [];
    if (!this.started) {
      this.started = true;
      const model =
        typeof chunk.model === "string" && chunk.model !== ""
          ? chunk.model
          : this.requestModel;
      events.push(
        sse("message_start", {
          message: {
            id: this.messageId,
            type: "message",
            role: "assistant",
            model,
            content: [],
            stop_reason: null,
            stop_sequence: null,
            // The input tokens the endpoint reports at its stream's end land
            // in the final message_delta; the SDK folds usage from both.
            usage: { input_tokens: 0, output_tokens: 0 },
          },
        }),
      );
    }

    const usage = chunk.usage as
      | {
          prompt_tokens?: number;
          completion_tokens?: number;
          prompt_tokens_details?: { cached_tokens?: number };
        }
      | undefined;
    if (usage) this.usage = usageOf(usage);

    const choice = (
      chunk.choices as Array<Record<string, unknown>> | undefined
    )?.[0];
    if (!choice) return events;
    const delta = (choice.delta ?? {}) as Record<string, unknown>;

    if (typeof delta.content === "string" && delta.content !== "") {
      if (this.textBlock === null) {
        this.textBlock = this.nextBlock++;
        events.push(
          sse("content_block_start", {
            index: this.textBlock,
            content_block: { type: "text", text: "" },
          }),
        );
      }
      events.push(
        sse("content_block_delta", {
          index: this.textBlock,
          delta: { type: "text_delta", text: delta.content },
        }),
      );
    }

    const toolCalls = (delta.tool_calls ?? []) as Array<
      Record<string, unknown>
    >;
    for (const call of toolCalls) {
      const index = Number(call.index ?? 0);
      const fn = (call.function ?? {}) as Record<string, unknown>;
      let block = this.toolBlocks.get(index);
      if (block === undefined) {
        this.closeText(events);
        block = this.nextBlock++;
        this.toolBlocks.set(index, block);
        events.push(
          sse("content_block_start", {
            index: block,
            content_block: {
              type: "tool_use",
              id: typeof call.id === "string" ? call.id : `toolu_${index}`,
              name: typeof fn.name === "string" ? fn.name : "",
              input: {},
            },
          }),
        );
      }
      if (typeof fn.arguments === "string" && fn.arguments !== "") {
        events.push(
          sse("content_block_delta", {
            index: block,
            delta: { type: "input_json_delta", partial_json: fn.arguments },
          }),
        );
      }
    }

    if (choice.finish_reason != null) {
      this.stopReason = finishReasonToStopReason(
        choice.finish_reason as string,
      );
      this.closeText(events);
    }
    return events;
  }

  private closeText(events: string[]): void {
    if (this.textBlock !== null) {
      events.push(sse("content_block_stop", { index: this.textBlock }));
      this.textBlock = null;
    }
  }

  /** The stream's end: the still-open blocks, the usage, `message_stop`. */
  finish(): string[] {
    if (!this.started)
      return [
        sse("message_start", {
          message: {
            id: this.messageId,
            type: "message",
            role: "assistant",
            model: this.requestModel,
            content: [],
            stop_reason: null,
            stop_sequence: null,
            usage: { input_tokens: 0, output_tokens: 0 },
          },
        }),
        sse("message_delta", {
          delta: { stop_reason: "end_turn", stop_sequence: null },
          usage: this.usage,
        }),
        sse("message_stop", {}),
      ];
    const events: string[] = [];
    // The still-open blocks close in their start order.
    if (this.textBlock !== null)
      events.push(sse("content_block_stop", { index: this.textBlock }));
    for (const block of [...this.toolBlocks.values()].sort((a, b) => a - b))
      events.push(sse("content_block_stop", { index: block }));
    events.push(
      sse("message_delta", {
        delta: {
          stop_reason: this.stopReason ?? "end_turn",
          stop_sequence: null,
        },
        usage: this.usage,
      }),
      sse("message_stop", {}),
    );
    return events;
  }
}
