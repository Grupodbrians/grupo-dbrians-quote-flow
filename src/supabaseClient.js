import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  // eslint-disable-next-line no-console
  console.error(
    "Faltan VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY. Revisa las variables de entorno en Vercel (ver README)."
  );
}

export const supabase = createClient(url, anonKey);

// Registra una acción en la tabla de auditoría. Nunca interrumpe el flujo de
// la app si falla — solo lo deja en consola.
export async function registrarAuditoria(usuarioEmail, accion, detalle) {
  try {
    await supabase.from("auditoria").insert({
      usuario_email: usuarioEmail || "desconocido",
      accion,
      detalle: detalle || null,
    });
  } catch (e) {
    console.error("No se pudo registrar auditoría:", e);
  }
}
