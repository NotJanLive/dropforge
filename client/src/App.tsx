import { Navigate, Route, Routes } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import { DashboardLayout } from "@/components/DashboardLayout";
import { LoginPage } from "@/pages/LoginPage";
import { AdminSetupPage } from "@/pages/AdminSetupPage";
import { UserSetupPage } from "@/pages/UserSetupPage";
import { OverviewPage } from "@/pages/dashboard/OverviewPage";
import { CampaignsPage } from "@/pages/dashboard/CampaignsPage";
import { ChannelsPage } from "@/pages/dashboard/ChannelsPage";
import { SettingsPage } from "@/pages/dashboard/SettingsPage";
import { InventoryPage } from "@/pages/dashboard/InventoryPage";
import { UsersPage } from "@/pages/dashboard/UsersPage";

function CampaignsRedirect() {
  return <CampaignsPage />;
}

function ChannelsRedirect() {
  const { user } = useAuth();
  if (user?.role === "user") return <Navigate to="/dashboard" replace />;
  return <ChannelsPage />;
}

function ProtectedDashboard({ children }: { children: React.ReactNode }) {
  const { loading, status, user } = useAuth();
  if (loading) return <div className="min-h-screen flex items-center justify-center text-muted-foreground">Loading...</div>;
  if (!status?.initialized) return <Navigate to="/setup/admin" replace />;
  if (!user) return <Navigate to="/login" replace />;
  if (user.role === "admin" && !user.setupComplete) return <Navigate to="/setup/admin" replace />;
  if (user.role === "user" && (user.mustChangePassword || !user.setupComplete)) {
    return <Navigate to="/setup/user" replace />;
  }
  return <DashboardLayout>{children}</DashboardLayout>;
}

export default function App() {
  const { loading, status, user } = useAuth();

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center text-muted-foreground">Loading...</div>;
  }

  return (
    <Routes>
      <Route
        path="/"
        element={
          !status?.initialized ? (
            <Navigate to="/setup/admin" replace />
          ) : user ? (
            <Navigate to="/dashboard" replace />
          ) : (
            <Navigate to="/login" replace />
          )
        }
      />
      <Route path="/login" element={user ? <Navigate to="/dashboard" replace /> : <LoginPage />} />
      <Route
        path="/setup/admin"
        element={
          !status?.initialized || (user?.role === "admin" && !user.setupComplete) ? (
            <AdminSetupPage />
          ) : user ? (
            <Navigate to="/dashboard" replace />
          ) : (
            <Navigate to="/login" replace />
          )
        }
      />
      <Route
        path="/setup/user"
        element={
          !user ? (
            <Navigate to="/login" replace />
          ) : user.setupComplete ? (
            <Navigate to="/dashboard" replace />
          ) : (
            <UserSetupPage />
          )
        }
      />
      <Route
        path="/dashboard"
        element={
          <ProtectedDashboard>
            <OverviewPage />
          </ProtectedDashboard>
        }
      />
      <Route
        path="/dashboard/campaigns"
        element={
          <ProtectedDashboard>
            <CampaignsRedirect />
          </ProtectedDashboard>
        }
      />
      <Route
        path="/dashboard/channels"
        element={
          <ProtectedDashboard>
            <ChannelsRedirect />
          </ProtectedDashboard>
        }
      />
      <Route
        path="/dashboard/settings"
        element={
          <ProtectedDashboard>
            <SettingsPage />
          </ProtectedDashboard>
        }
      />
      <Route
        path="/dashboard/inventory"
        element={
          <ProtectedDashboard>
            <InventoryPage />
          </ProtectedDashboard>
        }
      />
      <Route
        path="/dashboard/users"
        element={
          <ProtectedDashboard>
            <UsersPage />
          </ProtectedDashboard>
        }
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
