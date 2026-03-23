-- CreateTable
CREATE TABLE "Workflow" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "objective" TEXT NOT NULL,
    "preconditions" JSONB NOT NULL DEFAULT '[]',
    "integrationKeys" JSONB NOT NULL DEFAULT '[]',
    "steps" JSONB NOT NULL DEFAULT '[]',
    "successCriteria" JSONB NOT NULL DEFAULT '[]',
    "outputFormat" TEXT NOT NULL,
    "failureHandling" JSONB NOT NULL DEFAULT '[]',
    "setupPoints" JSONB NOT NULL DEFAULT '[]',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "visibility" TEXT NOT NULL DEFAULT 'private',
    "managedBy" TEXT NOT NULL DEFAULT 'portal',
    "runtimeSource" TEXT,
    "userCustomized" BOOLEAN NOT NULL DEFAULT false,
    "customizationNote" TEXT,
    "customizationUpdatedAt" TIMESTAMP(3),
    "ownerTeamId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Workflow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentWorkflow" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "workflowId" TEXT NOT NULL,

    CONSTRAINT "AgentWorkflow_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Workflow_name_ownerTeamId_key" ON "Workflow"("name", "ownerTeamId");

-- CreateIndex
CREATE UNIQUE INDEX "AgentWorkflow_agentId_workflowId_key" ON "AgentWorkflow"("agentId", "workflowId");

-- AddForeignKey
ALTER TABLE "Workflow" ADD CONSTRAINT "Workflow_ownerTeamId_fkey" FOREIGN KEY ("ownerTeamId") REFERENCES "Team"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentWorkflow" ADD CONSTRAINT "AgentWorkflow_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentWorkflow" ADD CONSTRAINT "AgentWorkflow_workflowId_fkey" FOREIGN KEY ("workflowId") REFERENCES "Workflow"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
