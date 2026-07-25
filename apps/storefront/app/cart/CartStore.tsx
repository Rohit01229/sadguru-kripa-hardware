"use client";

// Client/session-transient cart (03 §6 — the storefront cart is NOT persisted
// server-side; it lives in the browser). A localStorage-backed React context holds
// line items {productId, saleUnitId, quantity, + display fields}. The authoritative
// price + reservation happen server-side at placeOrder; the cart is just the
// shopper's working set until checkout.
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

export interface CartLine {
  productId: string;
  saleUnitId: string;
  quantity: string;
  // Display-only snapshots (re-priced server-side at checkout).
  name: string;
  unitLabel: string;
  unitPricePaise: number;
}

interface CartContextValue {
  lines: CartLine[];
  addLine: (line: CartLine) => void;
  updateQty: (productId: string, saleUnitId: string, quantity: string) => void;
  removeLine: (productId: string, saleUnitId: string) => void;
  clear: () => void;
  /** Sum of all line quantities (may be fractional for measured units). Internal use. */
  count: number;
  /** Number of distinct cart lines — what the header badge shows (ecommerce convention). */
  lineCount: number;
}

const CartContext = createContext<CartContextValue | null>(null);
const STORAGE_KEY = "hw.cart.v1";

export function CartProvider({ children }: { children: ReactNode }) {
  const [lines, setLines] = useState<CartLine[]>([]);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) setLines(JSON.parse(raw) as CartLine[]);
    } catch {
      /* ignore corrupt cart */
    }
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (hydrated) localStorage.setItem(STORAGE_KEY, JSON.stringify(lines));
  }, [lines, hydrated]);

  const addLine = (line: CartLine) =>
    setLines((prev) => {
      const i = prev.findIndex((l) => l.productId === line.productId && l.saleUnitId === line.saleUnitId);
      if (i >= 0) {
        const next = [...prev];
        const merged = Number(next[i]!.quantity) + Number(line.quantity);
        next[i] = { ...next[i]!, quantity: String(merged) };
        return next;
      }
      return [...prev, line];
    });

  const updateQty = (productId: string, saleUnitId: string, quantity: string) =>
    setLines((prev) =>
      prev.map((l) => (l.productId === productId && l.saleUnitId === saleUnitId ? { ...l, quantity } : l)),
    );

  const removeLine = (productId: string, saleUnitId: string) =>
    setLines((prev) => prev.filter((l) => !(l.productId === productId && l.saleUnitId === saleUnitId)));

  const clear = () => setLines([]);
  const count = lines.reduce((a, l) => a + Number(l.quantity || 0), 0);
  const lineCount = lines.length;

  return (
    <CartContext.Provider value={{ lines, addLine, updateQty, removeLine, clear, count, lineCount }}>
      {children}
    </CartContext.Provider>
  );
}

export function useCart(): CartContextValue {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error("useCart must be used within a CartProvider");
  return ctx;
}
