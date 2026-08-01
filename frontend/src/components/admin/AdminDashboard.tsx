import { useState, useEffect } from "react";
import { 
  Wine, 
  Droplet, 
  Settings2, 
  Activity,
  LogOut,
  FlaskConical,
  ListOrdered
} from "lucide-react";
import { DrinksManager } from "./DrinksManager";
import { PumpsManager } from "./PumpsManager";
import { HardwareManager } from "./HardwareManager";
import { SettingsManager } from "./SettingsManager";
import { IngredientsManager } from "./IngredientsManager";
import { OrdersManager } from "./OrdersManager";

interface AdminDashboardProps {
  onLogout: () => void;
}

export function AdminDashboard({ onLogout }: AdminDashboardProps) {
  const [activeTab, setActiveTab] = useState("drinks");
  const [machineStatus, setMachineStatus] = useState("idle");
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState("");
  const [currentOrderId, setCurrentOrderId] = useState<number | null>(null);
  const [hardwareConnected, setHardwareConnected] = useState(false);

  useEffect(() => {
    const evtSource = new EventSource(`http://${window.location.hostname}:5000/stream`);

    evtSource.addEventListener("init", (e) => {
      const data = JSON.parse(e.data);
      setMachineStatus(data.machine_status);
      setProgress(data.progress || 0);
      setMessage(data.message || "");
      setCurrentOrderId(data.current_order_id || null);
      setHardwareConnected(Boolean(data.connected));
    });

    evtSource.addEventListener("status", (e) => {
      const data = JSON.parse(e.data);
      setMachineStatus(data.machine_status);
      setProgress(data.progress || 0);
      setMessage(data.message || "");
      setCurrentOrderId(data.order_id || null);
      if (typeof data.connected === "boolean") setHardwareConnected(data.connected);
    });

    evtSource.onerror = () => {
      setHardwareConnected(false);
    };

    return () => evtSource.close();
  }, []);

  const navItems = [
    { id: "orders", label: "Orders", icon: ListOrdered },
    { id: "drinks", label: "Drinks", icon: Wine },
    { id: "ingredients", label: "Ingredients", icon: FlaskConical },
    { id: "pumps", label: "Pumps (6)", icon: Droplet },
    { id: "hardware", label: "Hardware", icon: Activity },
    { id: "settings", label: "Settings", icon: Settings2 },
  ];
  const stationReady = hardwareConnected;
  const stationState = !hardwareConnected
    ? "controller offline"
    : machineStatus.replace("_", " ");
  const stationClass = !stationReady
    ? "is-error"
    : machineStatus === "idle"
      ? "is-idle"
      : machineStatus === "error"
        ? "is-error"
        : "is-busy";

  return (
    <div className="admin-dashboard">
      <aside className="admin-dashboard__sidebar">
        <div>
          <div className="admin-dashboard__brand">
            <span><Wine size={25} aria-hidden="true" /></span>
            <div><strong>Cocktail Craft</strong><small>Staff console</small></div>
          </div>
          <p className="admin-dashboard__nav-label">Management</p>
          <nav className="admin-dashboard__nav" aria-label="Admin sections">
            {navItems.map((item) => (
              <button
                type="button"
                key={item.id}
                onClick={() => setActiveTab(item.id)}
                className={activeTab === item.id ? "is-active" : ""}
              >
                <item.icon size={20} aria-hidden="true" />
                <span>{item.label}</span>
              </button>
            ))}
          </nav>
        </div>
        <button type="button" onClick={onLogout} className="admin-dashboard__logout">
          <LogOut size={19} aria-hidden="true" /> Exit Admin
        </button>
      </aside>

      <main className="admin-dashboard__main">
        <header className="admin-dashboard__header">
          <div><p>Staff administration</p><h1>{navItems.find(item => item.id === activeTab)?.label}</h1></div>
          <div className={`admin-dashboard__status ${stationClass}`}>
            <i aria-hidden="true" />
            <span>Station 01 · {stationState}</span>
            {stationReady && currentOrderId && machineStatus !== "idle" && <small>Order #{currentOrderId}</small>}
          </div>
        </header>

        {machineStatus !== "idle" && (
          <div className="admin-dashboard__activity">
            <div><span>Live machine activity</span><strong>{message || machineStatus.replace("_", " ")}</strong></div>
            <div className="admin-dashboard__progress"><i style={{ width: `${progress}%` }} /></div>
            <b>{progress}%</b>
          </div>
        )}

        <div className="admin-dashboard__content">
          {activeTab === "orders" && <OrdersManager />}
          {activeTab === "drinks" && <DrinksManager />}
          {activeTab === "ingredients" && <IngredientsManager />}
          {activeTab === "pumps" && <PumpsManager machineStatus={machineStatus} />}
          {activeTab === "hardware" && <HardwareManager machineStatus={machineStatus} />}
          {activeTab === "settings" && <SettingsManager />}
        </div>
      </main>

      <nav className="admin-dashboard__mobile-nav" aria-label="Admin sections">
        {navItems.map((item) => (
          <button type="button" key={item.id} onClick={() => setActiveTab(item.id)} className={activeTab === item.id ? "is-active" : ""}>
            <item.icon size={18} aria-hidden="true" />
            <span>{item.id === "pumps" ? "Pumps" : item.label}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}
