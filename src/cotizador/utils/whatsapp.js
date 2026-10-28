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

// Países para el selector del teléfono del cliente. `largo` es la cantidad de
// dígitos del número nacional (sin el código), para validar y para reconocer
// un número que ya trae el código. Cualquier otro país se escribe con "+".
export const PAISES_WHATSAPP = [
  { codigo: "53", nombre: "Cuba", largo: [8, 8] },
  { codigo: "1", nombre: "Rep. Dominicana / EE. UU. / Canadá / Puerto Rico", largo: [10, 10] },
  { codigo: "34", nombre: "España", largo: [9, 9] },
  { codigo: "52", nombre: "México", largo: [10, 10] },
  { codigo: "57", nombre: "Colombia", largo: [10, 10] },
  { codigo: "58", nombre: "Venezuela", largo: [10, 10] },
  { codigo: "509", nombre: "Haití", largo: [8, 8] },
  { codigo: "507", nombre: "Panamá", largo: [7, 8] },
  { codigo: "506", nombre: "Costa Rica", largo: [8, 8] },
  { codigo: "502", nombre: "Guatemala", largo: [8, 8] },
  { codigo: "503", nombre: "El Salvador", largo: [8, 8] },
  { codigo: "504", nombre: "Honduras", largo: [8, 8] },
  { codigo: "505", nombre: "Nicaragua", largo: [8, 8] },
  { codigo: "51", nombre: "Perú", largo: [9, 9] },
  { codigo: "593", nombre: "Ecuador", largo: [9, 9] },
  { codigo: "591", nombre: "Bolivia", largo: [8, 8] },
  { codigo: "56", nombre: "Chile", largo: [9, 9] },
  { codigo: "54", nombre: "Argentina", largo: [10, 11] },
  { codigo: "598", nombre: "Uruguay", largo: [8, 9] },
  { codigo: "595", nombre: "Paraguay", largo: [9, 9] },
  { codigo: "55", nombre: "Brasil", largo: [10, 11] },
  { codigo: "44", nombre: "Reino Unido", largo: [10, 10] },
  { codigo: "33", nombre: "Francia", largo: [9, 9] },
  { codigo: "39", nombre: "Italia", largo: [9, 11], conCero: true },
  { codigo: "49", nombre: "Alemania", largo: [10, 11] },
  { codigo: "351", nombre: "Portugal", largo: [9, 9] },
  { codigo: "31", nombre: "Países Bajos", largo: [9, 9] },
  { codigo: "41", nombre: "Suiza", largo: [9, 9] },
  { codigo: "7", nombre: "Rusia", largo: [10, 10] },
  { codigo: "86", nombre: "China", largo: [11, 11] },
  { codigo: "91", nombre: "India", largo: [10, 10] },
];

// Código por defecto: el de República Dominicana, como siempre.
export const CODIGO_PAIS_DEFECTO = "1";

// Devuelve { numero, error }: `numero` es el teléfono completo en formato
// internacional, solo dígitos (lo que pide wa.me).
// - Si se escribe con "+" o "00" delante, se usa tal cual (cualquier país).
// - Si no, se le pone el código del país elegido, salvo que ya lo traiga.
export function telefonoParaWhatsApp(telefono, codigoPais = CODIGO_PAIS_DEFECTO) {
  const texto = String(telefono || "").trim();
  let digits = texto.replace(/\D/g, "");
  if (!digits) return { numero: "", error: "vacio" };

  if (texto.startsWith("+") || digits.startsWith("00")) {
    if (digits.startsWith("00")) digits = digits.slice(2);
    if (digits.length < 8 || digits.length > 15) return { numero: "", error: "invalido" };
    return { numero: digits, error: "" };
  }

  const codigo = String(codigoPais || CODIGO_PAIS_DEFECTO).replace(/\D/g, "");
  const pais = PAISES_WHATSAPP.find((p) => p.codigo === codigo);
  const [min, max] = pais ? pais.largo : [6, 14];
  const cabe = (n) => n >= min && n <= max;

  // Ya trae el código del país (ej. 5352345678 con Cuba).
  if (digits.startsWith(codigo) && cabe(digits.length - codigo.length) && !cabe(digits.length)) {
    return { numero: digits, error: "" };
  }
  // Prefijo nacional "0" (ej. 0612345678 en Francia), que no se marca desde fuera.
  if (digits.startsWith("0") && !(pais && pais.conCero)) digits = digits.slice(1);
  if (!cabe(digits.length)) {
    return { numero: "", error: "largo", pais, largo: [min, max] };
  }
  return { numero: codigo + digits, error: "" };
}

// Teléfono como se muestra en la cotización: con el código del país.
export function telefonoVisible(telefono, codigoPais) {
  const texto = String(telefono || "").trim();
  if (!texto) return "";
  if (texto.startsWith("+")) return texto;
  const { numero } = telefonoParaWhatsApp(texto, codigoPais);
  const codigo = String(codigoPais || CODIGO_PAIS_DEFECTO);
  if (!numero) return texto;
  // Si ya lo escribieron con el código, solo se le pone el "+".
  return numero === texto.replace(/\D/g, "") ? `+${texto}` : `+${codigo} ${texto}`;
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
  const { numero: telefono, error, pais, largo } = telefonoParaWhatsApp(cliente.telefono, cliente.codigoPais);
  if (!telefono) {
    if (error === "largo" && pais) {
      const digitos = largo[0] === largo[1] ? `${largo[0]}` : `${largo[0]} o ${largo[1]}`;
      setWaError(`El número para ${pais.nombre} (+${pais.codigo}) debe tener ${digitos} dígitos, sin el código del país. Revisa el teléfono del cliente o elige otro país.`);
    } else {
      setWaError("El número de teléfono del cliente no es válido. Si es de otro país, escríbelo con + y el código (ej. +53 5234 5678).");
    }
    return;
  }

  // Sin ningún "await" antes de window.open: se ejecuta en el mismo clic del
  // usuario, así el navegador nunca lo trata como pop-up y no lo bloquea.
  const mensaje = construirMensajeWhatsApp({ cliente, numeroCotizacion, fecha, total });
  const url = `https://wa.me/${telefono}?text=${encodeURIComponent(mensaje)}`;
  window.open(url, "_blank");

  setWaNote(`WhatsApp está listo con el mensaje preparado para +${telefono}. Adjunta el PDF descargado y pulsa Enviar. Si WhatsApp dice que el número no es válido, ese número no tiene WhatsApp.`);
}
