import { describe, expect, test } from "bun:test";
import {
  StreamMapper,
  finishReasonToStopReason,
  mapResponse,
  shapeUpstreamError,
  translateRequest,
  usageOf,
} from "./translate";

/** One SSE line the mapper yields: its event name and parsed data. */
type Sse = { event: string; data: Record<string, unknown> };

const parseSse = (lines: string[]): Sse[] =>
  lines.map((line) => {
    const [event, data] = line.split("\n");
    if (event === undefined || data === undefined)
      throw new Error(`malformed SSE line in a test: ${JSON.stringify(line)}`);
    return {
      event: event.replace(/^event: /, ""),
      data: JSON.parse(data.slice(6)),
    };
  });

/** One parsed SSE line by position: a missing one fails the test loudly. */
function at(lines: Sse[], i: number): Sse {
  const line = lines[i];
  if (line === undefined) throw new Error(`SSE line ${String(i)} is missing`);
  return line;
}

const eventNames = (lines: string[]) => parseSse(lines).map((s) => s.event);

describe("translateRequest", () => {
  test("carries a whole turn: system, text, images, tools, a tool round trip", () => {
    const openai = translateRequest({
      model: "qwen3.8-27b",
      system: [
        { type: "text", text: "You are equin" },
        { type: "text", text: "Be terse" },
      ],
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "What is in this file?" },
            {
              type: "image",
              source: { type: "base64", media_type: "image/png", data: "AAA" },
            },
            {
              type: "image",
              source: { type: "url", url: "http://host/shot.png" },
            },
          ],
        },
        {
          role: "assistant",
          content: [
            { type: "text", text: "Reading it" },
            {
              type: "tool_use",
              id: "toolu_1",
              name: "Read",
              input: { file_path: "/tmp/a" },
            },
          ],
        },
        {
          role: "user",
          content: [
            { type: "text", text: "Now summarise" },
            {
              type: "tool_result",
              tool_use_id: "toolu_1",
              content: [{ type: "text", text: "line one" }],
            },
          ],
        },
      ],
      max_tokens: 1000,
      temperature: 0.2,
      top_p: 0.9,
      stop_sequences: ["\n\n"],
      stream: true,
      tools: [
        {
          name: "Read",
          description: "Read a file",
          input_schema: {
            type: "object",
            properties: { file_path: { type: "string" } },
          },
        },
      ],
      tool_choice: { type: "any" },
    });

    expect(openai.model).toBe("qwen3.8-27b");
    expect(openai.messages[0]).toEqual({
      role: "system",
      content: "You are equin\n\nBe terse",
    });
    // One user message: its text plus both images (a data URL, then the URL as-is).
    const firstUser = openai.messages[1] as {
      role: string;
      content: unknown[];
    };
    expect(firstUser.role).toBe("user");
    expect(firstUser.content).toEqual([
      { type: "text", text: "What is in this file?" },
      { type: "image_url", image_url: { url: "data:image/png;base64,AAA" } },
      { type: "image_url", image_url: { url: "http://host/shot.png" } },
    ]);
    expect(openai.messages[2]).toEqual({
      role: "assistant",
      content: "Reading it",
      tool_calls: [
        {
          id: "toolu_1",
          type: "function",
          function: { name: "Read", arguments: '{"file_path":"/tmp/a"}' },
        },
      ],
    });
    // The user's text and its tool result are two separate OpenAI messages.
    expect(openai.messages[3]).toEqual({
      role: "user",
      content: "Now summarise",
    });
    expect(openai.messages[4]).toEqual({
      role: "tool",
      content: "line one",
      tool_call_id: "toolu_1",
    });
    expect(openai.max_tokens).toBe(1000);
    expect(openai.temperature).toBe(0.2);
    expect(openai.top_p).toBe(0.9);
    expect(openai.stop).toEqual(["\n\n"]);
    expect(openai.stream).toBe(true);
    expect(openai.stream_options).toEqual({ include_usage: true });
    expect(openai.tools).toEqual([
      {
        type: "function",
        function: {
          name: "Read",
          description: "Read a file",
          parameters: {
            type: "object",
            properties: { file_path: { type: "string" } },
          },
        },
      },
    ]);
    expect(openai.tool_choice).toBe("required");
  });

  test("an assistant thinking block is dropped, its text kept", () => {
    const openai = translateRequest({
      messages: [
        {
          role: "assistant",
          content: [
            { type: "thinking", thinking: "hmm" },
            { type: "text", text: "The answer" },
          ],
        },
      ],
    });
    expect(openai.messages).toEqual([
      { role: "assistant", content: "The answer" },
    ]);
  });

  test("a block the translation has no spelling for throws, naming its type", () => {
    expect(() =>
      translateRequest({
        messages: [
          {
            role: "user",
            content: [{ type: "document", source: { type: "base64" } }],
          },
        ],
      }),
    ).toThrow('cannot translate a "document" content block');
  });

  test("plain-string content and absent fields pass through", () => {
    const openai = translateRequest({
      messages: [{ role: "user", content: "Hello" }],
    });
    expect(openai.messages).toEqual([{ role: "user", content: "Hello" }]);
    expect(openai.model).toBeUndefined();
    expect(openai.tools).toBeUndefined();
    expect(openai.tool_choice).toBeUndefined();
  });
});

describe("mapResponse", () => {
  test("maps text, tool calls and the cached usage split", () => {
    const anthropic = mapResponse(
      {
        id: "cmpl-1",
        model: "qwen3.8-27b",
        choices: [
          {
            message: {
              content: "Done",
              tool_calls: [
                {
                  id: "call_1",
                  function: { name: "Bash", arguments: '{"command":"ls"}' },
                },
              ],
            },
            finish_reason: "tool_calls",
          },
        ],
        usage: {
          prompt_tokens: 120,
          completion_tokens: 10,
          prompt_tokens_details: { cached_tokens: 80 },
        },
      },
      "qwen3.8-27b",
    );
    expect(anthropic).toEqual({
      id: "cmpl-1",
      type: "message",
      role: "assistant",
      model: "qwen3.8-27b",
      content: [
        { type: "text", text: "Done" },
        {
          type: "tool_use",
          id: "call_1",
          name: "Bash",
          input: { command: "ls" },
        },
      ],
      stop_reason: "tool_use",
      stop_sequence: null,
      usage: {
        input_tokens: 40,
        output_tokens: 10,
        cache_read_input_tokens: 80,
      },
    });
  });

  test("arguments the endpoint left unparseable are carried raw", () => {
    const anthropic = mapResponse(
      {
        choices: [
          {
            message: {
              content: null,
              tool_calls: [
                { id: "c", function: { name: "F", arguments: '{"a": ' } },
              ],
            },
            finish_reason: "stop",
          },
        ],
      },
      "m",
    );
    expect(anthropic.content).toEqual([
      { type: "tool_use", id: "c", name: "F", input: { raw: '{"a": ' } },
    ]);
  });

  test("a finish reason maps to Anthropic's stop reasons", () => {
    expect(finishReasonToStopReason("length")).toBe("max_tokens");
    expect(finishReasonToStopReason("tool_calls")).toBe("tool_use");
    expect(finishReasonToStopReason("stop")).toBe("end_turn");
    expect(finishReasonToStopReason(null)).toBe("end_turn");
  });
});

describe("usageOf", () => {
  test("splits the prompt into fresh input and cached reads, never below zero", () => {
    expect(
      usageOf({
        prompt_tokens: 100,
        completion_tokens: 5,
        prompt_tokens_details: { cached_tokens: 120 },
      }),
    ).toEqual({
      input_tokens: 0,
      output_tokens: 5,
      cache_read_input_tokens: 120,
    });
  });
});

describe("StreamMapper", () => {
  test("a text stream: start with zero usage, deltas, end with the real usage", () => {
    const mapper = new StreamMapper("qwen3.8-27b");
    const first = mapper.push({
      model: "qwen3.8-27b",
      choices: [{ delta: { content: "Hel" } }],
    });
    const second = mapper.push({
      choices: [{ delta: { content: "lo" } }],
    });
    const last = mapper.push({
      choices: [{ delta: {}, finish_reason: "stop" }],
      usage: {
        prompt_tokens: 50,
        completion_tokens: 7,
        prompt_tokens_details: { cached_tokens: 20 },
      },
    });
    const end = mapper.finish();

    const all = parseSse([...first, ...second, ...last, ...end]);
    expect(eventNames([...first, ...second, ...last, ...end])).toEqual([
      "message_start",
      "content_block_start",
      "content_block_delta",
      "content_block_delta",
      "content_block_stop",
      "message_delta",
      "message_stop",
    ]);
    // message_start carries zero usage; the real one lands in the final delta.
    expect(
      (at(all, 0).data.message as { usage: Record<string, number> }).usage,
    ).toEqual({
      input_tokens: 0,
      output_tokens: 0,
    });
    expect(at(all, 1).data.content_block).toEqual({ type: "text", text: "" });
    expect(at(all, 2).data.delta).toEqual({ type: "text_delta", text: "Hel" });
    expect(at(all, 3).data.delta).toEqual({ type: "text_delta", text: "lo" });
    expect(at(all, 5).data).toEqual({
      delta: { stop_reason: "end_turn", stop_sequence: null },
      usage: {
        input_tokens: 30,
        output_tokens: 7,
        cache_read_input_tokens: 20,
      },
    });
  });

  test("a tool call streams as one tool_use block whose input JSON fragments arrive in order", () => {
    const mapper = new StreamMapper("qwen3.8-27b");
    const events = [
      ...mapper.push({
        choices: [
          {
            delta: {
              tool_calls: [
                {
                  index: 0,
                  id: "call_9",
                  function: { name: "Bash", arguments: '{"co' },
                },
              ],
            },
          },
        ],
      }),
      ...mapper.push({
        choices: [
          {
            delta: {
              tool_calls: [
                { index: 0, function: { arguments: 'mmand":"ls"}' } },
              ],
            },
          },
        ],
      }),
      ...mapper.push({ choices: [{ delta: {}, finish_reason: "tool_calls" }] }),
      ...mapper.finish(),
    ];
    const all = parseSse(events);
    expect(all.map((s) => s.event)).toEqual([
      "message_start",
      "content_block_start",
      "content_block_delta",
      "content_block_delta",
      "content_block_stop",
      "message_delta",
      "message_stop",
    ]);
    expect(at(all, 1).data.content_block).toEqual({
      type: "tool_use",
      id: "call_9",
      name: "Bash",
      input: {},
    });
    expect(at(all, 2).data.delta).toEqual({
      type: "input_json_delta",
      partial_json: '{"co',
    });
    expect(at(all, 3).data.delta).toEqual({
      type: "input_json_delta",
      partial_json: 'mmand":"ls"}',
    });
    // A tool call ends the message with `tool_use`, not `end_turn`.
    expect(at(all, 5).data.delta).toEqual({
      stop_reason: "tool_use",
      stop_sequence: null,
    });
  });

  test("text and two tool calls interleave: each tool call its own block, closed in start order", () => {
    const mapper = new StreamMapper("m");
    const events = [
      ...mapper.push({ choices: [{ delta: { content: "Let me check" } }] }),
      ...mapper.push({
        choices: [
          {
            delta: {
              tool_calls: [
                {
                  index: 0,
                  id: "a",
                  function: { name: "Read", arguments: "{}" },
                },
              ],
            },
          },
        ],
      }),
      ...mapper.push({
        choices: [
          {
            delta: {
              tool_calls: [
                {
                  index: 1,
                  id: "b",
                  function: { name: "Grep", arguments: "{}" },
                },
              ],
            },
          },
        ],
      }),
      ...mapper.finish(),
    ];
    const all = parseSse(events);
    const starts = all.filter((s) => s.event === "content_block_start");
    expect(
      starts.map((s) => (s.data.content_block as { type: string }).type),
    ).toEqual(["text", "tool_use", "tool_use"]);
    // The tool blocks answer the tool_call indexes in arrival order.
    expect((at(starts, 1).data.content_block as { id: string }).id).toBe("a");
    expect((at(starts, 2).data.content_block as { id: string }).id).toBe("b");
    const stops = all
      .filter((s) => s.event === "content_block_stop")
      .map((s) => s.data.index as number);
    // Each block closes exactly once, the text at its finish, the tools at the
    // stream's end in their start order.
    expect(stops).toEqual([0, 1, 2]);
  });

  test("a stream that ends without a word still closes cleanly", () => {
    const mapper = new StreamMapper("m");
    const all = parseSse(mapper.finish());
    expect(all.map((s) => s.event)).toEqual([
      "message_start",
      "message_delta",
      "message_stop",
    ]);
    expect(at(all, 1).data.usage).toEqual({
      input_tokens: 0,
      output_tokens: 0,
      cache_read_input_tokens: 0,
    });
  });

  test("a chunk with no choice only updates the usage", () => {
    const mapper = new StreamMapper("m");
    const first = mapper.push({
      usage: { prompt_tokens: 3, completion_tokens: 1 },
    });
    expect(eventNames(first)).toEqual(["message_start"]);
    const end = parseSse(mapper.finish());
    expect(at(end, 0).data.usage).toEqual({
      input_tokens: 3,
      output_tokens: 1,
      cache_read_input_tokens: 0,
    });
  });
});

describe("shapeUpstreamError", () => {
  const what = "the endpoint http://100.99.219.116:8080/v1";

  test("a context-length 400 becomes the canonical prompt-too-long shape", () => {
    expect(
      shapeUpstreamError(
        400,
        "prepared prompt exceeds Engine max_context 262144",
        undefined,
        what,
      ),
    ).toEqual({
      status: 400,
      errorType: "invalid_request_error",
      message:
        "prompt is too long: prepared prompt exceeds Engine max_context 262144",
    });
  });

  test("the OpenAI context_length_exceeded code classifies even with terse words", () => {
    expect(
      shapeUpstreamError(400, "bad request", "context_length_exceeded", what),
    ).toEqual({
      status: 400,
      errorType: "invalid_request_error",
      message: "prompt is too long: bad request",
    });
  });

  test("the OpenAI maximum-context-length sentence classifies", () => {
    expect(
      shapeUpstreamError(
        400,
        "This model's maximum context length is 32768 tokens. However, your messages resulted in 33,000 tokens.",
        undefined,
        what,
      ),
    ).toMatchObject({
      status: 400,
      errorType: "invalid_request_error",
      message: expect.stringMatching(/^prompt is too long: /),
    });
  });

  test("a non-context 400 stays a plain api_error — no false PTL on a typo'd model", () => {
    expect(
      shapeUpstreamError(400, "model 'qwen3.8-27x' not found", undefined, what),
    ).toEqual({
      status: 400,
      errorType: "api_error",
      message: `${what} refused (400): model 'qwen3.8-27x' not found`,
    });
  });

  test("auth and server failures keep their mapping", () => {
    expect(shapeUpstreamError(401, "invalid api key", undefined, what)).toEqual(
      {
        status: 401,
        errorType: "api_error",
        message: `${what} refused (401): invalid api key`,
      },
    );
    expect(shapeUpstreamError(500, "internal error", undefined, what)).toEqual({
      status: 502,
      errorType: "api_error",
      message: `${what} refused (500): internal error`,
    });
  });

  test("an empty body keeps the words of the status alone", () => {
    expect(shapeUpstreamError(429, "", undefined, what)).toEqual({
      status: 429,
      errorType: "api_error",
      message: `${what} refused (429)`,
    });
  });
});
