// Lógica de envío por WhatsApp.
// Movida de Cotizador.jsx (Fase 1 — Sub-paso 2).
//
// A diferencia de las funciones del Sub-paso 1, construirMensajeWhatsApp y
// abrirWhatsApp usaban directamente el estado del componente (cliente,
// numeroCotizacion, fecha, quote.total, setWaError, setWaNote). Un módulo
// .js normal no puede leer el estado de React, así que aquí quedaron como
// funciones puras que reciben esos mismos valores como parámetros. El
// comportamiento — validaciones, mensajes, orden, y el hecho de abrir
// window.open sin ningún "await" antes (para que el navegador no lo bloquee
// como pop-up) — es exactamente el mismo que antes.

import { fmtFechaLegible, addDaysISO } from "./formato.js";

export function telefonoParaWhatsApp(telefono) {
  const digits = String(telefono || "").replace(/\D/g, "");
  if (!digits) return "";
  if (digits.length === 10) return `1${digits}`;
  return digits;
}

export function construirMensajeWhatsApp({ cliente, numeroCotizacion, fecha, total }) {
  const totalTexto = Number(total || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `Hola, ${cliente.nombre} 👋

Reciba un cordial saludo de parte de Grupo D'Brians SRL.

Adjunto encontrará la cotización No. ${numeroCotizacion}, preparada de acuerdo con su solicitud.

📋 Cotización: ${numeroCotizacion}
📅 Fecha: ${fmtFechaLegible(fecha)}
⏳ Vigencia: ${fmtFechaLegible(addDaysISO(cliente.vigenciaDias))}

💰 Total de la cotización: USD ${totalTexto}

La propuesta contiene el detalle de los productos/servicios solicitados, cantidades, precios y condiciones comerciales correspondientes.

Quedamos atentos a cualquier consulta, modificación o confirmación de su pedido.

Será un placer atenderle.

Saludos cordiales,
Grupo D'Brians SRL
📞 +1 829-664-2424
📧 info@grupodbrians.com
🌐 www.grupodbrians.com`;
}

export function abrirWhatsApp({ cliente, numeroCotizacion, fecha, total, setWaError, setWaNote }) {
  setWaError("");
  setWaNote("");

  if (!cliente.nombre.trim()) {
    setWaError("Debes registrar el nombre del cliente antes de enviar la cotización.");
    return;
  }
  if (!cliente.telefono.trim()) {
    setWaError("Para enviar la cotización por WhatsApp debes registrar el número de teléfono del cliente.");
    return;
  }
  if (!numeroCotizacion || !Number.isFinite(total) || total <= 0) {
    setWaError("La cotización todavía no está calculada. Vuelve a \"Datos\" y genera la cotización primero.");
    return;
  }
  const telefono = telefonoParaWhatsApp(cliente.telefono);
  if (!telefono) {
    setWaError("El número de teléfono del cliente no es válido.");
    return;
  }

  // Sin ningún "await" antes de window.open: se ejecuta en el mismo clic del
  // usuario, así el navegador nunca lo trata como pop-up y no lo bloquea.
  const mensaje = construirMensajeWhatsApp({ cliente, numeroCotizacion, fecha, total });
  const url = `https://wa.me/${telefono}?text=${encodeURIComponent(mensaje)}`;
  window.open(url, "_blank");

  setWaNote("WhatsApp está listo con el mensaje preparado. Adjunta el PDF descargado y pulsa Enviar.");
}
