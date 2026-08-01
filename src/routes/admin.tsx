import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { PinPad } from "@/components/admin/PinPad";
import { AdminDashboard } from "@/components/admin/AdminDashboard";

export const Route = createFileRoute("/admin")({
  head: () => ({
    meta: [
      { title: "Cocktail Crafter — Admin Panel" },
      { name: "description", content: "Admin Panel for the Cocktail Crafter kiosk" },
    ],
  }),
  component: AdminPage,
});

function AdminPage() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);

  return (
    <div className="admin-ui admin-kiosk-shell">
      <div className="admin-kiosk-shell__glow" aria-hidden="true" />
      <div className={`admin-kiosk-shell__content ${isAuthenticated ? "" : "admin-kiosk-shell__content--login"}`}>
        {isAuthenticated ? (
          <AdminDashboard onLogout={() => setIsAuthenticated(false)} />
        ) : (
          <PinPad onSuccess={() => setIsAuthenticated(true)} correctPin="1234" pinLength={4} />
        )}
      </div>
    </div>
  );
}
