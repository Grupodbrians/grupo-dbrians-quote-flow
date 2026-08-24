import { createClient } from "@supabase/supabase-js";

const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function obtenerPerfilDelToken(token) {
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data?.user) {
    return { perfil: null, motivo: `getUser falló: ${error ? error.message : "sin usuario"}` };
  }
  const { data: perfil, error: errorPerfil } = await admin
    .from("perfiles")
    .select("*")
    .eq("id", data.user.id)
    .maybeSingle();
  if (errorPerfil) {
    return { perfil: null, motivo: `Consulta a perfiles falló: ${errorPerfil.message}` };
  }
  if (!perfil) {
    return { perfil: null, motivo: `No existe fila en perfiles para el id ${data.user.id} (correo del token: ${data.user.email})` };
  }
  return { perfil, motivo: null };
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Método no permitido" });
    return;
  }
  try {
    // Diagnóstico: confirma que las variables de entorno del servidor
    // existen antes de intentar nada. Mismo problema que tuvimos antes en
    // admin-crear-usuario.js: si SUPABASE_URL/SERVICE_ROLE_KEY apuntan a un
    // proyecto de Supabase distinto al que usa el navegador (VITE_SUPABASE_URL),
    // el servidor nunca reconoce como válida una sesión que sí lo es.
    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
      res.status(500).json({
        error: `Faltan variables de entorno en el servidor. SUPABASE_URL presente: ${!!process.env.SUPABASE_URL}. SUPABASE_SERVICE_ROLE_KEY presente: ${!!process.env.SUPABASE_SERVICE_ROLE_KEY}.`,
      });
      return;
    }
const authorization = req.headers.authorization || "";
const token = authorization.replace(/^Bearer\s+/i, "");

console.log("AUTH DEBUG:", {
  authorizationRecibido: !!authorization,
  tokenRecibido: !!token,
  longitudToken: token.length,
  inicioToken: token ? token.substring(0, 12) : null,
});

    const { perfil, motivo } = await obtenerPerfilDelToken(token);
    if (!perfil || perfil.rol !== "admin" || !perfil.activo) {
      res.status(403).json({
        error: `Solo un administrador activo puede gestionar usuarios. Detalle: ${
          motivo || `rol="${perfil?.rol}" activo=${perfil?.activo}`
        }. Servidor apunta a: ${process.env.SUPABASE_URL}`,
      });
      return;
    }

    const { usuarioId, accion } = req.body || {}; // accion: "desactivar" | "activar" | "eliminar"
    if (!usuarioId || !accion) {
      res.status(400).json({ error: "Falta el usuario o la acción" });
      return;
    }
    if (usuarioId === perfil.id) {
      res.status(400).json({ error: "No puedes desactivar ni eliminar la cuenta de administrador" });
      return;
    }

    const { data: objetivo, error: errorObjetivo } = await admin.from("perfiles").select("*").eq("id", usuarioId).maybeSingle();
    if (errorObjetivo) {
      res.status(500).json({ error: "No se pudo consultar el usuario objetivo: " + errorObjetivo.message });
      return;
    }
    if (!objetivo) {
      res.status(404).json({ error: "Usuario no encontrado" });
      return;
    }
    if (objetivo.rol === "admin") {
      res.status(400).json({ error: "No se puede desactivar ni eliminar a un administrador" });
      return;
    }

    if (accion === "eliminar") {
      const { error: errorAuth } = await admin.auth.admin.deleteUser(usuarioId);
      if (errorAuth) {
        res.status(500).json({ error: "No se pudo eliminar la cuenta de autenticación: " + errorAuth.message });
        return;
      }
      const { error: errorPerfilDel } = await admin.from("perfiles").delete().eq("id", usuarioId);
      if (errorPerfilDel) {
        res.status(500).json({
          error: "La cuenta de autenticación se eliminó, pero no se pudo borrar el perfil: " + errorPerfilDel.message,
        });
        return;
      }
    } else if (accion === "desactivar") {
      const { error: errorUpd } = await admin.from("perfiles").update({ activo: false }).eq("id", usuarioId);
      if (errorUpd) { res.status(500).json({ error: "No se pudo desactivar: " + errorUpd.message }); return; }
    } else if (accion === "activar") {
      const { error: errorUpd } = await admin.from("perfiles").update({ activo: true }).eq("id", usuarioId);
      if (errorUpd) { res.status(500).json({ error: "No se pudo activar: " + errorUpd.message }); return; }
    } else {
      res.status(400).json({ error: "Acción no reconocida" });
      return;
    }

    await admin.from("auditoria").insert({
      usuario_email: perfil.email,
      accion: `usuario_${accion}`,
      detalle: `${accion} la cuenta de ${objetivo.email}`,
    });

    res.status(200).json({ ok: true });
  } catch (e) {
    console.error("Error en admin-gestionar-usuario:", e);
    res.status(500).json({ error: "No se pudo completar la acción: " + (e?.message || String(e)) });
  }
}
