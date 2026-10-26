import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Layout from './layouts/Layout';
import ProtectedRoute from './components/ProtectedRoute';
import CasesList from './pages/CasesList';
import CaseDetail from './pages/CaseDetail';
import CreateCase from './pages/CreateCase';
import InstitutionsList from './pages/InstitutionsList';
import InstitutionDetail from './pages/InstitutionDetail';
import IdentityQueue from './pages/IdentityQueue';
import Overlaps from './pages/Overlaps';
import OverlapDetail from './pages/OverlapDetail';
import Reports from './pages/Reports';
import Notifications from './pages/Notifications';
import UserManagement from './pages/UserManagement';
import SlaRules from './pages/SlaRules';
import AuditLog from './pages/AuditLog';

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route element={<ProtectedRoute />}>
          <Route path="/" element={<Layout />}>
            <Route index element={<Navigate to="/dashboard" replace />} />
            <Route path="dashboard" element={<Dashboard />} />
            <Route path="cases" element={<CasesList />} />
            <Route path="cases/create" element={<CreateCase />} />
            <Route path="cases/:id" element={<CaseDetail />} />
            <Route path="institutions" element={<InstitutionsList />} />
            <Route path="institutions/:id" element={<InstitutionDetail />} />
            <Route path="identity" element={<IdentityQueue />} />
            <Route path="overlaps" element={<Overlaps />} />
            <Route path="overlaps/:id" element={<OverlapDetail />} />
            <Route path="reports" element={<Reports />} />
            <Route path="notifications" element={<Notifications />} />
            <Route element={<ProtectedRoute roles={['ADMIN']} />}>
              <Route path="admin/users" element={<UserManagement />} />
              <Route path="admin/sla-rules" element={<SlaRules />} />
              <Route path="admin/audit" element={<AuditLog />} />
            </Route>
          </Route>
        </Route>
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
