import { Route, Routes } from 'react-router';
import { DashboardLayout } from './components/DashboardLayout';
import { EmptyState } from './components/ui';
import { StoreApp } from './features/store/StoreApp';
import { ActorProvider } from './hooks/useActor';
import { AuditPage } from './pages/AuditPage';
import { EnvironmentsPage } from './pages/EnvironmentsPage';
import { FlagDetailPage } from './pages/FlagDetailPage';
import { FlagsPage } from './pages/FlagsPage';
import { OverviewPage } from './pages/OverviewPage';
import { SegmentsPage } from './pages/SegmentsPage';

export function App() {
  return (
    <Routes>
      <Route path="/store/*" element={<StoreApp />} />
      <Route element={<ActorProvider><DashboardLayout /></ActorProvider>}>
        <Route index element={<OverviewPage />} />
        <Route path="flags" element={<FlagsPage />} />
        <Route path="flags/:key" element={<FlagDetailPage />} />
        <Route path="environments" element={<EnvironmentsPage />} />
        <Route path="segments" element={<SegmentsPage />} />
        <Route path="audit" element={<AuditPage />} />
        <Route path="*" element={<EmptyState title="Page not found" />} />
      </Route>
    </Routes>
  );
}
