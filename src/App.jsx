import React, { useEffect, useRef, useState } from "react";
import { supabase, registrarAuditoria } from "./supabaseClient.js";
import Login from "./Login.jsx";
import Registro from "./Registro.jsx";
import Cotizador from "./Cotizador.jsx";
import { SolicitarRecuperacion, NuevaContrasena } from "./RecuperarContrasena.jsx";

// El enlace del correo de recuperación llega con "#...type=recovery" en la URL.
// Se lee ANTES de que supabase-js la procese y la limpie, para no dejar entrar
// al usuario a la app sin que antes elija su nueva contraseña.
const HASH_INICIAL = typeof window !== "undefined" ? window.location.hash : "";
const LLEGA_DE_RECUPERACION = /type=recovery/.test(HASH_INICIAL);
const ENLACE_VENCIDO = /error_code=otp_expired|error=access_denied/.test(HASH_INICIAL);

function limpiarHash() {
  try {
    window.history.replaceState(null, "", window.location.pathname + window.location.search);
  } catch (e) {
    /* sin importancia */
  }
}

export default function App() {
  const [cargando, setCargando] = useState(true);
  const [sesion, setSesion] = useState(null);
  const [perfil, setPerfil] = useState(null);
  const [mensajeLogin, setMensajeLogin] = useState(
    ENLACE_VENCIDO ? "El enlace expiró o ya fue usado. Solicita uno nuevo con «¿Olvidaste tu contraseña?»." : ""
  );
  const [mensajeOk, setMensajeOk] = useState("");
  const [vista, setVista] = useState("login"); // "login" | "registro" | "recuperar"
  const [recuperando, setRecuperando] = useState(LLEGA_DE_RECUPERACION);
  const recuperandoRef = useRef(LLEGA_DE_RECUPERACION);

  async function cargarPerfil(uid) {
    const { data } = await supabase.from("perfiles").select("*").eq("id", uid).maybeSingle();
    return data || null;
  }

  useEffect(() => {
    let activo = true;
    if (ENLACE_VENCIDO) limpiarHash();

    supabase.auth.getSession().then(async ({ data }) => {
      const s = data.session;
      if (!activo) return;
      if (s && !recuperandoRef.current) {
        const p = await cargarPerfil(s.user.id);
        if (!activo) return;
        if (!p || !p.activo) {
          setMensajeLogin(
            !p
              ? "Tu cuenta no tiene un perfil asignado. Contacta al administrador."
              : "Tu cuenta está pendiente de activación (o fue desactivada). Contacta al administrador."
          );
          await supabase.auth.signOut();
        } else {
          setSesion(s);
          setPerfil(p);
        }
      }
      setCargando(false);
    });

    const { data: sub } = supabase.auth.onAuthStateChange(async (evento, s) => {
      // Mientras el usuario está eligiendo su nueva contraseña no se le da
      // acceso a la app aunque Supabase ya le haya creado una sesión temporal.
      if (evento === "PASSWORD_RECOVERY") {
        recuperandoRef.current = true;
        setRecuperando(true);
        setSesion(null);
        setPerfil(null);
        return;
      }
      if (recuperandoRef.current) return;

      if (!s) {
        setSesion(null);
        setPerfil(null);
        return;
      }
      const p = await cargarPerfil(s.user.id);
      if (!p || !p.activo) {
        setMensajeLogin(
          !p
            ? "Tu cuenta no tiene un perfil asignado. Contacta al administrador."
            : "Tu cuenta está pendiente de activación (o fue desactivada). Contacta al administrador."
        );
        await supabase.auth.signOut();
        setSesion(null);
        setPerfil(null);
        return;
      }
      setMensajeLogin("");
      setSesion(s);
      setPerfil(p);
      if (evento === "SIGNED_IN") {
        registrarAuditoria(p.email, "inicio_sesion", "Ingresó a la plataforma");
      }
    });

    return () => {
      activo = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  // Termina el flujo de recuperación: se cierra la sesión temporal y el usuario
  // ingresa con su contraseña nueva (así también pasa por la validación de
  // cuenta activa de siempre).
  async function terminarRecuperacion(conExito = true) {
    await supabase.auth.signOut();
    recuperandoRef.current = false;
    setRecuperando(false);
    setSesion(null);
    setPerfil(null);
    limpiarHash();
    setVista("login");
    setMensajeLogin("");
    setMensajeOk(conExito ? "Contraseña actualizada. Ingresa con tu nueva contraseña." : "");
  }

  if (cargando) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", color: "#3d5064", fontFamily: "sans-serif" }}>
        Cargando…
      </div>
    );
  }

  if (recuperando) {
    return (
      <NuevaContrasena
        onTerminar={() => terminarRecuperacion(true)}
        onCancelar={() => terminarRecuperacion(false)}
      />
    );
  }

  if (!sesion || !perfil) {
    if (vista === "registro") {
      return <Registro onVolver={() => setVista("login")} />;
    }
    if (vista === "recuperar") {
      return <SolicitarRecuperacion onVolver={() => setVista("login")} />;
    }
    return (
      <Login
        mensajeInicial={mensajeLogin}
        mensajeOk={mensajeOk}
        onRegistrarse={() => setVista("registro")}
        onOlvide={() => {
          setMensajeOk("");
          setVista("recuperar");
        }}
      />
    );
  }

  return <Cotizador perfil={perfil} />;
}
