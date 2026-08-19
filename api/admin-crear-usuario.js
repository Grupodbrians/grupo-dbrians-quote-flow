import { createClient } from "@supabase/supabase-js";

// Cliente con la "service role key": solo existe en el servidor, nunca en el
// navegador. Es la única forma de poder crear/eliminar usuarios de Supabase Auth.
const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function obtenerPerfilDelToken(token) {
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data?.user) return null;
  const { data: perfil } = await admin
    .from("perfiles")
    .select("*")
    .eq("id", data.user.id)
    .single();
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
      res.status(403).json({ error: "Solo un administrador activo puede crear usuarios" });
      return;
    }

    const { email, password } = req.body || {};
    if (!email || !password) {
      res.status(400).json({ error: "Falta el correo o la contraseña" });
      return;
    }
    if (String(password).length < 8) {
      res.status(400).json({ error: "La contraseña debe tener al menos 8 caracteres" });
      return;
    }

    const { data: creado, error: errorCrear } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    if (errorCrear) {
      res.status(400).json({ error: errorCrear.message || "No se pudo crear el usuario" });
      return;
    }

    const { error: errorPerfil } = await admin.from("perfiles").insert({
      id: creado.user.id,
      email,
      rol: "usuario",
      activo: true,
    });
    if (errorPerfil) {
      res.status(500).json({ error: "Usuario creado pero no se pudo guardar el perfil" });
      return;
    }

    await admin.from("auditoria").insert({
      usuario_email: perfil.email,
      accion: "usuario_creado",
      detalle: `Creó la cuenta de ${email}`,
    });

    res.status(200).json({ ok: true });
  } catch (e) {
    console.error("Error en admin-crear-usuario:", e);
    res.status(500).json({ error: "No se pudo crear el usuario" });
  }
}
