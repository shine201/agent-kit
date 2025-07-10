import { describe, expect, test, vi } from "vitest";
import { z } from "zod";
import {
  recursiveGeminiZodToJsonSchema,
  requestParser,
  responseParser,
} from "./gemini";

// Utility to deep-clone objects without preserving references
const clone = <T>(obj: T): T => {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
  const cloned: T = JSON.parse(JSON.stringify(obj));
  return cloned;
};

describe("recursiveGeminiZodToJsonSchema", () => {
  test("should remove additionalProperties when truthy at the top level", () => {
    const input = {
      type: "object",
      properties: { name: { type: "string" } },
      additionalProperties: true,
      required: ["name"],
    };
    const expected = {
      type: "object",
      properties: { name: { type: "string" } },
      required: ["name"],
    };

    expect(recursiveGeminiZodToJsonSchema(input)).toEqual(expected);
  });

  test("should remove additionalProperties when truthy from nested objects", () => {
    const input = {
      type: "object",
      properties: {
        user: {
          type: "object",
          properties: { id: { type: "number" } },
          additionalProperties: true,
        },
        isActive: { type: "boolean" },
      },
      additionalProperties: true,
    };
    const expected = {
      type: "object",
      properties: {
        user: {
          type: "object",
          properties: { id: { type: "number" } },
        },
        isActive: { type: "boolean" },
      },
    };

    expect(recursiveGeminiZodToJsonSchema(input)).toEqual(expected);
  });

  test("should remove additionalProperties from objects within an array when truthy", () => {
    const input = {
      type: "array",
      items: [
        {
          type: "object",
          properties: { sku: { type: "string" } },
          additionalProperties: true,
        },
        { type: "number" },
        {
          type: "object",
          properties: { count: { type: "integer" } },
          additionalProperties: true,
        },
        "a string",
        null,
        undefined,
      ],
      additionalProperties: "foo",
    };
    const expected = {
      type: "array",
      items: [
        {
          type: "object",
          properties: { sku: { type: "string" } },
        },
        { type: "number" },
        {
          type: "object",
          properties: { count: { type: "integer" } },
        },
        "a string",
        null,
        undefined,
      ],
    };

    expect(recursiveGeminiZodToJsonSchema(input)).toEqual(expected);
  });

  test("should handle deeply nested objects and arrays", () => {
    const input = {
      level1: {
        additionalProperties: true,
        level2: {
          prop: "value",
          additionalProperties: true,
          level3Array: [
            { item: 1, additionalProperties: true },
            { item: 2, otherProp: "data" },
            { item: 3, level4: { final: true, additionalProperties: true } },
            "stringInNestedArray",
          ],
        },
      },
    };
    const expected = {
      level1: {
        level2: {
          prop: "value",
          level3Array: [
            { item: 1 },
            { item: 2, otherProp: "data" },
            { item: 3, level4: { final: true } },
            "stringInNestedArray",
          ],
        },
      },
    };

    expect(recursiveGeminiZodToJsonSchema(input)).toEqual(expected);
  });

  test("should return the object unchanged if no additionalProperties exist", () => {
    const input = {
      type: "object",
      properties: {
        name: { type: "string" },
        details: {
          type: "object",
          properties: { age: { type: "number" } },
        },
      },
      required: ["name"],
    };
    const inputClone = clone(input);

    expect(recursiveGeminiZodToJsonSchema(input)).toEqual(inputClone);
  });

  test("should handle empty objects correctly", () => {
    const input = {};
    const expected = {};
    expect(recursiveGeminiZodToJsonSchema(input)).toEqual(expected);
  });

  test("should handle objects with null or undefined values correctly", () => {
    const input = {
      prop1: null,
      prop2: undefined,
      prop3: {
        nested: null,
        additionalProperties: true,
      },
      prop4: [null, undefined, { item: 1, additionalProperties: true }],
    };
    const expected = {
      prop1: null,
      prop2: undefined,
      prop3: {
        nested: null,
      },
      prop4: [null, undefined, { item: 1 }],
    };
    expect(recursiveGeminiZodToJsonSchema(input)).toEqual(expected);
  });

  test("should handle top-level arrays", () => {
    const input = [
      { foo: 1, additionalProperties: true },
      { bar: 2, additionalProperties: false },
      3,
      null,
      undefined,
      "string",
    ];
    const expected = [{ foo: 1 }, { bar: 2 }, 3, null, undefined, "string"];
    expect(recursiveGeminiZodToJsonSchema(input)).toEqual(expected);
  });

  test("should not modify the original input object", () => {
    const input = {
      type: "object",
      properties: { name: { type: "string" } },
      additionalProperties: true,
      nested: { prop: "value", additionalProperties: true },
      arr: [{ inner: true, additionalProperties: false }],
    };
    const inputClone = clone(input);

    recursiveGeminiZodToJsonSchema(input);
    expect(input).toEqual(inputClone);
  });
});

describe("gemini adapters", () => {
  test("requestParser formats messages and tools", () => {
    const messages = [
      { role: "system", type: "text", content: "sys" },
      { role: "user", type: "text", content: "hi" },
      { role: "assistant", type: "text", content: "there" },
      {
        role: "assistant",
        type: "tool_call",
        stop_reason: "tool",
        tools: [
          {
            type: "tool",
            id: "foo",
            name: "foo",
            input: { a: 1 },
          },
        ],
      },
      {
        role: "tool_result",
        type: "tool_result",
        stop_reason: "tool",
        tool: {
          type: "tool",
          id: "foo",
          name: "foo",
          input: { a: 1 },
        },
        content: { ok: true },
      },
    ];

    const tools = [
      {
        name: "foo",
        description: "Foo",
        // simple parameters object
        parameters: z.object({ a: z.number() }),
      },
    ];

    const req = requestParser({} as any, messages as any, tools as any, "auto");

    expect(req.contents).toEqual([
      { role: "user", parts: [{ text: "sys" }] },
      { role: "user", parts: [{ text: "hi" }] },
      { role: "model", parts: [{ text: "there" }] },
      {
        role: "model",
        parts: [
          {
            functionCall: { name: "foo", args: { a: 1 } },
          },
        ],
      },
      {
        role: "user",
        parts: [
          {
            functionResponse: {
              name: "foo",
              response: { name: "foo", content: "{\"ok\":true}" },
            },
          },
        ],
      },
    ]);

    expect(req.tool_config).toEqual({
      functionCallingConfig: { mode: "AUTO" },
    });
    expect(req.tools?.[0]?.functionDeclarations?.[0]?.name).toBe("foo");
  });

  test("responseParser parses candidates", () => {
    const input = {
      candidates: [
        {
          content: { role: "model", parts: [{ text: "hello" }] },
        },
        {
          content: {
            role: "model",
            parts: [{ functionCall: { name: "foo", args: { a: 1 } } }],
          },
        },
        {
          content: {
            role: "user",
            parts: [
              { functionResponse: { name: "foo", response: { success: true } } },
            ],
          },
        },
        {
          finishReason: "MALFORMED_FUNCTION_CALL",
          content: { role: "model", parts: [{ text: "bad" }] },
        },
      ],
    } as any;

    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const msgs = responseParser(input);

    expect(msgs).toEqual([
      { role: "assistant", type: "text", content: "hello" },
      {
        role: "assistant",
        type: "tool_call",
        stop_reason: "tool",
        tools: [
          { type: "tool", id: "foo", name: "foo", input: { a: 1 } },
        ],
      },
      {
        role: "tool_result",
        type: "tool_result",
        stop_reason: "tool",
        tool: { type: "tool", id: "foo", name: "foo", input: { success: true } },
        content: "{\"success\":true}",
      },
    ]);

    expect(warn).toHaveBeenCalled();
  });
});
