// Motor de cálculo del cotizador y valores por defecto.
// Movidos de Cotizador.jsx tal cual (Fase 1 — sin cambio de comportamiento).
//
// IMPORTANTE (decisión definitiva del margen): margenUSD es UN ÚNICO monto
// general en USD para toda la cotización, que se suma igual a cada renglón
// (margenCadaProducto). NO existe margen individual por producto — no se
// introdujo aquí ni en ningún otro punto de esta refactorización.

import { uid } from "./formato.js";

export function emptyItem() {
  return { id: uid(), descripcion: "", cantidad: 1, precioUnitario: 0, moneda: "DOP" };
}

export function defaultCliente() {
  return {
    nombre: "",
    telefono: "",
    direccion: "",
    metodoPago: "Transferencia bancaria",
    metodoPagoOtro: "",
    condiciones: "Precios cotizados sujetos a disponibilidad del proveedor. No incluye costos no especificados en este documento.",
    vigenciaDias: 15,
  };
}

export function computeQuote({ items, tasas, logistica, margenUSD, impuestos }) {
  const itemsCalc = items.map((it) => {
    const tasa = it.moneda === "USD" ? 1 : Number(tasas[it.moneda]) || 0;
    const precioUnitUSD = tasa > 0 ? Number(it.precioUnitario || 0) / tasa : 0;
    const totalProveedorUSD = precioUnitUSD * Number(it.cantidad || 0);
    return { ...it, tasa, precioUnitUSD, totalProveedorUSD };
  });

  const subtotalProveedor = itemsCalc.reduce((s, it) => s + it.totalProveedorUSD, 0);
  const margenCadaProducto = Number(margenUSD || 0);
  const margenTotal = margenCadaProducto * itemsCalc.length;

  const tasaDOP = Number(tasas.DOP) || 0;
  const logisticaTotal = tasaDOP > 0 ? Number(logistica.valorDOP || 0) / tasaDOP : 0;

  const subtotalCliente = subtotalProveedor + logisticaTotal + margenTotal;

  const itemsFinal = itemsCalc.map((it) => {
    const share = subtotalProveedor > 0 ? it.totalProveedorUSD / subtotalProveedor : 1 / Math.max(itemsCalc.length, 1);
    const logisticaItem = logisticaTotal * share;
    const margenItem = margenCadaProducto;
    const totalFinalItem = it.totalProveedorUSD + logisticaItem + margenItem;
    const precioUnitFinal = Number(it.cantidad || 0) > 0 ? totalFinalItem / Number(it.cantidad) : 0;
    return { ...it, logisticaItem, margenItem, totalFinalItem, precioUnitFinal };
  });

  const impuestosCalc = impuestos
    .filter((t) => t.activo)
    .map((t) => ({ ...t, monto: subtotalCliente * (Number(t.porcentaje || 0) / 100) }));
  const impuestosTotal = impuestosCalc.reduce((s, t) => s + t.monto, 0);

  const total = subtotalCliente + impuestosTotal;

  return {
    itemsFinal,
    subtotalProveedor,
    logisticaTotal,
    margenTotal,
    subtotalCliente,
    impuestosCalc,
    impuestosTotal,
    total,
  };
}
