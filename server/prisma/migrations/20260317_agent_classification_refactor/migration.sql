CREATE TYPE "AgentPersona" AS ENUM ('SUPERVISOR', 'SPECIALIST', 'ANALYST', 'EXECUTOR');

CREATE TYPE "AgentRoutingRole" AS ENUM ('ENTRYPOINT', 'DISPATCHER', 'SPECIALIST', 'TERMINAL', 'FALLBACK');

CREATE TYPE "AgentExecutionProfile" AS ENUM ('READ_ONLY', 'WRITE_GUARDED', 'WRITE_ALLOWED', 'APPROVAL_REQUIRED');

ALTER TABLE "Agent"
ADD COLUMN "persona" "AgentPersona" NOT NULL DEFAULT 'SPECIALIST',
ADD COLUMN "routingRole" "AgentRoutingRole" NOT NULL DEFAULT 'SPECIALIST',
ADD COLUMN "executionProfile" "AgentExecutionProfile" NOT NULL DEFAULT 'READ_ONLY',
ADD COLUMN "capabilities" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN "domains" JSONB NOT NULL DEFAULT '[]';

UPDATE "Agent"
SET
  "persona" = CASE
    WHEN "type" = 'SUPERVISOR' THEN 'SUPERVISOR'::"AgentPersona"
    WHEN "type" = 'TICKET' THEN 'EXECUTOR'::"AgentPersona"
    ELSE 'SPECIALIST'::"AgentPersona"
  END,
  "routingRole" = CASE
    WHEN "type" = 'SUPERVISOR' THEN 'ENTRYPOINT'::"AgentRoutingRole"
    WHEN "type" = 'TICKET' THEN 'TERMINAL'::"AgentRoutingRole"
    ELSE 'SPECIALIST'::"AgentRoutingRole"
  END,
  "executionProfile" = CASE
    WHEN "type" = 'TICKET' THEN 'WRITE_GUARDED'::"AgentExecutionProfile"
    ELSE 'READ_ONLY'::"AgentExecutionProfile"
  END,
  "capabilities" = CASE
    WHEN "type" = 'SUPERVISOR' THEN '["can_route","can_handoff","can_query_knowledge"]'::jsonb
    WHEN "type" = 'TICKET' THEN '["can_open_ticket","can_call_write_tools"]'::jsonb
    ELSE '["can_query_knowledge"]'::jsonb
  END,
  "domains" = COALESCE("tags", '[]'::jsonb);
