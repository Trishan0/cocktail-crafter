import { useState } from "react";
import { 
  Wine, 
  Droplet, 
  Settings2, 
  Activity,
  LogOut,
  FlaskConical
} from "lucide-react";
import { DrinksManager } from "./DrinksManager";
import { PumpsManager } from "./PumpsManager";
import { HardwareManager } from "./HardwareManager";
import { SettingsManager } from "./SettingsManager";
import { IngredientsManager } from "./IngredientsManager";

interface AdminDashboardProps {
  onLogout: () => void;
}

export function AdminDashboard({ onLogout }: AdminDashboardProps) {
  const [activeTab, setActiveTab] = useState("drinks");

  const navItems = [
    { id: "drinks", label: "Drinks", icon: Wine },
    { id: "ingredients", label: "Ingredients", icon: FlaskConical },
    { id: "pumps", label: "Pumps (6)", icon: Droplet },
    { id: "hardware", label: "Hardware", icon: Activity },
    { id: "settings", label: "Settings", icon: Settings2 },
  ];

  return (
    <div className="flex flex-col md:flex-row h-screen w-full bg-background text-foreground overflow-hidden font-sans">
      {/* Mobile Header */}
      <div className="md:hidden flex items-center justify-between p-4 bg-card/30 backdrop-blur-md border-b border-border">
        <div>
          <h1 className="text-xl font-serif tracking-widest text-primary uppercase">Admin</h1>
          <p className="text-muted-foreground text-xs mt-1">Configuration</p>
        </div>
        <button onClick={onLogout} className="text-red-400 p-2">
          <LogOut className="w-5 h-5" />
        </button>
      </div>

      {/* Desktop Sidebar Navigation */}
      <div className="hidden md:flex w-64 bg-card/30 backdrop-blur-md border-r border-border flex-col justify-between py-8">
        <div>
          <div className="px-8 mb-12">
            <h1 className="text-2xl font-serif tracking-widest text-primary uppercase">Admin Panel</h1>
            <p className="text-muted-foreground text-sm mt-2">Machine Configuration</p>
          </div>
          
          <nav className="flex flex-col gap-2 px-4">
            {navItems.map((item) => (
              <button
                key={item.id}
                onClick={() => setActiveTab(item.id)}
                className={`flex items-center gap-4 px-6 py-4 rounded-xl transition-all duration-300 ${
                  activeTab === item.id 
                    ? "bg-primary/20 text-primary border border-primary/30" 
                    : "text-muted-foreground hover:bg-white/5 hover:text-foreground"
                }`}
              >
                <item.icon className="w-6 h-6" />
                <span className="font-medium text-lg">{item.label}</span>
              </button>
            ))}
          </nav>
        </div>

        <div className="px-4">
          <button
            onClick={onLogout}
            className="flex items-center gap-4 px-6 py-4 w-full rounded-xl text-red-400 hover:bg-red-500/10 hover:text-red-300 transition-all duration-300"
          >
            <LogOut className="w-6 h-6" />
            <span className="font-medium text-lg">Exit Admin</span>
          </button>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 overflow-y-auto p-4 md:p-12 pb-24 md:pb-12 bg-black/20">
        {activeTab === "drinks" && <DrinksManager />}
        {activeTab === "ingredients" && <IngredientsManager />}
        {activeTab === "pumps" && <PumpsManager />}
        {activeTab === "hardware" && <HardwareManager />}
        {activeTab === "settings" && <SettingsManager />}
      </div>

      {/* Mobile Bottom Navigation */}
      <div className="md:hidden fixed bottom-0 left-0 right-0 bg-card/80 backdrop-blur-xl border-t border-border flex justify-around items-center p-2 z-50">
        {navItems.map((item) => (
          <button
            key={item.id}
            onClick={() => setActiveTab(item.id)}
            className={`flex flex-col items-center justify-center p-2 w-16 h-14 rounded-xl transition-all duration-300 ${
              activeTab === item.id 
                ? "text-primary" 
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <item.icon className="w-5 h-5 mb-1" />
            <span className="text-[10px] font-medium">{item.id === "pumps" ? "Pumps" : item.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
