import test from "node:test";
import assert from "node:assert/strict";

import { callAgnoCatalog, callAgnoChat } from "../src/agno.js";

test("callAgnoChat returns structured error on transport failure", async () => {
  const originalFetch = global.fetch;
  global.fetch = (async () => {
    throw new Error("network down");
  }) as typeof fetch;

  try {
    const result = await callAgnoChat("http://agno.invalid", {
      message: "hello",
      history: [],
      agent: {
        id: "a1",
        name: "Agent",
        type: "SPECIALIST",
        description: "desc",
        prompt: "prompt",
        tags: [],
      },
    }, "corr-123");

    assert.equal(result.data, null);
    assert.match(result.error || "", /Agno POST \/chat failed/);
  } finally {
    global.fetch = originalFetch;
  }
});

test("callAgnoCatalog returns payload on success", async () => {
  const originalFetch = global.fetch;
  global.fetch = (async () =>
    new Response(JSON.stringify({ tools: [], skills: [], knowledgeSources: [] }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })) as typeof fetch;

  try {
    const result = await callAgnoCatalog("http://agno.local", "corr-456");
    assert.deepEqual(result.data, { tools: [], skills: [], knowledgeSources: [] });
    assert.equal(result.error, null);
  } finally {
    global.fetch = originalFetch;
  }
});
