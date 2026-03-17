import test from "node:test";
import assert from "node:assert/strict";

import { evaluatePolicy } from "../src/policy.js";

const maintainer = {
  id: "u1",
  email: "maintainer@example.com",
  role: "TEAM_MAINTAINER" as const,
  teamId: "team-a",
};

test("TEAM_MAINTAINER cannot mutate cross-team resources", () => {
  const result = evaluatePolicy({
    actor: maintainer,
    action: "agent:update",
    ownerTeamId: "team-b",
    agent: {
      id: "a1",
      name: "Cross Team Agent",
      description: "",
      prompt: "",
      tags: [],
      type: "SPECIALIST",
      isGlobal: false,
      visibility: "private",
      teamId: "team-b",
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  });
  assert.equal(result.allow, false);
  assert.match(result.reason || "", /Cross-team change denied/);
});

test("TEAM_MAINTAINER cannot manage write tools", () => {
  const result = evaluatePolicy({
    actor: maintainer,
    action: "tool:update",
    ownerTeamId: "team-a",
    tool: {
      id: "t1",
      name: "Dangerous Tool",
      type: "internal",
      mode: "real",
      policy: "write",
      riskLevel: "high",
      dataClassificationIn: "restricted",
      dataClassificationOut: "restricted",
      inputSchema: {},
      outputSchema: {},
      visibility: "private",
      teamId: "team-a",
      rateLimitPerMinute: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
      description: null,
      callName: null,
      transport: null,
      endpoint: null,
      method: null,
      authRef: null,
      timeoutMs: null,
      managedBy: "portal",
      runtimeSource: null,
    },
  });
  assert.equal(result.allow, false);
  assert.match(result.reason || "", /write tools/);
});

test("ADMIN bypasses policy gates", () => {
  const result = evaluatePolicy({
    actor: {
      id: "admin",
      email: "admin@example.com",
      role: "ADMIN",
      teamId: null,
    },
    action: "tool:update",
    ownerTeamId: "team-b",
  });
  assert.equal(result.allow, true);
});
