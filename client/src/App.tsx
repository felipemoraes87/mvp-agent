import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { AuthProvider } from "./lib/auth";
import { RequireAuth } from "./components/RequireAuth";
import { AppLayout } from "./components/AppLayout";
import { LoginPage } from "./pages/LoginPage";
import { DashboardPage } from "./pages/DashboardPage";
import { AgentsPage } from "./pages/AgentsPage";
import { WorkflowsPage } from "./pages/WorkflowsPage";
import { ToolsPage } from "./pages/ToolsPage";
import { KnowledgePage } from "./pages/KnowledgePage";
import { GraphPage } from "./pages/GraphPage";
import { SimulatorPage } from "./pages/SimulatorPage";
import { AccessPage } from "./pages/AccessPage";
import { ExecDashboardPage } from "./pages/ExecDashboardPage";
import { SkillsPage } from "./pages/SkillsPage";
import { ChannelsPage } from "./pages/ChannelsPage";
import { ConfigurationPage } from "./pages/ConfigurationPage";
import { DebugPage } from "./pages/DebugPage";
import { LogsPage } from "./pages/LogsPage";
import { DocsPage } from "./pages/DocsPage";
import { GraphTestPage } from "./pages/GraphTestPage";

function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route
            path="/"
            element={
              <RequireAuth>
                <AppLayout />
              </RequireAuth>
            }
          >
            <Route index element={<DashboardPage />} />
            <Route path="agents" element={<AgentsPage />} />
            <Route path="workflows" element={<WorkflowsPage />} />
            <Route path="tools" element={<ToolsPage />} />
            <Route path="skills" element={<SkillsPage />} />
            <Route path="knowledge" element={<KnowledgePage />} />
            <Route path="channels" element={<ChannelsPage />} />
            <Route path="graph" element={<GraphPage />} />
            <Route path="graph-test" element={<GraphTestPage />} />
            <Route path="playground" element={<SimulatorPage />} />
            <Route path="exec-dashboard" element={<ExecDashboardPage />} />
            <Route path="configuration" element={<ConfigurationPage />} />
            <Route path="debug" element={<DebugPage />} />
            <Route path="logs" element={<LogsPage />} />
            <Route path="docs" element={<DocsPage />} />
            <Route path="simulator" element={<Navigate to="/playground" replace />} />
            <Route path="access" element={<AccessPage />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}

export default App;
