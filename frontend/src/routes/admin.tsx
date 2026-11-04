import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { PinPad } from "@/components/admin/PinPad";
import { AdminDashboard } from "@/components/admin/AdminDashboard";
import { MACHINE_BACKDROP } from "@/lib/drinks";

export const Route = createFileRoute("/admin")({
  head: () => ({
    meta: [
      { title: "Cocktail Craft — Staff Console" },
      { name: "description", content: "Staff console for the Cocktail Craft kiosk" },
    ],
  }),
  component: AdminPage,
});

function AdminPage() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);

  return (
    <div
      className={`admin-ui admin-kiosk-shell ${isAuthenticated ? "" : "admin-kiosk-shell--login"}`}
    >
      <div
        className="admin-backdrop"
        style={{ backgroundImage: `url("${MACHINE_BACKDROP}")` }}
        aria-hidden="true"
      />
      <div
        className={`admin-kiosk-shell__content ${isAuthenticated ? "" : "admin-kiosk-shell__content--login"}`}
      >
        {isAuthenticated ? (
          <AdminDashboard onLogout={() => setIsAuthenticated(false)} />
        ) : (
          <PinPad onSuccess={() => setIsAuthenticated(true)} pinLength={4} />
        )}
      </div>
    </div>
  );
}
