import { useState, useEffect } from "react";
import { Plus, Edit2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { getAdminRecipes, getIngredients, createRecipe, updateRecipe, deleteRecipe } from "@/lib/api";

export function DrinksManager() {
  const [recipes, setRecipes] = useState<any[]>([]);
  const [availableIngredients, setAvailableIngredients] = useState<any[]>([]);
  
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [currentRecipe, setCurrentRecipe] = useState<any>(null);

  // Form State
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [category, setCategory] = useState("classic");
  const [price, setPrice] = useState("0");
  const [isVisible, setIsVisible] = useState(true);
  const [ingredients, setIngredients] = useState<{ingredient_id: number, amount_ml: number}[]>([]);

  const loadData = async () => {
    try {
      const [rRes, iRes] = await Promise.all([getAdminRecipes(), getIngredients()]);
      setRecipes(rRes.recipes);
      setAvailableIngredients(iRes.ingredients);
    } catch (e) {
      console.error(e);
    }
  };

  useEffect(() => { loadData(); }, []);

  const openAdd = () => {
    setName(""); setDesc(""); setCategory("classic"); setPrice("0");
    setIsVisible(true); setIngredients([]);
    setIsAddOpen(true);
  };

  const openEdit = (r: any) => {
    setCurrentRecipe(r);
    setName(r.name); setDesc(r.description); setCategory(r.category);
    setPrice(r.price.toString()); setIsVisible(r.is_visible === 1);
    setIngredients(r.ingredients.map((i: any) => ({ ingredient_id: i.id, amount_ml: i.amount_ml })));
    setIsEditOpen(true);
  };

  const handleSave = async (isNew: boolean) => {
    const payload = {
      name, description: desc, category, price: parseFloat(price),
      is_visible: isVisible ? 1 : 0,
      ingredients
    };
    try {
      if (isNew) {
        await createRecipe(payload);
        setIsAddOpen(false);
      } else {
        await updateRecipe(currentRecipe.id, payload);
        setIsEditOpen(false);
      }
      loadData();
    } catch (e) {
      alert(e);
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm("Are you sure you want to delete this recipe?")) return;
    try {
      await deleteRecipe(id);
      loadData();
    } catch (e) {
      alert(e);
    }
  };

  const updateIngredientAmount = (idx: number, amount: number) => {
    const newIngs = [...ingredients];
    newIngs[idx].amount_ml = amount;
    setIngredients(newIngs);
  };

  const updateIngredientId = (idx: number, id: number) => {
    const newIngs = [...ingredients];
    newIngs[idx].ingredient_id = id;
    setIngredients(newIngs);
  };

  const addIngredientRow = () => {
    if (availableIngredients.length === 0) return;
    setIngredients([...ingredients, { ingredient_id: availableIngredients[0].id, amount_ml: 10 }]);
  };

  const removeIngredientRow = (idx: number) => {
    setIngredients(ingredients.filter((_, i) => i !== idx));
  };

  const renderForm = () => (
    <div className="grid gap-6 py-4 max-h-[60vh] overflow-y-auto custom-scrollbar pr-2">
      <div className="grid gap-2">
        <Label className="text-muted-foreground uppercase tracking-widest text-[10px]">Drink Name</Label>
        <Input value={name} onChange={e=>setName(e.target.value)} placeholder="e.g. Margarita" className="h-12 bg-white/5 border-white/10" />
      </div>
      <div className="grid gap-2">
        <Label className="text-muted-foreground uppercase tracking-widest text-[10px]">Description</Label>
        <Textarea value={desc} onChange={e=>setDesc(e.target.value)} placeholder="Brief description..." className="bg-white/5 border-white/10 resize-none" rows={2} />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="grid gap-2">
          <Label className="text-muted-foreground uppercase tracking-widest text-[10px]">Price (€)</Label>
          <Input value={price} onChange={e=>setPrice(e.target.value)} type="number" className="h-12 bg-white/5 border-white/10" />
        </div>
        <div className="grid gap-2">
          <Label className="text-muted-foreground uppercase tracking-widest text-[10px]">Category</Label>
          <Select value={category} onValueChange={setCategory}>
            <SelectTrigger className="h-12 bg-white/5 border-white/10"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="classic">Classic</SelectItem>
              <SelectItem value="tropical">Tropical</SelectItem>
              <SelectItem value="signature">Signature</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      
      <div className="grid gap-2">
        <Label className="text-muted-foreground uppercase tracking-widest text-[10px]">Visibility</Label>
        <Select value={isVisible ? "1" : "0"} onValueChange={v => setIsVisible(v === "1")}>
          <SelectTrigger className="h-12 bg-white/5 border-white/10"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="1">Visible to Customers</SelectItem>
            <SelectItem value="0">Hidden</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="grid gap-3">
        <div className="flex justify-between items-center">
          <Label className="text-muted-foreground uppercase tracking-widest text-[10px]">Ingredients (ml)</Label>
          <Button variant="outline" size="sm" onClick={addIngredientRow} className="h-8 rounded-full border-white/20 text-xs">Add Ingredient</Button>
        </div>
        {ingredients.map((ing, idx) => (
          <div key={idx} className="flex items-center gap-2">
            <Select value={ing.ingredient_id.toString()} onValueChange={v => updateIngredientId(idx, parseInt(v))}>
              <SelectTrigger className="h-10 bg-white/5 border-white/10 flex-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                {availableIngredients.map(ai => (
                  <SelectItem key={ai.id} value={ai.id.toString()}>{ai.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input type="number" value={ing.amount_ml} onChange={e => updateIngredientAmount(idx, parseInt(e.target.value))} className="h-10 w-24 bg-white/5 border-white/10" />
            <Button variant="ghost" size="icon" onClick={() => removeIngredientRow(idx)} className="h-10 w-10 text-red-400 hover:text-red-300 hover:bg-red-400/20">
              <Trash2 className="w-4 h-4" />
            </Button>
          </div>
        ))}
      </div>
    </div>
  );

  return (
    <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-8 md:mb-10 gap-4">
        <div>
          <h2 className="text-3xl md:text-4xl font-serif font-light mb-1 md:mb-2">Recipe Management</h2>
          <p className="text-sm md:text-base text-muted-foreground">Add, edit, or remove drink recipes</p>
        </div>
        
        <Dialog open={isAddOpen} onOpenChange={setIsAddOpen}>
          <DialogTrigger asChild>
            <Button size="lg" className="w-full md:w-auto rounded-full gap-2 px-6 h-12 md:h-14 text-base md:text-lg bg-primary text-primary-foreground hover:bg-primary/90" onClick={openAdd}>
              <Plus className="w-5 h-5" />
              Add Recipe
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-[600px] bg-card/95 backdrop-blur-xl border-border text-card-foreground">
            <DialogHeader><DialogTitle className="text-2xl font-serif font-light">New Drink Recipe</DialogTitle></DialogHeader>
            {renderForm()}
            <div className="flex justify-end gap-3 pt-4">
              <Button variant="outline" onClick={() => setIsAddOpen(false)} className="rounded-full">Cancel</Button>
              <Button onClick={() => handleSave(true)} className="rounded-full bg-primary text-primary-foreground">Save Recipe</Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>
      
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 md:gap-6">
        {recipes.map((drink) => (
          <div key={drink.id} className={`surface-card rounded-2xl p-5 md:p-6 flex flex-col justify-between hover:ring-1 hover:ring-accent/60 transition border border-white/10 ${drink.is_visible ? 'bg-card/40' : 'bg-card/10 opacity-70'}`}>
            <div>
              <div className="flex justify-between items-start mb-2">
                <h3 className="text-xl md:text-2xl font-display font-light">{drink.name}</h3>
                <span className="text-accent font-medium">€{drink.price}</span>
              </div>
              <p className="text-xs md:text-sm text-muted-foreground mb-4">{drink.description}</p>
              <div className="flex flex-wrap gap-1 mb-4">
                {drink.ingredients.map((ing: any) => (
                  <span key={ing.id} className="text-[10px] uppercase tracking-widest px-2 py-1 bg-white/5 rounded-md text-muted-foreground">
                    {ing.name} {ing.amount_ml}ml
                  </span>
                ))}
              </div>
            </div>
            <div className="flex gap-2 mt-4 md:mt-6 pt-4 border-t border-white/10">
              <Button variant="ghost" onClick={() => openEdit(drink)} className="flex-1 rounded-full bg-white/5 hover:bg-white/10">
                <Edit2 className="w-4 h-4 mr-2" /> Edit
              </Button>
              <Button variant="ghost" onClick={() => handleDelete(drink.id)} className="rounded-full bg-red-500/10 text-red-400 hover:bg-red-500/20 hover:text-red-300">
                <Trash2 className="w-4 h-4" />
              </Button>
            </div>
          </div>
        ))}
      </div>

      <Dialog open={isEditOpen} onOpenChange={setIsEditOpen}>
        <DialogContent className="sm:max-w-[600px] bg-card/95 backdrop-blur-xl border-border text-card-foreground">
          <DialogHeader><DialogTitle className="text-2xl font-serif font-light">Edit Recipe</DialogTitle></DialogHeader>
          {renderForm()}
          <div className="flex justify-end gap-3 pt-4">
            <Button variant="outline" onClick={() => setIsEditOpen(false)} className="rounded-full">Cancel</Button>
            <Button onClick={() => handleSave(false)} className="rounded-full bg-primary text-primary-foreground">Save Changes</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
