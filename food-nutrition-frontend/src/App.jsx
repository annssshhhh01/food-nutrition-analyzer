// frontend/src/App.jsx

import React, { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Upload,
  Image as ImageIcon,
  Loader2,
  Trash2,
  History,
  Sparkles,
  ShieldCheck,
  CloudOff,
} from "lucide-react";
import {
  PieChart,
  Pie,
  Tooltip,
  ResponsiveContainer,
  Cell,
  Legend,
} from "recharts";

// =====================
// Utility Helpers & Constants
// =====================

const fileToDataURL = (file) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });

const prettyKcal = (n) => `${Math.round(n)} kcal`;

// This function now scales ALL nutrients, including the new micronutrients.
const scaleNutrition = (nutritionPer100g, grams) => {
  if (!nutritionPer100g) return null;
  const factor = grams / 100;
  const scaled = {};
  for (const key in nutritionPer100g) {
    scaled[key] = (nutritionPer100g[key] ?? 0) * factor;
  }
  return scaled;
};

// Main nutrients for the primary display
const MACRO_KEYS = [
  { key: "protein", label: "Protein (g)" },
  { key: "carbs", label: "Carbs (g)" },
  { key: "fat", label: "Fat (g)" },
  { key: "fiber", label: "Fiber (g)" },
  { key: "sugar", label: "Sugar (g)" },
];

// Detailed nutrients for the expandable section
const MICRO_KEYS = [
  { key: "cholesterol", label: "Cholesterol (mg)" },
  { key: "calcium", label: "Calcium (mg)" },
  { key: "iron", label: "Iron (mg)" },
  { key: "potassium", label: "Potassium (mg)" },
  { key: "magnesium", label: "Magnesium (mg)" },
  { key: "zinc", label: "Zinc (mg)" },
  { key: "phosphorus", label: "Phosphorus (mg)" },
  { key: "vitaminA", label: "Vitamin A (µg)" },
  { key: "vitaminC", label: "Vitamin C (mg)" },
  { key: "vitaminB6", label: "Vitamin B6 (mg)" },
  { key: "vitaminB12", label: "Vitamin B12 (µg)" },
  { key: "vitaminD", label: "Vitamin D (µg)" },
  { key: "vitaminE", label: "Vitamin E (mg)" },
  { key: "vitaminK", label: "Vitamin K (µg)" },
];

const randomId = () => Math.random().toString(36).slice(2, 9);

// =====================
// API Functions
// =====================

const liveAnalyze = async (file) => {
  const API_BASE = import.meta.env.VITE_API_BASE_URL || "";
  const form = new FormData();
  form.append("image", file);

  const res = await fetch(`${API_BASE}/api/analyze`, {
    method: "POST",
    body: form,
  });
  if (!res.ok) throw new Error("API error while analyzing image");
  return res.json();
};

const mockAnalyze = async () => {
  // Mock data for testing without a backend
  const main = {
    label: "Paneer Butter Masala",
    baseNutritionPer100g: { calories: 230, protein: 9.5, carbs: 8.2, fat: 17.6, fiber: 1.2, sugar: 3.1, sodium: 420 },
    allergens: ["Dairy", "Nuts (possible)"],
  };
  await new Promise((r) => setTimeout(r, 1000));
  return {
    predictions: [{ id: randomId(), label: main.label, confidence: 0.85 }],
    nutritionPer100g: main.baseNutritionPer100g,
    allergens: main.allergens,
  };
};

// =====================
// Main App Component
// =====================
export default function FoodNutritionApp() {
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [isDragging, setIsDragging] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [useMock, setUseMock] = useState(true);
  const [showDetails, setShowDetails] = useState(false);
  const [portion, setPortion] = useState(250);

  const [predictions, setPredictions] = useState([]);
  const [nutritionPer100g, setNutritionPer100g] = useState(null);
  const [allergens, setAllergens] = useState([]);

  const scaled = useMemo(
    () => scaleNutrition(nutritionPer100g, portion),
    [nutritionPer100g, portion]
  );
  const inputRef = useRef(null);

  const [history, setHistory] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem("food-ai-history") || "[]");
    } catch {
      return [];
    }
  });

  useEffect(() => {
    localStorage.setItem("food-ai-history", JSON.stringify(history.slice(0, 12)));
  }, [history]);

  const onFiles = useCallback(async (files) => {
    const f = files?.[0];
    if (!f || !f.type.startsWith("image/")) {
      setError("Please select a valid image file.");
      return;
    }
    setError("");
    setFile(f);
    setPreview(await fileToDataURL(f));
  }, []);

  useEffect(() => {
    const handlePaste = async (e) => {
      const imageFile = Array.from(e.clipboardData.items)
        .find(item => item.type.startsWith('image/'))
        ?.getAsFile();
      if (imageFile) await onFiles([imageFile]);
    };
    window.addEventListener('paste', handlePaste);
    return () => window.removeEventListener('paste', handlePaste);
  }, [onFiles]);

  const onDrop = useCallback(async (e) => {
    e.preventDefault();
    setIsDragging(false);
    await onFiles(e.dataTransfer.files);
  }, [onFiles]);

  const analyze = async () => {
    if (!file) return;
    setLoading(true);
    setError("");
    // Reset previous results
    setPredictions([]);
    setNutritionPer100g(null);
    setAllergens([]);
    setShowDetails(false);

    try {
      const result = useMock ? await mockAnalyze() : await liveAnalyze(file);
      setPredictions(result.predictions || []);
      setNutritionPer100g(result.nutritionPer100g || null);
      setAllergens(result.allergens || []);

      if (result.predictions?.length > 0) {
        const top = result.predictions[0];
        setHistory((h) => [
          {
            id: randomId(),
            label: top.label,
            portion,
            calories: scaleNutrition(result.nutritionPer100g, portion)?.calories || 0,
          },
          ...h,
        ]);
      }
    } catch (err) {
      console.error(err);
      setError(err.message || "Failed to analyze image");
    } finally {
      setLoading(false);
    }
  };

  const macroPieData = useMemo(() => {
    if (!scaled) return [];
    return [
      { name: "Protein", value: scaled.protein || 0 },
      { name: "Carbs", value: scaled.carbs || 0 },
      { name: "Fat", value: scaled.fat || 0 },
    ];
  }, [scaled]);

  return (
    <div className="min-h-screen bg-slate-800 text-slate-100">
      <div className="max-w-6xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl md:text-4xl font-bold tracking-tight flex items-center gap-3">
              <Sparkles className="w-8 h-8 text-emerald-400" />
              AI Food Nutrition Analyzer
            </h1>
            <p className="text-slate-400 mt-1">
              Snap a photo, detect the dish, and get its full nutritional breakdown.
            </p>
          </div>
          <button
            onClick={() => setUseMock((v) => !v)}
            className={`inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm transition border ${
              useMock
                ? "bg-slate-700 border-slate-600 hover:bg-slate-600"
                : "bg-emerald-500/10 border-emerald-400/30 hover:bg-emerald-500/20"
            }`}
            title={useMock ? "Using mock data (no backend needed)" : "Using live API (/api/analyze)"}
          >
            {useMock ? <CloudOff className="w-4 h-4" /> : <ShieldCheck className="w-4 h-4" />}
            {useMock ? "Mock Mode" : "Live API"}
          </button>
        </div>

        {/* Upload + Controls */}
        <div className="mt-8 grid lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2">
            <div
              onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={onDrop}
              className={`relative border-2 border-dashed rounded-3xl p-6 md:p-10 transition ${
                isDragging ? "border-emerald-400 bg-emerald-500/5" : "border-slate-700 bg-slate-900/40"
              }`}
            >
              <div className="flex flex-col md:flex-row items-center justify-between gap-6">
                <div className="flex items-center gap-4">
                  <div className="p-3 rounded-2xl bg-slate-800 border border-slate-700">
                    <ImageIcon className="w-7 h-7 text-slate-300" />
                  </div>
                  <div>
                    <h3 className="text-lg font-semibold">Upload a food photo</h3>
                    <p className="text-sm text-slate-400">Drag & drop, choose a file, or paste an image.</p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <input ref={inputRef} type="file" accept="image/*" className="hidden" onChange={(e) => onFiles(e.target.files)} />
                  <button onClick={() => inputRef.current?.click()} className="inline-flex items-center gap-2 rounded-xl px-4 py-2 bg-slate-100 text-slate-900 hover:bg-white transition">
                    <Upload className="w-4 h-4" /> Choose Image
                  </button>
                </div>
              </div>
              <AnimatePresence>
                {preview && (
                  <motion.div initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.98 }} className="mt-6 overflow-hidden rounded-2xl border border-slate-700/70 bg-slate-900/60">
                    <img src={preview} alt="preview" className="w-full max-h-[420px] object-contain bg-black/20" />
                  </motion.div>
                )}
              </AnimatePresence>
              <div className="mt-6 grid md:grid-cols-3 gap-4">
                <div className="md:col-span-2">
                  <label className="text-sm text-slate-300">Portion size (grams)</label>
                  <div className="flex items-center gap-4 mt-2">
                    <input type="range" min={50} max={600} step={10} value={portion} onChange={(e) => setPortion(parseInt(e.target.value))} className="w-full accent-emerald-400" />
                    <div className="w-20 text-right text-slate-200 font-medium">{portion} g</div>
                  </div>
                  <p className="text-xs text-slate-500 mt-1">Nutrition values are scaled from a 100g base.</p>
                </div>
                <div className="flex md:justify-end items-end">
                  <button disabled={!file || loading} onClick={analyze} className="w-full md:w-auto inline-flex items-center justify-center gap-2 rounded-xl px-5 py-2.5 bg-emerald-500 text-slate-950 font-semibold hover:bg-emerald-400 disabled:opacity-50 disabled:cursor-not-allowed">
                    {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                    {loading ? "Analyzing..." : "Analyze Image"}
                  </button>
                </div>
              </div>
              {error && <div className="mt-4 text-sm text-red-300">{error}</div>}
            </div>
          </div>
          <div className="space-y-6">
            <div className="rounded-3xl border border-slate-700 bg-slate-900/40 p-5">
              <h3 className="text-lg font-semibold mb-3">Predictions</h3>
              {!predictions.length && !loading ? (
                <p className="text-sm text-slate-400">Run an analysis to see dish predictions.</p>
              ) : (
                <ul className="space-y-3">
                  {predictions.map((p, idx) => (
                    <li key={p.id}>
                      <div className="flex items-center justify-between text-sm">
                        <span className="font-medium">
                          {idx === 0 && <span className="inline-block mr-2 px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 text-[11px]">Top</span>}
                          {p.label}
                        </span>
                        <span className="text-slate-400">{Math.round(p.confidence * 100)}%</span>
                      </div>
                      <div className="h-2 bg-slate-800 rounded mt-2 overflow-hidden">
                        <div className="h-2 bg-emerald-500" style={{ width: `${Math.max(6, p.confidence * 100)}%` }} />
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="rounded-3xl border border-slate-700 bg-slate-900/40 p-5">
              <h3 className="text-lg font-semibold mb-2">History</h3>
              {history.length === 0 ? (
                <p className="text-sm text-slate-400">Your past analyses will appear here.</p>
              ) : (
                <ul className="space-y-2 max-h-64 overflow-y-auto pr-1">
                  {history.map((h) => (
                    <li key={h.id} className="flex items-center justify-between text-sm">
                      <span className="text-slate-300">{h.label}</span>
                      <span className="text-slate-500">{h.portion} g • {prettyKcal(h.calories)}</span>
                    </li>
                  ))}
                </ul>
              )}
              {history.length > 0 && <button onClick={() => setHistory([])} className="mt-3 text-xs text-slate-400 hover:text-red-300 inline-flex items-center gap-1"><Trash2 className="w-3 h-3" /> Clear History</button>}
            </div>
          </div>
        </div>

        {/* Nutrition + Allergens */}
        <div className="mt-8 grid lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 rounded-3xl border border-slate-700 bg-slate-900/40 p-6">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <h3 className="text-xl font-semibold">Nutrition (for {portion} g)</h3>
                <p className="text-sm text-slate-400">Values are estimates. Always verify for dietary restrictions.</p>
              </div>
              {scaled && (
                <div className="text-right">
                  <div className="text-2xl font-bold">{prettyKcal(scaled.calories)}</div>
                  <div className="text-xs text-slate-400">Estimated calories</div>
                </div>
              )}
            </div>

            {/* Conditional Rendering for Nutrition Section */}
            {loading ? (
              <div className="text-sm text-slate-400 mt-4">Loading nutrition data...</div>
            ) : predictions.length > 0 && !scaled ? (
              <div className="text-sm text-slate-400 mt-4">
                Nutrition data is not yet available for <span className="font-semibold text-slate-300">{predictions[0].label}</span>.
              </div>
            ) : !scaled ? (
              <div className="text-sm text-slate-400 mt-4">Run an analysis to see a nutrition breakdown.</div>
            ) : (
              <div className="mt-6">
                <div className="grid md:grid-cols-3 gap-6">
                  <div className="md:col-span-2">
                    <div className="grid sm:grid-cols-2 gap-4">
                      {MACRO_KEYS.map(({ key, label }) => (
                        <div key={key} className="rounded-2xl border border-slate-700 bg-slate-950/40 p-4">
                          <div className="text-slate-400 text-xs">{label}</div>
                          <div className="text-xl font-semibold">{(scaled?.[key] ?? 0).toFixed(1)}</div>
                        </div>
                      ))}
                      <div className="rounded-2xl border border-slate-700 bg-slate-950/40 p-4">
                        <div className="text-slate-400 text-xs">Sodium (mg)</div>
                        <div className="text-xl font-semibold">{(scaled?.sodium ?? 0).toFixed(0)}</div>
                      </div>
                    </div>
                  </div>
                  <div className="h-56">
                    <ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={macroPieData} dataKey="value" nameKey="name" outerRadius={50} label><Cell fill="#10b981" /><Cell fill="#3b82f6" /><Cell fill="#ef4444" /></Pie><Tooltip />
                    <Legend 
                      layout="horizontal" // Arrange items side-by-side
                      verticalAlign="bottom" // Position the legend at the bottom
                      align="center" // Center the legend horizontally
                      wrapperStyle={{ paddingTop: '20px' }} // Add space between pie and legend
                      iconSize={10}
                    />
        </PieChart></ResponsiveContainer>
                  </div>
                </div>
                <div className="mt-6">
                  <button onClick={() => setShowDetails(!showDetails)} className="text-sm text-emerald-400 hover:text-emerald-300">
                    {showDetails ? 'Hide Detailed Breakdown' : 'Show Detailed Breakdown'}
                  </button>
                </div>
                <AnimatePresence>
                  {showDetails && (
                    <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="mt-4 overflow-hidden">
                      <h4 className="font-semibold mb-3">Vitamins & Minerals</h4>
                      <div className="grid sm:grid-cols-2 md:grid-cols-3 gap-4">
                        {MICRO_KEYS.map(({ key, label }) => (
                           scaled[key] > 0 && <div key={key} className="rounded-2xl border border-slate-800 bg-slate-950/20 p-3">
                            <div className="text-slate-400 text-xs">{label}</div>
                            <div className="text-lg font-medium">{(scaled?.[key] ?? 0).toFixed(1)}</div>
                          </div>
                        ))}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            )}
          </div>
          <div className="rounded-3xl border border-slate-700 bg-slate-900/40 p-6">
            <h3 className="text-xl font-semibold mb-3">Possible Allergens</h3>
            {!allergens?.length ? (
              <p className="text-sm text-slate-400">Allergen info will appear after analysis.</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {allergens.map((a, i) => (<span key={`${a}-${i}`} className="px-3 py-1 rounded-full text-sm border border-amber-400/30 text-amber-200 bg-amber-500/10">{a}</span>))}
              </div>
            )}
            <p className="text-xs text-slate-500 mt-4">Disclaimer: This is an AI-generated estimate and not medical advice. Always confirm with certified sources if required.</p>
          </div>
        </div>
        <div className="mt-10 text-center text-xs text-slate-500">Built with React • Tailwind • Framer Motion • Recharts • Lucide Icons</div>
      </div>
    </div>
  );
}