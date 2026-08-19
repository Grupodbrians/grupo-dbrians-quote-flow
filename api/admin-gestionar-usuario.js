import { createClient } from "@supabase/supabase-js";

const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function obtenerPerfilDelToken(token) {
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data?.user) return null;
  const { data: perfil } = await admin.from("perfiles").select("*").eq("id", data.user.id).single();
  return perfil || null;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Método no permitido" });
    return;
  }
  try {
    const token = (req.headers.authorization || "").replace("Bearer ", "");
    if (!token) {
      res.status(401).json({ error: "Falta la sesión del administrador" });
      return;
    }
    const perfil = await obtenerPerfilDelToken(token);
    if (!perfil || perfil.rol !== "admin" || !perfil.activo) {
      res.status(403).json({ error: "Solo un administrador activo puede gestionar usuarios" });
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

    const { data: objetivo } = await admin.from("perfiles").select("*").eq("id", usuarioId).single();
    if (!objetivo) {
      res.status(404).json({ error: "Usuario no encontrado" });
      return;
    }
    if (objetivo.rol === "admin") {
      res.status(400).json({ error: "No se puede desactivar ni eliminar a un administrador" });
      return;
    }

    if (accion === "eliminar") {
      await admin.auth.admin.deleteUser(usuarioId);
      await admin.from("perfiles").delete().eq("id", usuarioId);
    } else if (accion === "desactivar") {
      await admin.from("perfiles").update({ activo: false }).eq("id", usuarioId);
    } else if (accion === "activar") {
      await admin.from("perfiles").update({ activo: true }).eq("id", usuarioId);
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
    res.status(500).json({ error: "No se pudo completar la acción" });
  }
}
