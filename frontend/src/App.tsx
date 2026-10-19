import { lazy, Suspense, type ReactNode } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import AppShell from "@/components/layout/AppShell";
import { Spinner } from "@/components/ui";
import { useMe } from "@/hooks/data";
import Landing from "@/pages/Landing";
import { ForgotPassword, Login, Register, ResetPassword } from "@/pages/Auth";
import Legal from "@/pages/Legal";

const Home = lazy(() => import("@/pages/app/Home"));
const ChatPage = lazy(() => import("@/pages/app/Chat"));
const Agents = lazy(() => import("@/pages/app/Agents"));
const Knowledge = lazy(() => import("@/pages/app/Knowledge"));
const Projects = lazy(() => import("@/pages/app/Projects"));
const ProjectDetail = lazy(() => import("@/pages/app/ProjectDetail"));
const Services = lazy(() => import("@/pages/app/Services"));
const Studio = lazy(() => import("@/pages/app/Studio"));
const Library = lazy(() => import("@/pages/app/Library"));
const Billing = lazy(() => import("@/pages/app/Billing"));
const Referral = lazy(() => import("@/pages/app/Referral"));
const Support = lazy(() => import("@/pages/app/Support"));
const Profile = lazy(() => import("@/pages/app/Profile"));
const Admin = lazy(() => import("@/pages/admin/Admin"));

function FullscreenLoader() {
  return (
    <div className="grid h-[100dvh] place-items-center">
      <Spinner className="h-7 w-7" />
    </div>
  );
}

function RequireAuth({ children, admin }: { children: ReactNode; admin?: boolean }) {
  const { data: user, isLoading } = useMe();
  const location = useLocation();
  if (isLoading) return <FullscreenLoader />;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  if (admin && user.role !== "admin") return <Navigate to="/app" replace />;
  return <>{children}</>;
}

function GuestOnly({ children }: { children: ReactNode }) {
  const { data: user, isLoading } = useMe();
  if (isLoading) return <FullscreenLoader />;
  return user ? <Navigate to="/app" replace /> : <>{children}</>;
}

export default function App() {
  return (
    <Suspense fallback={<FullscreenLoader />}>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/login" element={<GuestOnly><Login /></GuestOnly>} />
        <Route path="/forgot-password" element={<GuestOnly><ForgotPassword /></GuestOnly>} />
        <Route path="/reset-password" element={<ResetPassword />} />
        <Route path="/legal/:slug" element={<Legal />} />
        <Route path="/register" element={<GuestOnly><Register /></GuestOnly>} />
        <Route path="/app" element={<RequireAuth><AppShell /></RequireAuth>}>
          <Route index element={<Home />} />
          <Route path="chat" element={<ChatPage />} />
          <Route path="chat/:chatId" element={<ChatPage />} />
          <Route path="agents" element={<Agents />} />
          <Route path="knowledge" element={<Knowledge />} />
          <Route path="knowledge/:kbId" element={<Knowledge />} />
          <Route path="projects" element={<Projects />} />
          <Route path="projects/:projectId" element={<ProjectDetail />} />
          <Route path="services" element={<Services />} />
          <Route path="services/:slug" element={<Services />} />
          <Route path="studio" element={<Studio />} />
          <Route path="library" element={<Library />} />
          <Route path="billing" element={<Billing />} />
          <Route path="referral" element={<Referral />} />
          <Route path="support" element={<Support />} />
          <Route path="support/:ticketId" element={<Support />} />
          <Route path="profile" element={<Profile />} />
          <Route path="admin" element={<RequireAuth admin><Admin /></RequireAuth>} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  );
}
