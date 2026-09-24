import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { lazy, Suspense } from "react";
import { Route, Switch } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import Home from "./pages/Home";
import NotFound from "./pages/NotFound";
import { Accounts } from "./pages/app/Accounts";
import { AppLayout } from "./pages/app/AppLayout";
import { Disclose } from "./pages/app/Disclose";
import { Pay } from "./pages/app/Pay";
import { Policy } from "./pages/app/Policy";
import { Recovery } from "./pages/app/Recovery";
import { Verify } from "./pages/app/Verify";
import { VeraKeyProvider } from "./state/VeraKeyProvider";

const DocsSite = lazy(() => import("./docs/DocsSite"));
const ConnectPage = lazy(() => import("./pages/connect/ConnectPage"));

function Router() {
  return (
    <Switch>
      <Route path="/" component={Home} />
      <Route path="/app">{() => <AppLayout><Accounts /></AppLayout>}</Route>
      <Route path="/app/pay">{() => <AppLayout><Pay /></AppLayout>}</Route>
      <Route path="/app/policy">{() => <AppLayout><Policy /></AppLayout>}</Route>
      <Route path="/app/recovery">{() => <AppLayout><Recovery /></AppLayout>}</Route>
      <Route path="/app/disclose">{() => <AppLayout><Disclose /></AppLayout>}</Route>
      <Route path="/app/verify">{() => <AppLayout requiresSession={false}><Verify /></AppLayout>}</Route>
      <Route path="/connect">{() => <Suspense fallback={null}><ConnectPage /></Suspense>}</Route>
      <Route path="/docs">{() => <Suspense fallback={null}><DocsSite /></Suspense>}</Route>
      <Route path="/docs/*">{() => <Suspense fallback={null}><DocsSite /></Suspense>}</Route>
      <Route path="/404" component={NotFound} />
      <Route component={NotFound} />
    </Switch>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider defaultTheme="dark">
        <TooltipProvider>
          <VeraKeyProvider>
            <Toaster theme="dark" />
            <Router />
          </VeraKeyProvider>
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}
