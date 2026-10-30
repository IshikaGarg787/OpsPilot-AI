import { lazy, Suspense } from 'react';
import { BrowserRouter, Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom';
import { AppShell } from './components/AppShell';
import { LoadingState } from './components/ui';
import { useAuth } from './contexts/AuthContext';

const LandingPage = lazy(() => import('./pages/LandingPage').then((module) => ({ default: module.LandingPage })));
const LoginPage = lazy(() => import('./pages/AuthPages').then((module) => ({ default: module.LoginPage })));
const SignupPage = lazy(() => import('./pages/AuthPages').then((module) => ({ default: module.SignupPage })));
const ActivateItAccountPage = lazy(() => import('./pages/AuthPages').then((module) => ({ default: module.ActivateItAccountPage })));
const DashboardPage = lazy(() => import('./pages/DashboardPage').then((module) => ({ default: module.DashboardPage })));
const PredictionsPage = lazy(() => import('./pages/DashboardPage').then((module) => ({ default: module.PredictionsPage })));
const AnalyticsPage = lazy(() => import('./pages/AnalyticsPage').then((module) => ({ default: module.AnalyticsPage })));
const ComingSoonPage = lazy(() => import('./pages/ComingSoonPage').then((module) => ({ default: module.ComingSoonPage })));
const HistoryPage = lazy(() => import('./pages/HistoryPage').then((module) => ({ default: module.HistoryPage })));
const ModelCenterPage = lazy(() => import('./pages/ModelCenterPage').then((module) => ({ default: module.ModelCenterPage })));
const ResolutionPage = lazy(() => import('./pages/ResolutionPage').then((module) => ({ default: module.ResolutionPage })));
const SettingsPage = lazy(() => import('./pages/SettingsPage').then((module) => ({ default: module.SettingsPage })));
const TriagePage = lazy(() => import('./pages/TriagePage').then((module) => ({ default: module.TriagePage })));
const RecommendationEnginePage = lazy(() => import('./pages/RecommendationEnginePage').then((module) => ({ default: module.RecommendationEnginePage })));
const TicketListPage = lazy(() => import('./pages/TicketPages').then((module) => ({ default: module.TicketListPage })));
const TicketCreatePage = lazy(() => import('./pages/TicketPages').then((module) => ({ default: module.TicketCreatePage })));
const TicketDetailPage = lazy(() => import('./pages/TicketPages').then((module) => ({ default: module.TicketDetailPage })));
const UserManagementPage = lazy(() => import('./pages/UserManagementPage').then((module) => ({ default: module.UserManagementPage })));
const WorkforcePage = lazy(() => import('./pages/WorkforcePage').then((module) => ({ default: module.WorkforcePage })));
const SlaManagementPage = lazy(() => import('./pages/SlaManagementPage').then((module) => ({ default: module.SlaManagementPage })));

function ProtectedRoute() {
  const { user, loading } = useAuth(); const location = useLocation();
  if (loading) return <div className="full-page-state"><LoadingState label="Restoring your session" /></div>;
  return user ? <Outlet /> : <Navigate to="/login" replace state={{ from: location.pathname }} />;
}

function AdminRoute() {
  const { user, loading } = useAuth();
  if (loading) return <div className="full-page-state"><LoadingState label="Checking workspace access" /></div>;
  return user?.role === 'admin' ? <Outlet /> : <Navigate to="/app/tickets" replace />;
}

function NotFound() { return <div className="full-page-state"><h1>Page not found</h1><p>The workspace route you requested does not exist.</p><Navigate to="/" replace /></div>; }

export default function App() {
  return <BrowserRouter><Suspense fallback={<div className="full-page-state"><LoadingState label="Loading workspace" /></div>}><Routes><Route path="/" element={<LandingPage />} /><Route path="/login" element={<LoginPage />} /><Route path="/signup" element={<SignupPage />} /><Route path="/activate-it" element={<ActivateItAccountPage />} /><Route element={<ProtectedRoute />}><Route path="/app" element={<AppShell />}><Route index element={<DashboardPage />} /><Route path="tickets" element={<TicketListPage />} /><Route path="tickets/new" element={<TicketCreatePage />} /><Route path="tickets/:ticketId" element={<TicketDetailPage />} /><Route path="resolution-time" element={<ResolutionPage />} /><Route path="models" element={<ModelCenterPage />} /><Route path="history" element={<HistoryPage />} /><Route path="analytics" element={<AnalyticsPage />} /><Route path="settings" element={<SettingsPage />} /><Route path="operational-risk" element={<ComingSoonPage />} /><Route element={<AdminRoute />}><Route path="users" element={<UserManagementPage />} /><Route path="workforce" element={<WorkforcePage />} /><Route path="workforce/:memberId" element={<WorkforcePage />} /><Route path="predictions" element={<PredictionsPage />} /><Route path="triage" element={<TriagePage />} /><Route path="recommendations" element={<RecommendationEnginePage />} /><Route path="sla" element={<SlaManagementPage />} /></Route></Route></Route><Route path="*" element={<NotFound />} /></Routes></Suspense></BrowserRouter>;
}
