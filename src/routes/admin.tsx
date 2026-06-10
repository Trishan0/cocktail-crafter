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
    <div className="min-h-screen bg-page text-page-foreground flex items-center justify-center overflow-hidden">
      {/* Ambient page glow */}
      <div
        className="pointer-events-none fixed inset-0 opacity-60"
        style={{ background: "radial-gradient(60% 50% at 50% 40%, oklch(0.83 0.09 85 / 8%), transparent 70%)" }}
      />

      <div className="w-full h-full z-10 relative">
        {isAuthenticated ? (
          <AdminDashboard onLogout={() => setIsAuthenticated(false)} />
        ) : (
          <PinPad onSuccess={() => setIsAuthenticated(true)} correctPin="1234" pinLength={4} />
        )}
      </div>
    </div>
  );
}
