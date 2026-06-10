import { useState, useEffect } from "react";
import { Droplet, Settings } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getPumps, getIngredients, assignPump, updatePumpFlowRate } from "@/lib/api";

export function PumpsManager() {
  const [pumps, setPumps] = useState<any[]>([]);
  const [ingredients, setIngredients] = useState<any[]>([]);
  const [selectedPump, setSelectedPump] = useState<any>(null);
  
  // Edit State
  const [assignId, setAssignId] = useState<string>("none");
  const [flowRate, setFlowRate] = useState<string>("1.5");
  const [isDialogOpen, setIsDialogOpen] = useState(false);

  const loadData = async () => {
    try {
      const [pRes, iRes] = await Promise.all([getPumps(), getIngredients()]);
      setPumps(pRes.pumps);
      setIngredients(iRes.ingredients);
    } catch (e) {
      console.error("Failed to load pumps/ingredients", e);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const openConfig = (pump: any) => {
    setSelectedPump(pump);
    setAssignId(pump.ingredient_id ? pump.ingredient_id.toString() : "none");
    setFlowRate(pump.flow_rate_ml_per_s.toString());
    setIsDialogOpen(true);
  };

  const handleSave = async () => {
    if (!selectedPump) return;
    try {
      const ingId = assignId === "none" ? null : parseInt(assignId);
      await assignPump(selectedPump.pump_number, ingId);
      await updatePumpFlowRate(selectedPump.pump_number, parseFloat(flowRate));
      setIsDialogOpen(false);
      loadData();
    } catch (e) {
      alert(e);
    }
  };

  return (
    <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-8 md:mb-10 gap-4">
        <div>
          <h2 className="text-3xl md:text-4xl font-serif font-light mb-1 md:mb-2">Pump Configuration</h2>
          <p className="text-sm md:text-base text-muted-foreground">Assign liquids to the 6 hardware pumps</p>
        </div>
      </div>
      
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 md:gap-6">
        {pumps.map((pump) => {
          return (
            <div key={pump.id} className="p-5 md:p-6 rounded-3xl border border-white/10 bg-card/40 backdrop-blur-md flex flex-col justify-between">
              <div className="flex flex-col sm:flex-row sm:items-start justify-between mb-6 gap-4">
                <div className="flex items-center gap-4">
                  <div className={`w-14 h-14 md:w-16 md:h-16 rounded-full flex shrink-0 items-center justify-center text-xl md:text-2xl font-bold border-2 ${
                    pump.ingredient_name ? "bg-primary/20 text-primary border-primary/30" : "bg-white/5 text-muted-foreground border-white/10"
                  }`}>
                    {pump.pump_number}
                  </div>
                  <div>
                    <h3 className="text-xl md:text-2xl font-display font-light">Pump {pump.pump_number}</h3>
                    <p className={`text-xs md:text-sm ${pump.ingredient_name ? "text-white" : "text-muted-foreground"}`}>
                      {pump.ingredient_name ? pump.ingredient_name : "Unassigned"}
                    </p>
                  </div>
                </div>
                
                {pump.ingredient_name && (
                  <div className="text-left sm:text-right">
                    <div className={`text-xl md:text-2xl font-display text-accent`}>
                      {pump.flow_rate_ml_per_s} ml/s
                    </div>
                    <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
                      Flow Rate
                    </div>
                  </div>
                )}
              </div>

              <Button variant="outline" onClick={() => openConfig(pump)} className="w-full rounded-full h-12 bg-white/5 hover:bg-white/10 border-white/10">
                <Settings className="w-4 h-4 mr-2" />
                Configure Pump
              </Button>
            </div>
          );
        })}
      </div>

      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="sm:max-w-[425px] bg-card/95 backdrop-blur-xl border-border text-card-foreground">
          <DialogHeader>
            <DialogTitle className="text-2xl font-serif font-light">Configure Pump {selectedPump?.pump_number}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-6 py-4">
            <div className="grid gap-2">
              <Label className="text-muted-foreground uppercase tracking-widest text-[10px]">Assigned Liquid</Label>
              <Select value={assignId} onValueChange={setAssignId}>
                <SelectTrigger className="h-12 bg-white/5 border-white/10">
                  <SelectValue placeholder="Select liquid..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None (Unassigned)</SelectItem>
                  {ingredients.map(l => (
                    <SelectItem key={l.id} value={l.id.toString()}>{l.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            
            <div className="grid gap-2">
              <Label className="text-muted-foreground uppercase tracking-widest text-[10px]">Flow Rate (ml/s)</Label>
              <Input type="number" step="0.1" value={flowRate} onChange={e => setFlowRate(e.target.value)} className="h-12 bg-white/5 border-white/10" />
            </div>
          </div>
          <div className="flex justify-end gap-3 pt-4">
            <Button variant="outline" onClick={() => setIsDialogOpen(false)} className="rounded-full">Cancel</Button>
            <Button onClick={handleSave} className="rounded-full bg-primary text-primary-foreground">Save</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
