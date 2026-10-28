import React, { useEffect, useState } from "react";
import { KeyRound, AlertCircle, CheckCircle2, ArrowLeft } from "lucide-react";
import { supabase, registrarAuditoria } from "./supabaseClient.js";

// Estilos compartidos por las dos pantallas de recuperación. Mantienen el mismo
// aspecto que Login.jsx / Registro.jsx.
const ESTILOS = `
  .qf-rec {
    --ink: #16233a; --brass: #a9782e; --paper: #f1efe6;
    min-height: 100vh; display: flex; flex-direction: column; align-items: center; justify-content: center;
    background: var(--paper); font-family: 'IBM Plex Sans', -apple-system, sans-serif; padding: 20px;
  }
  .qf-rec-card {
    background: #fff; border: 1px solid #d9d4c2; border-radius: 12px; padding: 32px;
    max-width: 380px; width: 100%; box-shadow: 0 10px 30px rgba(0,0,0,0.08);
  }
  .qf-rec-logo { display: block; width: 64px; height: 64px; margin: 0 auto 18px; }
  .qf-rec-card h1 { font-family: 'Spectral', Georgia, serif; font-size: 18px; text-align: center; color: var(--ink); margin: 0 0 8px; }
  .qf-rec-sub { font-size: 13px; color: #6b7280; text-align: center; margin: 0 0 20px; line-height: 1.45; }
  .qf-rec-field { margin-bottom: 14px; }
  .qf-rec-field label {
    display: block; font-size: 11px; text-transform: uppercase; letter-spacing: 0.6px;
    color: #3d5064; margin-bottom: 4px; font-family: 'IBM Plex Mono', monospace;
  }
  .qf-rec-field input { width: 100%; padding: 10px 12px; border: 1px solid #d9d4c2; border-radius: 6px; font-size: 14px; }
  .qf-rec-error {
    background: #f6e6e3; border: 1px solid #e2b5ac; color: #a23b2e; border-radius: 8px;
    padding: 10px 12px; font-size: 13px; margin-bottom: 14px; display: flex; gap: 8px; align-items: flex-start;
  }
  .qf-rec-ok {
    background: #e6f2ee; border: 1px solid #9cc7ba; color: #1f5f4f; border-radius: 8px;
    padding: 10px 12px; font-size: 13px; margin-bottom: 14px; display: flex; gap: 8px; align-items: flex-start;
  }
  .qf-rec-btn {
    width: 100%; background: var(--brass); color: #241a08; border: none; padding: 12px; border-radius: 8px;
    font-size: 14px; font-weight: 600; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 8px;
  }
  .qf-rec-btn:disabled { opacity: 0.6; cursor: default; }
  .qf-rec-link {
    background: none; border: none; padding: 0; color: #a9782e; text-decoration: underline; cursor: pointer;
    font: inherit; font-size: 12px; display: inline-flex; align-items: center; gap: 4px;
  }
  .qf-rec-footer { margin-top: 22px; text-align: center; font-family: 'IBM Plex Mono', monospace; font-size: 11px; color: #6b7280; letter-spacing: 0.3px; }
`;

function Marco({ titulo, subtitulo, children }) {
  return (
    <div className="qf-rec">
      <style>{ESTILOS}</style>
      <div className="qf-rec-card">
        <img src="/quote-flow-icon.svg" alt="Quote Flow" className="qf-rec-logo" />
        <h1>{titulo}</h1>
        {subtitulo && <p className="qf-rec-sub">{subtitulo}</p>}
        {children}
      </div>
      <div className="qf-rec-footer">Desarrollado por GDB Studio</div>
    </div>
  );
}

// Paso 1: el usuario escribe su correo y Supabase le envía el enlace.
export function SolicitarRecuperacion({ onVolver }) {
  const [email, setEmail] = useState("");
  const [cargando, setCargando] = useState(false);
  const [enviado, setEnviado] = useState(false);
  const [error, setError] = useState("");

  async function enviar(e) {
    e.preventDefault();
    setError("");
    const correo = email.trim();
    if (!correo || !correo.includes("@")) {
      setError("Ingresa el correo con el que te registraste.");
      return;
    }
    setCargando(true);
    const { error: errorEnvio } = await supabase.auth.resetPasswordForEmail(correo, {
      redirectTo: window.location.origin,
    });
    setCargando(false);
    // No se revela si el correo existe o no (evita que alguien averigüe qué
    // cuentas están registradas). Solo se informa de fallos reales de envío.
    if (errorEnvio && /rate|límite|limit|seconds/i.test(errorEnvio.message || "")) {
      setError("Ya se envió un enlace hace poco. Espera un minuto antes de pedir otro.");
      return;
    }
    if (errorEnvio) {
      console.error("Error al pedir recuperación:", errorEnvio);
      setError("No se pudo enviar el correo en este momento. Intenta de nuevo en unos minutos.");
      return;
    }
    setEnviado(true);
  }

  return (
    <Marco
      titulo="Restablecer contraseña"
      subtitulo="Te enviaremos un enlace al correo registrado para que elijas una contraseña nueva."
    >
      {error && (
        <div className="qf-rec-error">
          <AlertCircle size={15} style={{ flexShrink: 0, marginTop: 1 }} />
          <span>{error}</span>
        </div>
      )}
      {enviado ? (
        <div className="qf-rec-ok">
          <CheckCircle2 size={15} style={{ flexShrink: 0, marginTop: 1 }} />
          <span>
            Si el correo está registrado, recibirás un enlace en unos minutos. Revisa también la
            carpeta de spam. El enlace vence pronto y solo sirve una vez.
          </span>
        </div>
      ) : (
        <form onSubmit={enviar}>
          <div className="qf-rec-field">
            <label>Correo</label>
            <input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <button className="qf-rec-btn" type="submit" disabled={cargando}>
            <KeyRound size={15} /> {cargando ? "Enviando…" : "Enviar enlace"}
          </button>
        </form>
      )}
      <p style={{ textAlign: "center", marginTop: 16 }}>
        <button type="button" className="qf-rec-link" onClick={onVolver}>
          <ArrowLeft size={12} /> Volver a ingresar
        </button>
      </p>
    </Marco>
  );
}

// Paso 2: el usuario llegó desde el correo (Supabase ya creó una sesión de
// recuperación) y define su nueva contraseña.
export function NuevaContrasena({ onTerminar, onCancelar }) {
  const [password, setPassword] = useState("");
  const [confirmar, setConfirmar] = useState("");
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState("");
  const [sesionValida, setSesionValida] = useState(null); // null = comprobando

  useEffect(() => {
    let activo = true;
    supabase.auth.getSession().then(({ data }) => {
      if (activo) setSesionValida(!!data.session);
    });
    return () => {
      activo = false;
    };
  }, []);

  async function guardar(e) {
    e.preventDefault();
    setError("");
    if (password.length < 8) {
      setError("La contraseña debe tener al menos 8 caracteres.");
      return;
    }
    if (password !== confirmar) {
      setError("Las contraseñas no coinciden.");
      return;
    }
    setCargando(true);
    const { data: antes } = await supabase.auth.getSession();
    const correo = antes && antes.session ? antes.session.user.email : null;
    const { error: errorUpdate } = await supabase.auth.updateUser({ password });
    if (errorUpdate) {
      setCargando(false);
      const msg = (errorUpdate.message || "").toLowerCase();
      if (msg.includes("different") || msg.includes("same")) {
        setError("La nueva contraseña debe ser distinta de la anterior.");
      } else if (msg.includes("weak") || msg.includes("password")) {
        setError("La contraseña no es lo bastante segura. Usa una más larga o con más variedad.");
      } else {
        setError("No se pudo cambiar la contraseña. Pide un enlace nuevo e inténtalo otra vez.");
      }
      return;
    }
    // Queda constancia en auditoría mientras la sesión de recuperación sigue activa.
    await registrarAuditoria(correo, "contrasena_restablecida", "Restableció su contraseña mediante enlace de correo");
    setCargando(false);
    onTerminar();
  }

  if (sesionValida === null) {
    return (
      <Marco titulo="Nueva contraseña">
        <p className="qf-rec-sub">Verificando el enlace…</p>
      </Marco>
    );
  }

  if (!sesionValida) {
    return (
      <Marco titulo="Enlace no válido">
        <div className="qf-rec-error">
          <AlertCircle size={15} style={{ flexShrink: 0, marginTop: 1 }} />
          <span>El enlace expiró o ya fue usado. Solicita uno nuevo desde la pantalla de acceso.</span>
        </div>
        <button className="qf-rec-btn" type="button" onClick={onCancelar}>
          Volver a ingresar
        </button>
      </Marco>
    );
  }

  return (
    <Marco titulo="Elige tu nueva contraseña" subtitulo="Mínimo 8 caracteres.">
      {error && (
        <div className="qf-rec-error">
          <AlertCircle size={15} style={{ flexShrink: 0, marginTop: 1 }} />
          <span>{error}</span>
        </div>
      )}
      <form onSubmit={guardar}>
        <div className="qf-rec-field">
          <label>Nueva contraseña</label>
          <input type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>
        <div className="qf-rec-field">
          <label>Repite la contraseña</label>
          <input type="password" autoComplete="new-password" value={confirmar} onChange={(e) => setConfirmar(e.target.value)} />
        </div>
        <button className="qf-rec-btn" type="submit" disabled={cargando}>
          <KeyRound size={15} /> {cargando ? "Guardando…" : "Guardar contraseña"}
        </button>
      </form>
    </Marco>
  );
}
