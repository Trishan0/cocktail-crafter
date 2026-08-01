import { useState, useEffect, useRef, useCallback } from "react";
import { History, Receipt, ChevronDown, ChevronUp, Wifi, WifiOff } from "lucide-react";

export function OrdersManager() {
  const [orders, setOrders] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [liveConnected, setLiveConnected] = useState(false);
  // Track any order_id that is actively in progress
  const [activeOrderId, setActiveOrderId] = useState<number | null>(null);
  const evtRef = useRef<EventSource | null>(null);

  const fetchOrders = useCallback(async (showSpinner = false) => {
    if (showSpinner) setLoading(true);
    try {
      const res = await fetch(`http://${window.location.hostname}:5000/api/orders`);
      const data = await res.json();
      setOrders(data.orders || []);
    } catch (e) {
      console.error("Failed to fetch orders:", e);
    }
    if (showSpinner) setLoading(false);
  }, []);

  // Initial load
  useEffect(() => {
    fetchOrders(true);
  }, [fetchOrders]);

  // SSE subscription — refresh orders whenever a status-changing event arrives
  useEffect(() => {
    const connect = () => {
      const src = new EventSource(`http://${window.location.hostname}:5000/stream`);
      evtRef.current = src;

      src.addEventListener("init", () => setLiveConnected(true));

      src.addEventListener("status", (e) => {
        setLiveConnected(true);
        const data = JSON.parse(e.data);
        const status = data.machine_status;
        const orderId = data.order_id ?? null;

        // Track which order is in-flight so the row shows a live badge
        setActiveOrderId(status === "idle" ? null : orderId);

        // Re-fetch the list when the machine reaches a terminal state
        // (idle = order completed+cleaned, error, aborted)
        if (["idle", "error", "aborted"].includes(status)) {
          fetchOrders();
        }
      });

      src.onerror = () => {
        setLiveConnected(false);
        src.close();
        // Reconnect after 5s
        setTimeout(connect, 5000);
      };
    };

    connect();
    return () => {
      evtRef.current?.close();
    };
  }, [fetchOrders]);

  const toggleExpand = (id: number) => {
    setExpandedId(prev => prev === id ? null : id);
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case "done":    return "text-green-400 bg-green-500/10 border-green-500/20";
      case "error":   return "text-red-400 bg-red-500/10 border-red-500/20";
      case "aborted": return "text-orange-400 bg-orange-500/10 border-orange-500/20";
      case "pending": return "text-blue-400 bg-blue-500/10 border-blue-500/20";
      default:        return "text-gray-400 bg-gray-500/10 border-gray-500/20";
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-serif tracking-widest text-primary uppercase flex items-center gap-3">
            <History className="w-8 h-8" />
            Order History
          </h2>
          <p className="text-muted-foreground mt-2">Recent drink orders and their statuses.</p>
        </div>

        <div className="flex items-center gap-3">
          {/* Live indicator */}
          <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs border transition-colors ${
            liveConnected
              ? "text-green-400 border-green-500/20 bg-green-500/10"
              : "text-muted-foreground border-white/10 bg-white/5"
          }`}>
            {liveConnected
              ? <><Wifi className="w-3 h-3" /> Live</>
              : <><WifiOff className="w-3 h-3" /> Offline</>
            }
          </div>
          <button
            onClick={() => fetchOrders(true)}
            className="px-4 py-2 bg-white/5 hover:bg-white/10 rounded-xl transition-colors text-sm"
          >
            Refresh
          </button>
        </div>
      </div>

      {loading ? (
        <div className="p-12 text-center text-muted-foreground">Loading orders...</div>
      ) : orders.length === 0 ? (
        <div className="p-12 text-center border border-white/10 rounded-3xl bg-card/40 backdrop-blur-md">
          <Receipt className="w-12 h-12 mx-auto text-muted-foreground mb-4 opacity-50" />
          <p className="text-muted-foreground">No orders yet.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {orders.map((order) => {
            const isActive = activeOrderId === order.id;

            return (
              <div
                key={order.id}
                className={`border rounded-2xl bg-card/40 backdrop-blur-md overflow-hidden transition-all duration-300 ${
                  isActive
                    ? "border-blue-500/40 shadow-[0_0_16px_rgba(59,130,246,0.15)]"
                    : "border-white/10"
                }`}
              >
                <div
                  className="p-4 md:p-6 flex flex-col md:flex-row md:items-center justify-between gap-4 cursor-pointer hover:bg-white/5"
                  onClick={() => toggleExpand(order.id)}
                >
                  <div className="flex items-center gap-4 flex-1">
                    <div className="w-12 h-12 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center text-primary shrink-0 text-sm font-medium">
                      #{order.id}
                    </div>
                    <div>
                      <h3 className="text-xl font-display">{order.recipe_name}</h3>
                      <div className="text-xs text-muted-foreground flex items-center gap-2 mt-1">
                        <span>{new Date(order.ordered_at + 'Z').toLocaleString()}</span>
                        {order.price > 0 && (
                          <>
                            <span>•</span>
                            <span className="text-primary">${order.price.toFixed(2)}</span>
                          </>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center justify-between md:justify-end gap-4 md:w-auto">
                    {isActive ? (
                      <span className="px-3 py-1 rounded-full text-xs uppercase tracking-wider border text-blue-400 bg-blue-500/10 border-blue-500/20 animate-pulse">
                        In Progress…
                      </span>
                    ) : (
                      <span className={`px-3 py-1 rounded-full text-xs uppercase tracking-wider border ${getStatusColor(order.status)}`}>
                        {order.status}
                      </span>
                    )}
                    <button className="text-muted-foreground p-2 hover:bg-white/10 rounded-full transition-colors">
                      {expandedId === order.id ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
                    </button>
                  </div>
                </div>

                {/* Expanded details */}
                {expandedId === order.id && (
                  <div className="p-4 md:p-6 border-t border-white/5 bg-black/20 flex flex-col md:flex-row gap-8 text-sm">
                    <div className="flex-1 space-y-4">
                      <div>
                        <h4 className="text-xs uppercase tracking-widest text-muted-foreground mb-2">Ingredients Snapshot</h4>
                        {order.ingredients_snapshot ? (
                          <ul className="space-y-1">
                            {JSON.parse(order.ingredients_snapshot).map((ing: any, i: number) => (
                              <li key={i} className="flex justify-between border-b border-white/5 pb-1">
                                <span>{ing.name}</span>
                                <span className="text-muted-foreground">{ing.amount_ml} ml</span>
                              </li>
                            ))}
                          </ul>
                        ) : (
                          <p className="text-muted-foreground italic">No ingredients recorded.</p>
                        )}
                      </div>
                    </div>
                    <div className="flex-1 space-y-4">
                      <div>
                        <h4 className="text-xs uppercase tracking-widest text-muted-foreground mb-2">Hardware Commands</h4>
                        {order.pump_commands ? (
                          <ul className="space-y-1">
                            {JSON.parse(order.pump_commands).map((cmd: any, i: number) => (
                              <li key={i} className="flex justify-between border-b border-white/5 pb-1">
                                <span>Pump {cmd.pump}</span>
                                <span className="text-muted-foreground text-xs">{cmd.duration_ms} ms</span>
                              </li>
                            ))}
                          </ul>
                        ) : (
                          <p className="text-muted-foreground italic">No commands recorded.</p>
                        )}
                      </div>
                      {order.completed_at && (
                        <div className="text-xs text-muted-foreground pt-2">
                          Completed at: {new Date(order.completed_at + 'Z').toLocaleString()}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
