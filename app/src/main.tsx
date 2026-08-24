import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Outlet, RouterProvider, createRootRoute, createRoute, createRouter } from "@tanstack/react-router";
import { Workspace } from "./workspace";
import "./styles.css";

const rootRoute = createRootRoute({ component: Outlet });
const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: () => <Workspace />,
});
const taskRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/tasks/$taskId",
  validateSearch: (search: Record<string, unknown>): { run?: string } =>
    typeof search.run === "string" && search.run ? { run: search.run } : {},
  component: TaskWorkspace,
});

function TaskWorkspace() {
  const { taskId } = taskRoute.useParams();
  const { run } = taskRoute.useSearch();
  const navigate = taskRoute.useNavigate();
  return <Workspace taskId={taskId} selectedRun={run} onSelectRun={(next) => void navigate({ search: next ? { run: next } : {}, replace: true })} />;
}

const router = createRouter({ routeTree: rootRoute.addChildren([indexRoute, taskRoute]), defaultPreload: "intent" });
declare module "@tanstack/react-router" { interface Register { router: typeof router } }

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 10_000, retry: 1 } },
});
const root = document.getElementById("app");
if (!root) throw new Error("Missing #app");
createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);
