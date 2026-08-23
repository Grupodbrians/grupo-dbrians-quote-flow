// Funciones puras de formato y fecha, usadas en todo el cotizador.
// Movidas de Cotizador.jsx tal cual (Fase 1 — sin cambio de comportamiento).

export function uid() {
  return Math.random().toString(36).slice(2, 10);
}

export function fmtUSD(n) {
  const v = Number.isFinite(n) ? n : 0;
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(v);
}

export function fmtMoneda(n, code) {
  const v = Number.isFinite(n) ? n : 0;
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: code || "USD" }).format(v);
  } catch (e) {
    return `${code || ""} ${v.toFixed(2)}`;
  }
}

export function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

export function addDaysISO(days) {
  const d = new Date();
  d.setDate(d.getDate() + Number(days || 0));
  return d.toISOString().slice(0, 10);
}

export function fmtFechaLegible(iso) {
  try {
    const [y, m, d] = String(iso).split("-").map(Number);
    return `${String(d).padStart(2, "0")}/${String(m).padStart(2, "0")}/${y}`;
  } catch (e) {
    return iso;
  }
}
