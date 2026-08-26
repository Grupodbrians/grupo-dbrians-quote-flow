import { createClient } from "@supabase/supabase-js";

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      return res.status(405).json({
        error: "Método no permitido",
      });
    }

    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );

    const authorization = req.headers.authorization || "";
    const token = authorization.replace(/^Bearer\s+/i, "");

    if (!token) {
      return res.status(401).json({
        error: "No llegó el token de sesión.",
      });
    }

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser(token);

    if (authError || !user) {
      return res.status(403).json({
        error: `Sesión inválida: ${
          authError?.message || "usuario no encontrado"
        }`,
      });
    }

    const { data: perfil, error: perfilError } = await supabase
      .from("perfiles")
      .select("id,email,rol,activo,nombre")
      .eq("email", user.email)
      .maybeSingle();

    if (perfilError) {
      return res.status(500).json({
        error: `Error consultando perfiles: ${perfilError.message}`,
      });
    }

    if (!perfil) {
      return res.status(403).json({
        error: `No existe perfil para ${user.email}.`,
      });
    }

    if (perfil.rol !== "admin" || perfil.activo !== true) {
      return res.status(403).json({
        error: "Solo un administrador activo puede gestionar usuarios.",
      });
    }

    const { usuarioId, accion } = req.body || {};

    if (!usuarioId || !accion) {
      return res.status(400).json({
        error: "Falta usuarioId o accion.",
      });
    }

    if (usuarioId === perfil.id) {
      return res.status(400).json({
        error: "No puedes eliminar ni desactivar tu propia cuenta.",
      });
    }

    const { data: objetivo, error: objetivoError } = await supabase
      .from("perfiles")
      .select("id,email,rol,activo")
      .eq("id", usuarioId)
      .maybeSingle();

    if (objetivoError) {
      return res.status(500).json({
        error: `Error consultando usuario: ${objetivoError.message}`,
      });
    }

    if (!objetivo) {
      return res.status(404).json({
        error: "Usuario no encontrado.",
      });
    }

    if (objetivo.rol === "admin") {
      return res.status(400).json({
        error: "No se puede eliminar ni desactivar un administrador.",
      });
    }

    if (accion === "eliminar") {
      const { error } = await supabase.auth.admin.deleteUser(usuarioId);

      if (error) {
        return res.status(500).json({
          error: `No se pudo eliminar el usuario: ${error.message}`,
        });
      }

      await supabase
        .from("perfiles")
        .delete()
        .eq("id", usuarioId);

    } else if (accion === "desactivar") {
      const { error } = await supabase
        .from("perfiles")
        .update({ activo: false })
        .eq("id", usuarioId);

      if (error) {
        return res.status(500).json({
          error: `No se pudo desactivar: ${error.message}`,
        });
      }

    } else if (accion === "activar") {
      const { error } = await supabase
        .from("perfiles")
        .update({ activo: true })
        .eq("id", usuarioId);

      if (error) {
        return res.status(500).json({
          error: `No se pudo activar: ${error.message}`,
        });
      }

    } else {
      return res.status(400).json({
        error: "Acción no reconocida.",
      });
    }

    await supabase.from("auditoria").insert({
      usuario_email: perfil.email,
      accion: `usuario_${accion}`,
      detalle: `${accion} la cuenta de ${objetivo.email}`,
    });

    return res.status(200).json({
      ok: true,
      mensaje: "Operación realizada correctamente.",
    });

  } catch (error) {
    console.error("admin-gestionar-usuario:", error);

    return res.status(500).json({
      error: `Error interno: ${error?.message || String(error)}`,
    });
  }
}