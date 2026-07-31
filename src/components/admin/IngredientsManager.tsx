import { useState, useEffect } from "react";
import { Plus, Edit2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { getIngredients, createIngredient, updateIngredient, deleteIngredient } from "@/lib/api";

export function IngredientsManager() {
  const [ingredients, setIngredients] = useState<any[]>([]);
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [currentIng, setCurrentIng] = useState<any>(null);
  
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");

  const load = async () => {
    try {
      const data = await getIngredients();
      setIngredients(data.ingredients);
    } catch (e) {
      console.error(e);
    }
  };

  useEffect(() => { load(); }, []);

  const handleCreate = async () => {
    try {
      await createIngredient(name, desc);
      setIsAddOpen(false);
      setName(""); setDesc("");
      load();
    } catch (e) {
      alert(e);
    }
  };

  const handleUpdate = async () => {
    if (!currentIng) return;
    try {
      await updateIngredient(currentIng.id, name, desc);
      setIsEditOpen(false);
      load();
    } catch (e) {
      alert(e);
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm("Are you sure? This will remove it from recipes and pumps too.")) return;
    try {
      await deleteIngredient(id);
      load();
    } catch (e) {
      alert(e);
    }
  };

  const openEdit = (ing: any) => {
    setCurrentIng(ing);
    setName(ing.name);
    setDesc(ing.description || "");
    setIsEditOpen(true);
  };

  return (
    <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-8 md:mb-10 gap-4">
        <div>
          <h2 className="text-3xl md:text-4xl font-serif font-light mb-1 md:mb-2">Ingredients Pool</h2>
          <p className="text-sm md:text-base text-muted-foreground">Manage all known liquids the machine can handle</p>
        </div>
        
        <Dialog open={isAddOpen} onOpenChange={setIsAddOpen}>
          <DialogTrigger asChild>
            <Button size="lg" className="w-full md:w-auto rounded-full gap-2 px-6 h-12 md:h-14 text-base md:text-lg bg-primary text-primary-foreground hover:bg-primary/90" onClick={() => { setName(""); setDesc(""); }}>
              <Plus className="w-5 h-5" />
              Add Ingredient
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-[425px] bg-card/95 backdrop-blur-xl border-border text-card-foreground">
            <DialogHeader>
              <DialogTitle className="text-2xl font-serif font-light">New Ingredient</DialogTitle>
            </DialogHeader>
            <div className="grid gap-6 py-4">
              <div className="grid gap-2">
                <Label className="text-muted-foreground uppercase tracking-widest text-[10px]">Name</Label>
                <Input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Vodka" className="h-12 bg-white/5 border-white/10" />
              </div>
              <div className="grid gap-2">
                <Label className="text-muted-foreground uppercase tracking-widest text-[10px]">Description</Label>
                <Textarea value={desc} onChange={e => setDesc(e.target.value)} placeholder="Optional details..." className="bg-white/5 border-white/10 resize-none" rows={3} />
              </div>
            </div>
            <div className="flex justify-end gap-3 pt-4">
              <Button variant="outline" onClick={() => setIsAddOpen(false)} className="rounded-full">Cancel</Button>
              <Button onClick={handleCreate} className="rounded-full bg-primary text-primary-foreground">Save</Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>
      
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 md:gap-6">
        {ingredients.map((ing) => (
          <div key={ing.id} className="surface-card rounded-2xl p-5 md:p-6 flex flex-col justify-between hover:ring-1 hover:ring-accent/60 transition bg-card/40 border border-white/10">
            <div>
              <h3 className="text-xl md:text-2xl font-display font-light mb-2">{ing.name}</h3>
              <p className="text-xs md:text-sm text-muted-foreground mb-4">{ing.description || "No description."}</p>
            </div>
            <div className="flex gap-2 mt-4 md:mt-6 pt-4 border-t border-white/10">
              <Button variant="ghost" onClick={() => openEdit(ing)} className="flex-1 rounded-full bg-white/5 hover:bg-white/10">
                <Edit2 className="w-4 h-4 mr-2" /> Edit
              </Button>
              <Button variant="ghost" onClick={() => handleDelete(ing.id)} className="rounded-full bg-red-500/10 text-red-400 hover:bg-red-500/20 hover:text-red-300">
                <Trash2 className="w-4 h-4" />
              </Button>
            </div>
          </div>
        ))}
      </div>

      <Dialog open={isEditOpen} onOpenChange={setIsEditOpen}>
        <DialogContent className="sm:max-w-[425px] bg-card/95 backdrop-blur-xl border-border text-card-foreground">
          <DialogHeader>
            <DialogTitle className="text-2xl font-serif font-light">Edit Ingredient</DialogTitle>
          </DialogHeader>
          <div className="grid gap-6 py-4">
            <div className="grid gap-2">
              <Label className="text-muted-foreground uppercase tracking-widest text-[10px]">Name</Label>
              <Input value={name} onChange={e => setName(e.target.value)} className="h-12 bg-white/5 border-white/10" />
            </div>
            <div className="grid gap-2">
              <Label className="text-muted-foreground uppercase tracking-widest text-[10px]">Description</Label>
              <Textarea value={desc} onChange={e => setDesc(e.target.value)} className="bg-white/5 border-white/10 resize-none" rows={3} />
            </div>
          </div>
          <div className="flex justify-end gap-3 pt-4">
            <Button variant="outline" onClick={() => setIsEditOpen(false)} className="rounded-full">Cancel</Button>
            <Button onClick={handleUpdate} className="rounded-full bg-primary text-primary-foreground">Save Changes</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
