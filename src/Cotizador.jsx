import React, { useState, useMemo, useEffect, useRef } from "react";
import {
  Plus, Trash2, Printer, Save, ArrowLeft, RefreshCw, Building2,
  Percent, DollarSign, History as HistoryIcon, Eye, Stamp,
  ChevronRight, AlertCircle, CheckCircle2, Upload, Loader2, FileText, SkipForward, Download, MessageCircle,
  Users, ShieldCheck, LogOut, UserPlus, Ban, UserCheck2, Trash, ClipboardList
} from "lucide-react";
import { LOGO_DATA_URI } from "./logo.js";
import { supabase, registrarAuditoria } from "./supabaseClient.js";

const CURRENCY_PRESETS = ["DOP", "USD", "EUR", "MXN", "COP", "PAB"];
const PAYMENT_METHODS = [
  "Transferencia bancaria",
  "Cheque",
  "Efectivo",
  "Tarjeta de crédito",
  "Crédito 30 días",
  "Otro",
];

import { uid, fmtUSD, fmtMoneda, todayISO, addDaysISO, fmtFechaLegible } from "./cotizador/utils/formato.js";
import { emptyItem, defaultCliente, computeQuote } from "./cotizador/utils/calculos.js";
import {
  construirMensajeWhatsApp as construirMensajeWhatsAppUtil,
  abrirWhatsApp as abrirWhatsAppUtil,
} from "./cotizador/utils/whatsapp.js";
import { generarPDFCliente as generarPDFClienteUtil } from "./cotizador/utils/pdf.js";

function genNumeroCotizacion() {
  const d = new Date();
  const ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
  return `COT-${ymd}-${Math.floor(1000 + Math.random() * 9000)}`;
}

export default function Cotizador({ perfil }) {
  const [view, setView] = useState("upload");
  const [numeroCotizacion, setNumeroCotizacion] = useState("");
  const [obteniendoNumero, setObteniendoNumero] = useState(false);
  const [fecha, setFecha] = useState(todayISO());

  const [archivoNombre, setArchivoNombre] = useState("");
  const [extrayendo, setExtrayendo] = useState(false);
  const [extraccionError, setExtraccionError] = useState("");
  const [extraccionOk, setExtraccionOk] = useState(false);

  const [proveedor, setProveedor] = useState({ nombre: "", tipo: "Fabricante" });
  const [items, setItems] = useState([emptyItem()]);
  const [tasas, setTasas] = useState({ DOP: 60 });
  const [logistica, setLogistica] = useState({ valorDOP: 0 });
  const [margenUSD, setMargenUSD] = useState(0);
  const [impuestos, setImpuestos] = useState([{ id: uid(), nombre: "ITBIS", porcentaje: 18, activo: true }]);
  const [cliente, setCliente] = useState(defaultCliente());

  const [historial, setHistorial] = useState([]);
  const [historialCargando, setHistorialCargando] = useState(false);
  const [autoDescargarPendiente, setAutoDescargarPendiente] = useState(false);
  const [savedNote, setSavedNote] = useState("");
  const [errores, setErrores] = useState([]);
  const [pdfGenerado, setPdfGenerado] = useState(false);
  const [generandoPDF, setGenerandoPDF] = useState(false);
  const [pdfError, setPdfError] = useState("");
  const [waError, setWaError] = useState("");
  const [waNote, setWaNote] = useState("");
  const clienteDocRef = useRef(null);

  const esAdmin = perfil && perfil.rol === "admin";

  // Administración de usuarios (solo visible/operable para administradores)
  const [usuarios, setUsuarios] = useState([]);
  const [usuariosCargando, setUsuariosCargando] = useState(false);
  const [usuariosNota, setUsuariosNota] = useState("");
  const [usuariosError, setUsuariosError] = useState("");
  const [historialNota, setHistorialNota] = useState("");
  const [historialError, setHistorialError] = useState("");

  // Auditoría
  const [auditoria, setAuditoria] = useState([]);
  const [auditoriaCargando, setAuditoriaCargando] = useState(false);

  const monedasUsadas = useMemo(() => {
    const set = new Set(items.map((it) => it.moneda).filter((c) => c && c !== "USD"));
    return Array.from(set);
  }, [items]);

  const monedasParaTasas = useMemo(() => {
    const set = new Set(["DOP", ...monedasUsadas]);
    return Array.from(set);
  }, [monedasUsadas]);

  useEffect(() => {
    setTasas((prev) => {
      const next = { ...prev };
      let changed = false;
      monedasUsadas.forEach((c) => {
        if (!(c in next)) {
          next[c] = 1;
          changed = true;
        }
      });
      return changed ? next : prev;
    });
  }, [monedasUsadas]);

  const quote = useMemo(
    () => computeQuote({ items, tasas, logistica, margenUSD, impuestos }),
    [items, tasas, logistica, margenUSD, impuestos]
  );

  function updateItem(id, patch) {
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, ...patch } : it)));
  }
  function addItem() {
    setItems((prev) => [...prev, emptyItem()]);
  }
  function removeItem(id) {
    setItems((prev) => (prev.length > 1 ? prev.filter((it) => it.id !== id) : prev));
  }
  function addImpuesto() {
    setImpuestos((prev) => [...prev, { id: uid(), nombre: "Nuevo impuesto", porcentaje: 0, activo: true }]);
  }
  function updateImpuesto(id, patch) {
    setImpuestos((prev) => prev.map((t) => (t.id === id ? { ...t, ...patch } : t)));
  }
  function removeImpuesto(id) {
    setImpuestos((prev) => prev.filter((t) => t.id !== id));
  }

  async function extraerDocumento(file) {
    if (!file) return;
    setArchivoNombre(file.name);
    setExtrayendo(true);
    setExtraccionError("");
    setExtraccionOk(false);
    try {
      const base64 = await fileToBase64(file);
      const isPdf = (file.type || "").includes("pdf") || file.name.toLowerCase().endsWith(".pdf");
      const contentBlock = isPdf
        ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: base64 } }
        : { type: "image", source: { type: "base64", media_type: file.type || "image/jpeg", data: base64 } };

      const prompt = `Analiza esta cotización de un proveedor externo y extrae los datos en JSON estricto, sin texto adicional antes ni después, sin backticks de markdown. Usa exactamente este formato:
{"proveedor_nombre":"","proveedor_tipo":"Fabricante|Distribuidor|Mayorista|Agente / Broker|Otro","moneda":"COD","items":[{"descripcion":"","cantidad":0,"precioUnitario":0}]}
Reglas: "moneda" es el código ISO de 3 letras de la moneda usada en el documento (ej. DOP, USD, EUR, MXN). "precioUnitario" es el precio unitario en esa moneda original, solo número, sin símbolos ni separadores de miles. Si no encuentras el tipo de proveedor, usa "Fabricante". Si un dato no aparece en el documento, usa "" o 0.`;

      const response = await fetch("/api/extraer-cotizacion", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contentBlock, prompt }),
      });
      if (!response.ok) throw new Error("La función de extracción respondió con error");
      const parsed = await response.json();

      setProveedor({
        nombre: parsed.proveedor_nombre || "",
        tipo: parsed.proveedor_tipo || "Fabricante",
      });
      const moneda = String(parsed.moneda || "DOP").toUpperCase().slice(0, 3) || "DOP";
      const nuevosItems = Array.isArray(parsed.items) && parsed.items.length
        ? parsed.items.map((it) => ({
            id: uid(),
            descripcion: it.descripcion || "",
            cantidad: Number(it.cantidad) || 1,
            precioUnitario: Number(it.precioUnitario) || 0,
            moneda,
          }))
        : [emptyItem()];
      setItems(nuevosItems);
      if (moneda !== "USD") setTasas((prev) => ({ ...prev, [moneda]: prev[moneda] || 1 }));
      setExtraccionOk(true);
    } catch (e) {
      setExtraccionError("No se pudo extraer la información automáticamente de este documento. Verifica que sea legible o carga los datos manualmente.");
    }
    setExtrayendo(false);
  }

  function validar() {
    const errs = [];
    if (!proveedor.nombre.trim()) errs.push("Falta el nombre del proveedor.");
    if (items.some((it) => !it.descripcion.trim())) errs.push("Todos los renglones necesitan una descripción.");
    if (items.some((it) => Number(it.precioUnitario) <= 0)) errs.push("El precio unitario debe ser mayor a cero en cada renglón.");
    monedasUsadas.forEach((c) => {
      if (!tasas[c] || Number(tasas[c]) <= 0) errs.push(`Falta la tasa de cambio para ${c}.`);
    });
    if (!tasas.DOP || Number(tasas.DOP) <= 0) errs.push("Falta la tasa de cambio de RD$ (necesaria para convertir los gastos logísticos).");
    if (!cliente.nombre.trim()) errs.push("Falta el nombre del cliente.");
    setErrores(errs);
    return errs.length === 0;
  }

  async function generar() {
    if (!validar()) return;
    setPdfGenerado(false);
    setPdfError("");
    setWaError("");
    setWaNote("");

    if (!numeroCotizacion) {
      setObteniendoNumero(true);
      try {
        const { data, error } = await supabase.rpc("siguiente_numero_cotizacion");
        if (error || !data) throw error || new Error("sin respuesta");
        setNumeroCotizacion(data);
        setFecha(todayISO());
      } catch (e) {
        console.error("Error obteniendo número de cotización:", e);
        setObteniendoNumero(false);
        setErrores(["No se pudo generar el número consecutivo de la cotización. Verifica tu conexión e intenta de nuevo."]);
        return;
      }
      setObteniendoNumero(false);
    }
    setView("preview");
  }


  // Envoltorio de una línea: misma firma sin argumentos que antes, así el
  // botón (onClick={generarPDFCliente}) y la auto-descarga desde Historial no
  // necesitan ningún cambio. La lógica real vive ahora en
  // cotizador/utils/pdf.js (Sub-paso 3). clienteDocRef sigue viviendo aquí
  // porque pertenece al JSX (línea del <div ref={clienteDocRef}>).
  async function generarPDFCliente() {
    return generarPDFClienteUtil({
      nodo: clienteDocRef.current,
      numeroCotizacion,
      setPdfError,
      setPdfGenerado,
      setGenerandoPDF,
    });
  }

  // Envoltorios de una línea: misma firma sin argumentos que antes, así el
  // JSX (onClick={abrirWhatsApp}) no necesita ningún cambio. La lógica real
  // vive ahora en cotizador/utils/whatsapp.js (Sub-paso 2).
  function construirMensajeWhatsApp() {
    return construirMensajeWhatsAppUtil({ cliente, numeroCotizacion, fecha, total: quote.total });
  }

  function abrirWhatsApp() {
    abrirWhatsAppUtil({ cliente, numeroCotizacion, fecha, total: quote.total, setWaError, setWaNote });
  }

  async function guardarHistorial() {
    setSavedNote("");
    try {
      const registro = {
        numero_cotizacion: numeroCotizacion,
        fecha,
        creado_por: perfil.id,
        creado_por_email: perfil.email,
        proveedor,
        items,
        tasas,
        logistica,
        margen_usd: margenUSD,
        impuestos,
        cliente,
        total: quote.total,
      };
      const { error } = await supabase.from("cotizaciones").insert(registro);
      if (error) throw error;
      setSavedNote("Cotización guardada en el historial compartido de la empresa.");
      registrarAuditoria(perfil.email, "cotizacion_guardada", numeroCotizacion);
      cargarHistorial();
    } catch (e) {
      console.error("Error guardando en historial:", e);
      setSavedNote("No se pudo guardar la cotización. Verifica tu conexión e intenta de nuevo.");
    }
  }

  async function cargarHistorial() {
    setHistorialCargando(true);
    try {
      const { data, error } = await supabase
        .from("cotizaciones")
        .select("*")
        .order("creado_en", { ascending: true });
      if (error) throw error;
      setHistorial(data || []);
    } catch (e) {
      console.error("Error cargando historial:", e);
      setHistorial([]);
    }
    setHistorialCargando(false);
  }

  function aplicarRegistroHistorial(record) {
    setNumeroCotizacion(record.numero_cotizacion);
    setFecha(record.fecha);
    setProveedor(record.proveedor);
    setItems(record.items);
    setTasas(record.tasas);
    setLogistica(record.logistica);
    setMargenUSD(record.margen_usd || 0);
    setImpuestos(record.impuestos);
    setCliente(record.cliente);
  }

  function cargarCotizacion(record) {
    aplicarRegistroHistorial(record);
    setView("preview");
  }

  function descargarDesdeHistorial(record) {
    aplicarRegistroHistorial(record);
    setAutoDescargarPendiente(true);
    setView("preview");
  }

  // Solo quien generó la cotización o un admin activo puede eliminarla
  // (protegido por la política RLS "cotizaciones: eliminar admin o creador").
  // No requiere función de servidor: borrar una fila de cotizaciones no toca
  // auth.users, a diferencia de eliminar un usuario.
  async function eliminarCotizacion(r) {
    setHistorialError("");
    setHistorialNota("");
    try {
      // .select() después de .delete() hace que Supabase devuelva las filas
      // que realmente se borraron. Sin esto, si la política RLS bloquea el
      // borrado, Postgres no borra nada pero tampoco lanza error — el código
      // anterior asumía éxito solo porque "error" era null, aunque 0 filas
      // se hubieran tocado. Ahora lo comprobamos explícitamente.
      const { data, error } = await supabase.from("cotizaciones").delete().eq("id", r.id).select();
      if (error) throw error;
      if (!data || data.length === 0) {
        setHistorialError(
          "No se pudo eliminar la cotización: no tienes permiso, o ya no existe. No se registró ningún cambio."
        );
        return;
      }
      await registrarAuditoria(
        perfil.email,
        "cotizacion_eliminada",
        `Eliminó la cotización ${r.numero_cotizacion} (id ${r.id}), generada originalmente por ${r.creado_por_email || "desconocido"}`
      );
      setHistorialNota(`Cotización ${r.numero_cotizacion} eliminada. El número no se reutilizará.`);
      setHistorial((prev) => prev.filter((item) => item.id !== r.id));
    } catch (e) {
      setHistorialError(e.message || "No se pudo eliminar la cotización.");
    }
  }

  useEffect(() => {
    if (autoDescargarPendiente && view === "preview") {
      setAutoDescargarPendiente(false);
      const t = setTimeout(() => { generarPDFCliente(); }, 150);
      return () => clearTimeout(t);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoDescargarPendiente, view]);

  async function cargarUsuarios() {
    setUsuariosCargando(true);
    try {
      const { data, error } = await supabase.from("perfiles").select("*").order("creado_en", { ascending: true });
      if (error) throw error;
      setUsuarios(data || []);
    } catch (e) {
      console.error("Error cargando usuarios:", e);
      setUsuarios([]);
    }
    setUsuariosCargando(false);
  }

  // Activar/desactivar se hace directo contra Supabase (protegido por la
  // política de RLS "perfiles: admin activo puede actualizar" y por el
  // trigger que protege al administrador) — no depende de ninguna función
  // de servidor, así que no puede fallar por variables de entorno mal
  // configuradas ahí.
  async function cambiarEstadoUsuario(u, activar) {
    setUsuariosError("");
    setUsuariosNota("");
    try {
      const { error } = await supabase.from("perfiles").update({ activo: activar }).eq("id", u.id);
      if (error) throw error;
      await registrarAuditoria(
        perfil.email,
        activar ? "usuario_activado" : "usuario_desactivado",
        `${activar ? "Activó" : "Desactivó"} la cuenta de ${u.email}`
      );
      setUsuariosNota(`${u.email} quedó ${activar ? "activo" : "desactivado"}.`);
      cargarUsuarios();
    } catch (e) {
      setUsuariosError(e.message || "No se pudo completar la acción.");
    }
  }

  // Eliminar sí necesita borrar la cuenta de Supabase Auth, lo cual solo se
  // puede hacer con la service role key desde el servidor — por eso esta
  // acción sigue pasando por /api/admin-gestionar-usuario. Si prefieres no
  // depender de esa función, usa "Desactivar" en su lugar: revoca el acceso
  // igual de bien y queda registrado en la auditoría.
  async function eliminarUsuario(u) {
    setUsuariosError("");
    setUsuariosNota("");
    try {
      const { data: sesionActual } = await supabase.auth.getSession();
      const token = sesionActual?.session?.access_token;
      const resp = await fetch("/api/admin-gestionar-usuario", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ usuarioId: u.id, accion: "eliminar" }),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || "No se pudo eliminar el usuario");
      setUsuariosNota("Usuario eliminado.");
      cargarUsuarios();
    } catch (e) {
      setUsuariosError(e.message || "No se pudo eliminar el usuario.");
    }
  }

  async function cargarAuditoria() {
    setAuditoriaCargando(true);
    try {
      const { data, error } = await supabase
        .from("auditoria")
        .select("*")
        .order("creado_en", { ascending: false })
        .limit(200);
      if (error) throw error;
      setAuditoria(data || []);
    } catch (e) {
      console.error("Error cargando auditoría:", e);
      setAuditoria([]);
    }
    setAuditoriaCargando(false);
  }

  async function cerrarSesion() {
    registrarAuditoria(perfil.email, "cierre_sesion", "Salió de la plataforma");
    await supabase.auth.signOut();
  }

  function nuevaCotizacion() {
    setNumeroCotizacion("");
    setFecha(todayISO());
    setProveedor({ nombre: "", tipo: "Fabricante" });
    setItems([emptyItem()]);
    setTasas({ DOP: 60 });
    setLogistica({ valorDOP: 0 });
    setMargenUSD(0);
    setImpuestos([{ id: uid(), nombre: "ITBIS", porcentaje: 18, activo: true }]);
    setCliente(defaultCliente());
    setErrores([]);
    setSavedNote("");
    setArchivoNombre("");
    setExtraccionOk(false);
    setExtraccionError("");
    setPdfGenerado(false);
    setPdfError("");
    setWaError("");
    setWaNote("");
    setView("upload");
  }

  useEffect(() => {
    if (view === "historial" && historial.length === 0) cargarHistorial();
    if (view === "usuarios" && esAdmin) cargarUsuarios();
    if (view === "auditoria" && esAdmin) cargarAuditoria();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);

  return (
    <div className="cot-app">
      <style>{`
        .cot-app {
          --ink: #16233a;
          --ink-soft: #3d5064;
          --paper: #f1efe6;
          --surface: #ffffff;
          --line: #d9d4c2;
          --brass: #a9782e;
          --brass-ink: #6b4c1c;
          --teal: #1e6f63;
          --teal-ink: #12463d;
          --brick: #a23b2e;
          --brick-bg: #f6e6e3;
          --font-display: 'Spectral', Georgia, serif;
          --font-body: 'IBM Plex Sans', -apple-system, sans-serif;
          --font-mono: 'IBM Plex Mono', 'Courier New', monospace;
          background: var(--paper);
          color: var(--ink);
          font-family: var(--font-body);
          border-radius: 14px;
          border: 1px solid var(--line);
          overflow: hidden;
        }
        .cot-app * { box-sizing: border-box; }
        .cot-topbar {
          display: flex; align-items: center; justify-content: space-between;
          padding: 18px 24px; background: var(--ink); color: #f1efe6;
          gap: 12px; flex-wrap: wrap;
        }
        .cot-brand { display: flex; align-items: center; gap: 10px; }
        .cot-brand-mark {
          width: 34px; height: 34px; border-radius: 50%;
          border: 1.5px solid var(--brass); display: flex; align-items: center;
          justify-content: center; color: var(--brass);
        }
        .cot-brand-text h1 { font-family: var(--font-display); font-size: 18px; margin: 0; font-weight: 600; letter-spacing: 0.2px; }
        .cot-brand-text p { margin: 0; font-size: 11px; color: #b9c2cd; font-family: var(--font-mono); letter-spacing: 0.5px; }
        .cot-nav { display: flex; gap: 6px; }
        .cot-nav button {
          background: transparent; border: 1px solid rgba(241,239,230,0.25); color: #e7e4d8;
          padding: 8px 14px; border-radius: 8px; font-size: 13px; cursor: pointer;
          display: flex; align-items: center; gap: 6px; font-family: var(--font-body);
        }
        .cot-nav button.active { background: var(--brass); border-color: var(--brass); color: #241a08; font-weight: 600; }
        .cot-nav button:hover:not(.active) { border-color: rgba(241,239,230,0.6); }
        .cot-body { padding: 24px; }
        .cot-grid { display: grid; grid-template-columns: 1.1fr 0.9fr; gap: 20px; align-items: start; }
        @media (max-width: 860px) { .cot-grid { grid-template-columns: 1fr; } }
        .cot-card {
          background: var(--surface); border: 1px solid var(--line); border-radius: 10px;
          padding: 18px 20px; margin-bottom: 16px;
        }
        .cot-card h2 {
          font-family: var(--font-display); font-size: 15px; margin: 0 0 14px;
          color: var(--ink); display: flex; align-items: center; gap: 8px;
          padding-bottom: 10px; border-bottom: 1px dashed var(--line);
        }
        .cot-card h2 svg { color: var(--brass); }
        .cot-field { margin-bottom: 12px; }
        .cot-field label {
          display: block; font-size: 11px; text-transform: uppercase; letter-spacing: 0.6px;
          color: var(--ink-soft); margin-bottom: 4px; font-family: var(--font-mono);
        }
        .cot-field input, .cot-field select, .cot-field textarea {
          width: 100%; padding: 8px 10px; border: 1px solid var(--line); border-radius: 6px;
          font-size: 14px; font-family: var(--font-body); color: var(--ink); background: #fff;
        }
        .cot-field textarea { resize: vertical; min-height: 60px; }
        .cot-row { display: grid; gap: 10px; }
        .cot-row.cols-2 { grid-template-columns: 1fr 1fr; }
        .cot-row.cols-3 { grid-template-columns: 1fr 1fr 1fr; }
        .cot-item {
          border: 1px solid var(--line); border-radius: 8px; padding: 12px; margin-bottom: 10px;
          background: #fbfaf5; position: relative;
        }
        .cot-item-grid { display: grid; grid-template-columns: 2.2fr 0.7fr 1fr 0.8fr auto; gap: 8px; align-items: end; }
        @media (max-width: 700px) { .cot-item-grid { grid-template-columns: 1fr 1fr; } }
        .cot-item-margin { margin: 10px 0 0; padding-top: 10px; border-top: 1px dashed var(--line); max-width: 320px; }
        .cot-item-margin label { color: var(--brass-ink); }
        .cot-iconbtn {
          border: 1px solid var(--line); background: #fff; border-radius: 6px; padding: 8px;
          cursor: pointer; color: var(--brick); display: flex; align-items: center; justify-content: center;
        }
        .cot-iconbtn:hover { background: var(--brick-bg); }
        .cot-addline {
          display: flex; align-items: center; gap: 6px; background: transparent; border: 1px dashed var(--brass);
          color: var(--brass-ink); padding: 8px 12px; border-radius: 6px; font-size: 13px; cursor: pointer; font-family: var(--font-body);
        }
        .cot-addline:hover { background: #fbf2e2; }
        .cot-toggle-group { display: flex; border: 1px solid var(--line); border-radius: 6px; overflow: hidden; }
        .cot-toggle-group button {
          flex: 1; padding: 7px 10px; font-size: 12px; border: none; background: #fff; cursor: pointer;
          color: var(--ink-soft); font-family: var(--font-body);
        }
        .cot-toggle-group button.active { background: var(--ink); color: #f1efe6; }
        .cot-tax-row { display: flex; gap: 8px; align-items: center; margin-bottom: 8px; }
        .cot-tax-row input[type="text"] { flex: 1; }
        .cot-tax-row input[type="number"] { width: 80px; }
        .cot-checkbox { display: flex; align-items: center; gap: 6px; }
        .cot-primary-btn {
          background: var(--brass); color: #241a08; border: none; padding: 12px 20px; border-radius: 8px;
          font-size: 14px; font-weight: 600; cursor: pointer; display: inline-flex; align-items: center; gap: 8px;
          font-family: var(--font-body);
        }
        .cot-primary-btn:hover { background: #97671f; }
        .cot-whatsapp-btn {
          background: #25D366; color: #073b21; border: none; padding: 12px 20px; border-radius: 8px;
          font-size: 14px; font-weight: 700; cursor: pointer; display: inline-flex; align-items: center; gap: 8px;
          font-family: var(--font-body); box-shadow: 0 2px 0 rgba(0,0,0,0.08);
        }
        .cot-whatsapp-btn:hover { background: #1fb955; }
        .cot-whatsapp-btn:disabled { opacity: 0.6; cursor: default; }
        .cot-secondary-btn {
          background: #fff; color: var(--ink); border: 1px solid var(--line); padding: 12px 18px; border-radius: 8px;
          font-size: 14px; cursor: pointer; display: inline-flex; align-items: center; gap: 8px; font-family: var(--font-body);
        }
        .cot-secondary-btn:hover { border-color: var(--ink-soft); }
        .cot-error-box {
          background: var(--brick-bg); border: 1px solid #e2b5ac; color: var(--brick); border-radius: 8px;
          padding: 12px 14px; margin-bottom: 16px; font-size: 13px;
        }
        .cot-error-box ul { margin: 6px 0 0 18px; padding: 0; }
        .cot-live-panel {
          position: sticky; top: 16px; background: var(--ink); color: #f1efe6; border-radius: 10px;
          padding: 18px 20px; font-family: var(--font-mono);
        }
        .cot-live-panel h3 { font-family: var(--font-display); font-size: 14px; margin: 0 0 12px; font-weight: 500; color: #d8cfa9; }
        .cot-live-line { display: flex; justify-content: space-between; font-size: 12.5px; margin-bottom: 7px; color: #cdd4dc; }
        .cot-live-line span:last-child { color: #f1efe6; }
        .cot-live-total { border-top: 1px dashed rgba(241,239,230,0.35); margin-top: 10px; padding-top: 10px; display: flex; justify-content: space-between; align-items: baseline; }
        .cot-live-total span:first-child { font-family: var(--font-display); font-size: 13px; color: #d8cfa9; }
        .cot-live-total span:last-child { font-size: 22px; color: var(--brass); font-weight: 600; }
        .cot-stamp {
          width: 78px; height: 78px; border-radius: 50%; border: 2px solid var(--teal); color: var(--teal-ink);
          display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center;
          transform: rotate(-8deg); font-family: var(--font-mono); flex-shrink: 0;
        }
        .cot-stamp span { font-size: 9px; letter-spacing: 0.5px; line-height: 1.3; }
        .cot-stamp strong { font-size: 12px; }
        .cot-doc {
          background: var(--surface); border: 1px solid var(--line); border-radius: 10px; padding: 32px;
          max-width: 780px; margin: 0 auto;
        }
        .cot-letterhead {
          display: flex; align-items: center; justify-content: space-between; gap: 16px;
          background: var(--ink); margin: -32px -32px 22px -32px; padding: 18px 28px;
          border-radius: 10px 10px 0 0; flex-wrap: wrap;
        }
        .cot-letterhead-logo { height: 46px; width: auto; display: block; }
        .cot-letterhead-info {
          display: flex; flex-direction: column; align-items: flex-end; gap: 2px;
          font-family: var(--font-mono); font-size: 11px; color: #cdd4dc; text-align: right;
        }
        .cot-letterhead-info strong { font-family: var(--font-display); font-size: 13px; color: #f1efe6; font-weight: 600; letter-spacing: 0.2px; }
        .cot-letterhead-info span.gold { color: var(--brass); }
        .cot-doc-header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid var(--ink); padding-bottom: 16px; margin-bottom: 20px; gap: 16px; }
        .cot-doc-header h1 { font-family: var(--font-display); font-size: 26px; margin: 0; }
        .cot-doc-header .meta { font-family: var(--font-mono); font-size: 12px; color: var(--ink-soft); text-align: right; }
        .cot-doc-section { margin-bottom: 20px; }
        .cot-doc-section h3 {
          font-size: 11px; text-transform: uppercase; letter-spacing: 0.8px; color: var(--brass-ink);
          font-family: var(--font-mono); margin: 0 0 8px; border-bottom: 1px dashed var(--line); padding-bottom: 6px;
        }
        .cot-doc-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 6px 20px; font-size: 13.5px; }
        .cot-doc-grid div span { color: var(--ink-soft); font-size: 11px; display: block; font-family: var(--font-mono); }
        .cot-doc-table { width: 100%; border-collapse: collapse; font-size: 13.5px; }
        .cot-doc-table th { text-align: left; font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.5px; color: var(--ink-soft); border-bottom: 1px solid var(--ink); padding: 6px 8px; font-family: var(--font-mono); font-weight: 500; }
        .cot-doc-table td { padding: 8px; border-bottom: 1px solid var(--line); }
        .cot-doc-table td.num, .cot-doc-table th.num { text-align: right; font-family: var(--font-mono); }
        .cot-doc-totals { margin-top: 12px; margin-left: auto; width: 260px; font-family: var(--font-mono); font-size: 13px; }
        .cot-doc-totals .line { display: flex; justify-content: space-between; padding: 4px 0; color: var(--ink-soft); }
        .cot-doc-totals .total { display: flex; justify-content: space-between; border-top: 2px solid var(--ink); margin-top: 8px; padding-top: 8px; font-size: 17px; color: var(--ink); font-weight: 600; }
        .cot-doc-foot { margin-top: 24px; padding-top: 16px; border-top: 1px dashed var(--line); font-size: 12px; color: var(--ink-soft); }
        /* Refuerzo de nitidez: texto en negro sólido en el cuerpo del documento del
           cliente (para que se lea mejor en el PDF), sin afectar el membrete oscuro. */
        .cot-doc-section h3, .cot-doc-grid div, .cot-doc-table td, .cot-doc-table th,
        .cot-doc-totals .line, .cot-doc-totals .total, .cot-doc-foot, .cot-doc-header h1 {
          color: #0a0a0a;
        }
        .cot-doc-grid div span, .cot-doc-table th { color: #3d5064; }
        .cot-doc-totals .line span:first-child { color: #3d5064; }
        .cot-internal-badge {
          display: inline-block; background: var(--brick-bg); color: var(--brick); font-size: 10.5px;
          padding: 3px 10px; border-radius: 20px; font-family: var(--font-mono); letter-spacing: 0.5px; margin-bottom: 12px;
        }
        .cot-history-item {
          display: flex; justify-content: space-between; align-items: center; background: var(--surface);
          border: 1px solid var(--line); border-radius: 8px; padding: 12px 16px; margin-bottom: 8px; cursor: pointer;
        }
        .cot-history-item:hover { border-color: var(--brass); }
        .cot-empty { text-align: center; padding: 40px 20px; color: var(--ink-soft); }
        .cot-toolbar { display: flex; gap: 10px; margin-bottom: 18px; flex-wrap: wrap; }
        .cot-upload-box {
          border: 2px dashed var(--line); border-radius: 12px; padding: 40px 24px; text-align: center;
          background: var(--surface); max-width: 560px; margin: 20px auto;
        }
        .cot-upload-box input[type="file"] { display: none; }
        .cot-upload-label {
          display: inline-flex; align-items: center; gap: 8px; background: var(--ink); color: #f1efe6;
          padding: 11px 20px; border-radius: 8px; cursor: pointer; font-size: 14px; font-family: var(--font-body);
        }
        .cot-upload-label:hover { background: var(--ink-soft); }
        .cot-upload-hint { font-size: 12.5px; color: var(--ink-soft); margin-top: 10px; }
        .cot-spin { animation: cot-spin 0.9s linear infinite; }
        @keyframes cot-spin { to { transform: rotate(360deg); } }
        .cot-skip-link {
          display: block; text-align: center; margin-top: 16px; font-size: 13px; color: var(--ink-soft);
          background: none; border: none; cursor: pointer; text-decoration: underline; font-family: var(--font-body);
        }
        .cot-badge {
          position: fixed; bottom: 14px; right: 14px; background: var(--ink); color: var(--brass);
          font-family: var(--font-mono); font-size: 11px; letter-spacing: 0.3px; padding: 6px 12px;
          border-radius: 20px; box-shadow: 0 2px 8px rgba(0,0,0,0.18); z-index: 50; pointer-events: none;
        }
        @media print {
          .cot-topbar, .cot-toolbar, .cot-error-box, .cot-print-hide, .cot-badge { display: none !important; }
          .cot-app { border: none; }
          .cot-body { padding: 0; }
        }
      `}</style>

      <div className="cot-badge">Desarrollado por Grupo D'Brians SRL</div>

      <div className="cot-topbar">
        <div className="cot-brand">
          <div className="cot-brand-mark"><Stamp size={18} /></div>
          <div className="cot-brand-text">
            <h1>Quote Flow</h1>
            <p>{numeroCotizacion || "Borrador"}</p>
          </div>
        </div>
        <div className="cot-nav">
          <button className={view === "upload" ? "active" : ""} onClick={() => setView("upload")}>
            <FileText size={14} /> Documento
          </button>
          <button className={view === "form" ? "active" : ""} onClick={() => setView("form")}>
            <Building2 size={14} /> Datos
          </button>
          <button className={view === "preview" ? "active" : ""} onClick={() => { if (view === "form") generar(); else setView("preview"); }} disabled={obteniendoNumero}>
            <Eye size={14} /> {obteniendoNumero ? "Generando…" : "Cotización"}
          </button>
          <button className={view === "historial" ? "active" : ""} onClick={() => setView("historial")}>
            <HistoryIcon size={14} /> Historial
          </button>
          {esAdmin && (
            <button className={view === "usuarios" ? "active" : ""} onClick={() => setView("usuarios")}>
              <Users size={14} /> Usuarios
            </button>
          )}
          {esAdmin && (
            <button className={view === "auditoria" ? "active" : ""} onClick={() => setView("auditoria")}>
              <ClipboardList size={14} /> Auditoría
            </button>
          )}
          <button onClick={cerrarSesion} title={perfil?.email}>
            <LogOut size={14} /> Salir
          </button>
        </div>
      </div>

      <div className="cot-body">
        {view === "upload" && (
          <div>
            <div className="cot-upload-box">
              {!extrayendo && (
                <>
                  <Upload size={26} style={{ color: "var(--brass)", marginBottom: 10 }} />
                  <p style={{ margin: "0 0 14px", fontSize: 14, color: "var(--ink-soft)" }}>
                    Sube la cotización del proveedor (PDF o imagen) y el sistema extrae los artículos,
                    precios y moneda automáticamente.
                  </p>
                  <label className="cot-upload-label">
                    <Upload size={15} />
                    {archivoNombre ? "Cambiar archivo" : "Seleccionar archivo"}
                    <input
                      type="file"
                      accept=".pdf,.png,.jpg,.jpeg,.webp"
                      onChange={(e) => extraerDocumento(e.target.files && e.target.files[0])}
                    />
                  </label>
                  {archivoNombre && <p className="cot-upload-hint">{archivoNombre}</p>}
                </>
              )}
              {extrayendo && (
                <>
                  <Loader2 size={26} className="cot-spin" style={{ color: "var(--brass)", marginBottom: 10 }} />
                  <p style={{ margin: 0, fontSize: 14, color: "var(--ink-soft)" }}>
                    Leyendo {archivoNombre} y extrayendo los datos…
                  </p>
                </>
              )}
              {extraccionError && (
                <div className="cot-error-box" style={{ textAlign: "left", marginTop: 16 }}>{extraccionError}</div>
              )}
              {extraccionOk && !extrayendo && (
                <div className="cot-error-box" style={{ textAlign: "left", marginTop: 16, background: "#e6f2ee", borderColor: "#9cc7ba", color: "var(--teal-ink)" }}>
                  <CheckCircle2 size={14} style={{ verticalAlign: "-2px", marginRight: 6 }} />
                  Datos extraídos. Revisa y completa el resto en la pestaña "Datos".
                  <div style={{ marginTop: 10 }}>
                    <button className="cot-primary-btn" onClick={() => setView("form")}>
                      Ir a los datos <ChevronRight size={16} />
                    </button>
                  </div>
                </div>
              )}
            </div>
            <button className="cot-skip-link" onClick={() => setView("form")}>
              <SkipForward size={12} style={{ verticalAlign: "-2px", marginRight: 4 }} />
              Prefiero cargar los datos manualmente
            </button>
          </div>
        )}

        {view === "form" && (
          <>
            {errores.length > 0 && (
              <div className="cot-error-box">
                <strong>Revisa lo siguiente antes de generar la cotización:</strong>
                <ul>{errores.map((e, i) => <li key={i}>{e}</li>)}</ul>
              </div>
            )}
            <div className="cot-grid">
              <div>
                <div className="cot-card">
                  <h2><Building2 size={16} /> Proveedor</h2>
                  <div className="cot-row cols-2">
                    <div className="cot-field">
                      <label>Nombre del proveedor</label>
                      <input value={proveedor.nombre} onChange={(e) => setProveedor({ ...proveedor, nombre: e.target.value })} placeholder="Ej. Global Supply Co." />
                    </div>
                    <div className="cot-field">
                      <label>Tipo de proveedor</label>
                      <select value={proveedor.tipo} onChange={(e) => setProveedor({ ...proveedor, tipo: e.target.value })}>
                        <option>Fabricante</option>
                        <option>Distribuidor</option>
                        <option>Mayorista</option>
                        <option>Agente / Broker</option>
                        <option>Otro</option>
                      </select>
                    </div>
                  </div>
                </div>

                <div className="cot-card">
                  <h2><DollarSign size={16} /> Artículos de la cotización del proveedor</h2>
                  {items.map((it) => (
                    <div className="cot-item" key={it.id}>
                      <div className="cot-item-grid">
                        <div className="cot-field" style={{ marginBottom: 0 }}>
                          <label>Descripción</label>
                          <input value={it.descripcion} onChange={(e) => updateItem(it.id, { descripcion: e.target.value })} placeholder="Producto o servicio" />
                        </div>
                        <div className="cot-field" style={{ marginBottom: 0 }}>
                          <label>Cant.</label>
                          <input type="number" min="0" value={it.cantidad} onChange={(e) => updateItem(it.id, { cantidad: Number(e.target.value) })} />
                        </div>
                        <div className="cot-field" style={{ marginBottom: 0 }}>
                          <label>Precio unit.</label>
                          <input type="number" min="0" step="0.01" value={it.precioUnitario} onChange={(e) => updateItem(it.id, { precioUnitario: Number(e.target.value) })} />
                        </div>
                        <div className="cot-field" style={{ marginBottom: 0 }}>
                          <label>Moneda</label>
                          <input
                            list="cot-monedas"
                            value={it.moneda}
                            onChange={(e) => updateItem(it.id, { moneda: e.target.value.toUpperCase().slice(0, 3) })}
                          />
                        </div>
                        <button className="cot-iconbtn" onClick={() => removeItem(it.id)} title="Eliminar renglón"><Trash2 size={15} /></button>
                      </div>
                    </div>
                  ))}
                  <button className="cot-addline" onClick={addItem}><Plus size={14} /> Agregar artículo</button>
                  <datalist id="cot-monedas">
                    {CURRENCY_PRESETS.map((c) => <option key={c} value={c} />)}
                  </datalist>
                </div>

                <div className="cot-card">
                  <h2><Percent size={16} /> Tasas de cambio del día</h2>
                  <div className="cot-row cols-3">
                    {monedasParaTasas.map((c) => (
                      <div className="cot-field" key={c}>
                        <label>{c} por 1 USD</label>
                        <input type="number" min="0" step="0.0001" value={tasas[c] ?? ""} onChange={(e) => setTasas({ ...tasas, [c]: Number(e.target.value) })} />
                      </div>
                    ))}
                  </div>
                </div>

                <div className="cot-card">
                  <h2><DollarSign size={16} /> Gastos logísticos / transporte</h2>
                  <div className="cot-field" style={{ maxWidth: 260 }}>
                    <label>Monto en pesos dominicanos (RD$)</label>
                    <input type="number" min="0" step="0.01" value={logistica.valorDOP} onChange={(e) => setLogistica({ valorDOP: Number(e.target.value) })} />
                  </div>
                  <p style={{ fontSize: 12.5, color: "var(--ink-soft)", margin: "6px 0 0" }}>
                    Se convierte a USD con la tasa RD$ del día al generar la cotización: {fmtUSD(quote.logisticaTotal)}
                  </p>
                </div>

                <div className="cot-card">
                  <h2><Percent size={16} /> Margen de gestión</h2>
                  <div className="cot-field" style={{ maxWidth: 260 }}>
                    <label>Margen por producto (USD)</label>
                    <input type="number" min="0" step="0.01" value={margenUSD} onChange={(e) => setMargenUSD(Number(e.target.value))} />
                  </div>
                  <p style={{ fontSize: 12.5, color: "var(--ink-soft)", margin: "6px 0 0" }}>
                    Se pone una sola vez y se suma automáticamente a cada producto de la cotización, en USD.
                    Uso interno — el cliente solo verá el precio final. Con {items.length} artículo{items.length === 1 ? "" : "s"}, el margen total es {fmtUSD(quote.margenTotal)}.
                  </p>
                </div>

                <div className="cot-card">
                  <h2><Percent size={16} /> Impuestos</h2>
                  {impuestos.map((t) => (
                    <div className="cot-tax-row" key={t.id}>
                      <label className="cot-checkbox">
                        <input type="checkbox" checked={t.activo} onChange={(e) => updateImpuesto(t.id, { activo: e.target.checked })} />
                      </label>
                      <input type="text" value={t.nombre} onChange={(e) => updateImpuesto(t.id, { nombre: e.target.value })} />
                      <input type="number" min="0" step="0.01" value={t.porcentaje} onChange={(e) => updateImpuesto(t.id, { porcentaje: Number(e.target.value) })} />
                      <span style={{ fontSize: 12, color: "var(--ink-soft)" }}>%</span>
                      <button className="cot-iconbtn" onClick={() => removeImpuesto(t.id)} title="Eliminar impuesto"><Trash2 size={14} /></button>
                    </div>
                  ))}
                  <button className="cot-addline" onClick={addImpuesto}><Plus size={14} /> Agregar impuesto</button>
                </div>

                <div className="cot-card">
                  <h2><Building2 size={16} /> Cliente final</h2>
                  <div className="cot-row cols-2">
                    <div className="cot-field">
                      <label>Nombre del cliente</label>
                      <input value={cliente.nombre} onChange={(e) => setCliente({ ...cliente, nombre: e.target.value })} placeholder="Nombre completo o empresa" />
                    </div>
                    <div className="cot-field">
                      <label>Teléfono</label>
                      <input value={cliente.telefono} onChange={(e) => setCliente({ ...cliente, telefono: e.target.value })} placeholder="809-000-0000" />
                    </div>
                  </div>
                  <div className="cot-field">
                    <label>Dirección de envío</label>
                    <input value={cliente.direccion} onChange={(e) => setCliente({ ...cliente, direccion: e.target.value })} placeholder="Calle, sector, ciudad" />
                  </div>
                  <div className="cot-row cols-2">
                    <div className="cot-field">
                      <label>Método de pago</label>
                      <select value={cliente.metodoPago} onChange={(e) => setCliente({ ...cliente, metodoPago: e.target.value })}>
                        {PAYMENT_METHODS.map((m) => <option key={m}>{m}</option>)}
                      </select>
                    </div>
                    {cliente.metodoPago === "Otro" && (
                      <div className="cot-field">
                        <label>Especifica el método</label>
                        <input value={cliente.metodoPagoOtro} onChange={(e) => setCliente({ ...cliente, metodoPagoOtro: e.target.value })} />
                      </div>
                    )}
                    <div className="cot-field">
                      <label>Vigencia (días desde hoy)</label>
                      <input type="number" min="1" value={cliente.vigenciaDias} onChange={(e) => setCliente({ ...cliente, vigenciaDias: Number(e.target.value) })} />
                    </div>
                  </div>
                  <div className="cot-field">
                    <label>Condiciones</label>
                    <textarea value={cliente.condiciones} onChange={(e) => setCliente({ ...cliente, condiciones: e.target.value })} />
                  </div>
                </div>

                <button className="cot-primary-btn" onClick={generar}>
                  Generar cotización <ChevronRight size={16} />
                </button>
              </div>

              <div className="cot-live-panel">
                <h3>Resumen en vivo (uso interno)</h3>
                <div className="cot-live-line"><span>Subtotal proveedor</span><span>{fmtUSD(quote.subtotalProveedor)}</span></div>
                <div className="cot-live-line"><span>Logística (RD$ {logistica.valorDOP || 0})</span><span>{fmtUSD(quote.logisticaTotal)}</span></div>
                <div className="cot-live-line"><span>Margen ({fmtUSD(margenUSD)} x {items.length})</span><span>{fmtUSD(quote.margenTotal)}</span></div>
                <div className="cot-live-line"><span>Subtotal cliente</span><span>{fmtUSD(quote.subtotalCliente)}</span></div>
                {quote.impuestosCalc.map((t) => (
                  <div className="cot-live-line" key={t.id}><span>{t.nombre} ({t.porcentaje}%)</span><span>{fmtUSD(t.monto)}</span></div>
                ))}
                <div className="cot-live-total"><span>Total cliente</span><span>{fmtUSD(quote.total)}</span></div>
              </div>
            </div>
          </>
        )}

        {view === "preview" && (
          <div>
            <div className="cot-toolbar">
              <button className="cot-secondary-btn" onClick={() => setView("form")}><ArrowLeft size={15} /> Editar</button>
              <button className="cot-primary-btn" onClick={generarPDFCliente} disabled={generandoPDF}>
                {generandoPDF ? <Loader2 size={15} className="cot-spin" /> : <Download size={15} />}
                {generandoPDF ? "Generando…" : "Generar PDF"}
              </button>
              <button className="cot-whatsapp-btn" onClick={abrirWhatsApp} disabled={!pdfGenerado} title={!pdfGenerado ? "Genera el PDF primero" : ""}>
                <MessageCircle size={16} /> 📲 Abrir WhatsApp
              </button>
              <button className="cot-secondary-btn" onClick={() => window.print()}><Printer size={15} /> Imprimir</button>
              <button className="cot-secondary-btn" onClick={guardarHistorial}><Save size={15} /> Guardar en historial</button>
              <button className="cot-secondary-btn" onClick={nuevaCotizacion}><RefreshCw size={15} /> Nueva cotización</button>
            </div>
            {pdfError && <div className="cot-error-box">{pdfError}</div>}
            {pdfGenerado && !pdfError && (
              <div className="cot-error-box" style={{ background: "#e6f2ee", borderColor: "#9cc7ba", color: "var(--teal-ink)", whiteSpace: "pre-line" }}>
                <CheckCircle2 size={14} style={{ verticalAlign: "-2px", marginRight: 6 }} />
                {`✓ Cotización preparada correctamente.\n✓ PDF descargado: Cotizacion-${numeroCotizacion}.pdf — revisa tu carpeta de Descargas.`}
              </div>
            )}
            {waError && <div className="cot-error-box">{waError}</div>}
            {waNote && (
              <div className="cot-error-box" style={{ background: "#e6f2ee", borderColor: "#9cc7ba", color: "var(--teal-ink)" }}>
                <CheckCircle2 size={14} style={{ verticalAlign: "-2px", marginRight: 6 }} />{waNote}
              </div>
            )}
            {savedNote && (
              <div className="cot-error-box" style={{ background: "#e6f2ee", borderColor: "#9cc7ba", color: "var(--teal-ink)" }}>
                <CheckCircle2 size={14} style={{ verticalAlign: "-2px", marginRight: 6 }} />{savedNote}
              </div>
            )}

            <div className="cot-internal-badge cot-print-hide">Vista interna — desglose completo (no se imprime)</div>
            <div className="cot-doc cot-print-hide" style={{ marginBottom: 24 }}>
              <div className="cot-doc-header">
                <h1>Desglose interno</h1>
                <div className="meta">{numeroCotizacion}<br />{fecha}</div>
              </div>
              <div className="cot-doc-section">
                <h3>Proveedor</h3>
                <div className="cot-doc-grid">
                  <div><span>Nombre</span>{proveedor.nombre || "—"}</div>
                  <div><span>Tipo</span>{proveedor.tipo}</div>
                </div>
              </div>
              <div className="cot-doc-section">
                <h3>Artículos y costo de proveedor</h3>
                <div style={{ overflowX: "auto" }}>
                <table className="cot-doc-table">
                  <thead>
                    <tr>
                      <th>Descripción</th><th className="num">Cant.</th><th className="num">P. unit. original</th>
                      <th className="num">Tasa</th><th className="num">P. unit. USD</th><th className="num">Total proveedor</th>
                      <th className="num">Logística asignada</th><th className="num">Margen (USD)</th><th className="num">Precio final</th>
                    </tr>
                  </thead>
                  <tbody>
                    {quote.itemsFinal.map((it) => (
                      <tr key={it.id}>
                        <td>{it.descripcion || "—"}</td>
                        <td className="num">{it.cantidad}</td>
                        <td className="num">{fmtMoneda(it.precioUnitario, it.moneda)}</td>
                        <td className="num">{it.tasa}</td>
                        <td className="num">{fmtUSD(it.precioUnitUSD)}</td>
                        <td className="num">{fmtUSD(it.totalProveedorUSD)}</td>
                        <td className="num">{fmtUSD(it.logisticaItem)}</td>
                        <td className="num">{fmtUSD(it.margenItem)}</td>
                        <td className="num">{fmtUSD(it.totalFinalItem)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                </div>
              </div>
              <div className="cot-doc-totals">
                <div className="line"><span>Subtotal proveedor</span><span>{fmtUSD(quote.subtotalProveedor)}</span></div>
                <div className="line"><span>Gastos logísticos (RD$ {logistica.valorDOP || 0} a {tasas.DOP || 0})</span><span>{fmtUSD(quote.logisticaTotal)}</span></div>
                <div className="line"><span>Margen de gestión ({fmtUSD(margenUSD)} x {items.length} producto{items.length === 1 ? "" : "s"})</span><span>{fmtUSD(quote.margenTotal)}</span></div>
                <div className="line"><span>Subtotal cliente</span><span>{fmtUSD(quote.subtotalCliente)}</span></div>
                {quote.impuestosCalc.map((t) => (
                  <div className="line" key={t.id}><span>{t.nombre} ({t.porcentaje}%)</span><span>{fmtUSD(t.monto)}</span></div>
                ))}
                <div className="total"><span>Total</span><span>{fmtUSD(quote.total)}</span></div>
              </div>
            </div>

            <div className="cot-doc" ref={clienteDocRef}>
              <div className="cot-letterhead">
                <img src={LOGO_DATA_URI} alt="Grupo D'Brians" className="cot-letterhead-logo" />
                <div className="cot-letterhead-info">
                  <strong>Grupo D'Brians SRL</strong>
                  <span>RNC: 13338207</span>
                  <span className="gold">+1 829-664-2424</span>
                  <span>info@grupodbrians.com</span>
                </div>
              </div>
              <div className="cot-doc-header">
                <h1>Cotización</h1>
                <div className="meta">
                  N.º {numeroCotizacion}<br />
                  Fecha: {fecha}<br />
                  Vigente hasta: {addDaysISO(cliente.vigenciaDias)}
                </div>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16 }}>
                <div className="cot-doc-section" style={{ flex: 1 }}>
                  <h3>Cliente</h3>
                  <div className="cot-doc-grid">
                    <div><span>Nombre</span>{cliente.nombre || "—"}</div>
                    <div><span>Teléfono</span>{cliente.telefono || "—"}</div>
                    <div style={{ gridColumn: "1 / -1" }}><span>Dirección de envío</span>{cliente.direccion || "—"}</div>
                    <div><span>Método de pago</span>{cliente.metodoPago === "Otro" ? cliente.metodoPagoOtro : cliente.metodoPago}</div>
                    <div><span>Moneda</span>USD</div>
                  </div>
                </div>
                <div className="cot-stamp">
                  <span>TASA DEL DÍA</span>
                  <strong>{tasas.DOP || "—"}</strong>
                  <span>RD$ / USD</span>
                </div>
              </div>

              <div className="cot-doc-section">
                <h3>Detalle</h3>
                <table className="cot-doc-table">
                  <thead>
                    <tr><th>Descripción</th><th className="num">Cant.</th><th className="num">Precio unit. (USD)</th><th className="num">Total (USD)</th></tr>
                  </thead>
                  <tbody>
                    {quote.itemsFinal.map((it) => (
                      <tr key={it.id}>
                        <td>{it.descripcion || "—"}</td>
                        <td className="num">{it.cantidad}</td>
                        <td className="num">{fmtUSD(it.precioUnitFinal)}</td>
                        <td className="num">{fmtUSD(it.totalFinalItem)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="cot-doc-totals">
                <div className="line"><span>Subtotal</span><span>{fmtUSD(quote.subtotalCliente)}</span></div>
                {quote.impuestosCalc.map((t) => (
                  <div className="line" key={t.id}><span>{t.nombre} ({t.porcentaje}%)</span><span>{fmtUSD(t.monto)}</span></div>
                ))}
                <div className="total"><span>Total (USD)</span><span>{fmtUSD(quote.total)}</span></div>
              </div>

              <div className="cot-doc-foot">
                <strong style={{ color: "var(--ink)" }}>Condiciones:</strong> {cliente.condiciones}
              </div>
            </div>
          </div>
        )}

        {view === "historial" && (
          <div>
            <div className="cot-toolbar">
              <button className="cot-secondary-btn" onClick={cargarHistorial}><RefreshCw size={15} /> Actualizar</button>
            </div>
            {historialError && <div className="cot-error-box" style={{ marginBottom: 14 }}>{historialError}</div>}
            {historialNota && (
              <div className="cot-error-box" style={{ marginBottom: 14, background: "#e6f2ee", borderColor: "#9cc7ba", color: "var(--teal-ink)" }}>
                <CheckCircle2 size={14} style={{ verticalAlign: "-2px", marginRight: 6 }} />{historialNota}
              </div>
            )}
            {historialCargando && <p style={{ color: "var(--ink-soft)" }}>Cargando historial…</p>}
            {!historialCargando && historial.length === 0 && (
              <div className="cot-empty">
                <AlertCircle size={22} style={{ marginBottom: 8 }} />
                <p>No hay cotizaciones guardadas todavía. Genera una y guárdala desde la vista de cotización.</p>
              </div>
            )}
            {historial.map((r) => (
              <div className="cot-history-item" key={r.numero_cotizacion}>
                <div style={{ cursor: "pointer", flex: 1 }} onClick={() => cargarCotizacion(r)}>
                  <strong>{r.numero_cotizacion}</strong>
                  <div style={{ fontSize: 12, color: "var(--ink-soft)" }}>
                    {r.cliente?.nombre || "Sin cliente"} · {r.proveedor?.nombre || "Sin proveedor"} · {r.fecha} · generada por {r.creado_por_email || "—"}
                  </div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                  <div style={{ fontFamily: "var(--font-mono)", fontWeight: 600 }}>{fmtUSD(r.total)}</div>
                  <button
                    className="cot-secondary-btn"
                    style={{ padding: "6px 10px" }}
                    onClick={(e) => { e.stopPropagation(); descargarDesdeHistorial(r); }}
                  >
                    <Download size={13} /> PDF
                  </button>
                  {(esAdmin || r.creado_por === perfil.id) && (
                    <button
                      className="cot-iconbtn"
                      onClick={(e) => {
                        e.stopPropagation();
                        if (window.confirm(`¿Estás seguro de que deseas eliminar la cotización ${r.numero_cotizacion}?\nEsta acción no se puede deshacer.`)) {
                          eliminarCotizacion(r);
                        }
                      }}
                    >
                      <Trash size={14} />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {view === "usuarios" && esAdmin && (
          <div>
            <div className="cot-card">
              <h2><UserPlus size={16} /> Cuentas del equipo</h2>
              <p style={{ fontSize: 13, color: "var(--ink-soft)", margin: "0 0 4px" }}>
                Cada persona crea su propia cuenta desde "Regístrate" en la pantalla de acceso.
                Aparece aquí como <strong>pendiente</strong> hasta que la actives.
              </p>
            </div>

            {usuariosError && <div className="cot-error-box" style={{ marginBottom: 14 }}>{usuariosError}</div>}
            {usuariosNota && (
              <div className="cot-error-box" style={{ marginBottom: 14, background: "#e6f2ee", borderColor: "#9cc7ba", color: "var(--teal-ink)" }}>
                <CheckCircle2 size={14} style={{ verticalAlign: "-2px", marginRight: 6 }} />{usuariosNota}
              </div>
            )}

            <div className="cot-toolbar">
              <button className="cot-secondary-btn" onClick={cargarUsuarios}><RefreshCw size={15} /> Actualizar lista</button>
            </div>
            {usuariosCargando && <p style={{ color: "var(--ink-soft)" }}>Cargando usuarios…</p>}
            {!usuariosCargando && usuarios.map((u) => (
              <div className="cot-history-item" key={u.id}>
                <div>
                  <strong>{u.nombre ? `${u.nombre} — ${u.email}` : u.email}</strong>
                  <div style={{ fontSize: 12, color: "var(--ink-soft)" }}>
                    {u.rol === "admin" ? "Administrador" : "Usuario"} ·{" "}
                    {u.activo ? "Activo" : "Pendiente de activación / desactivado"}
                  </div>
                </div>
                {u.rol !== "admin" && (
                  <div style={{ display: "flex", gap: 8 }}>
                    {u.activo ? (
                      <button className="cot-secondary-btn" style={{ padding: "6px 10px" }} onClick={() => cambiarEstadoUsuario(u, false)}>
                        <Ban size={13} /> Desactivar
                      </button>
                    ) : (
                      <button className="cot-secondary-btn" style={{ padding: "6px 10px" }} onClick={() => cambiarEstadoUsuario(u, true)}>
                        <UserCheck2 size={13} /> Activar
                      </button>
                    )}
                    <button
                      className="cot-iconbtn"
                      onClick={() => { if (window.confirm(`¿Eliminar la cuenta de ${u.email}? Esta acción no se puede deshacer.`)) eliminarUsuario(u); }}
                    >
                      <Trash size={14} />
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {view === "auditoria" && esAdmin && (
          <div>
            <div className="cot-toolbar">
              <button className="cot-secondary-btn" onClick={cargarAuditoria}><RefreshCw size={15} /> Actualizar</button>
            </div>
            {auditoriaCargando && <p style={{ color: "var(--ink-soft)" }}>Cargando auditoría…</p>}
            {!auditoriaCargando && auditoria.length === 0 && (
              <div className="cot-empty">
                <ShieldCheck size={22} style={{ marginBottom: 8 }} />
                <p>Todavía no hay actividad registrada.</p>
              </div>
            )}
            {auditoria.map((a) => {
              const d = new Date(a.creado_en);
              const fechaHora = `${d.toLocaleDateString("es-DO")} ${d.toLocaleTimeString("es-DO", { hour: "2-digit", minute: "2-digit" })}`;
              return (
                <div className="cot-history-item" key={a.id} style={{ cursor: "default" }}>
                  <div>
                    <strong>{a.usuario_email}</strong>
                    <div style={{ fontSize: 12, color: "var(--ink-soft)" }}>{a.accion}{a.detalle ? ` — ${a.detalle}` : ""}</div>
                  </div>
                  <div style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--ink-soft)" }}>{fechaHora}</div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

