import React, { useEffect, useState } from "react";
import { supabase, registrarAuditoria } from "./supabaseClient.js";
import Login from "./Login.jsx";
import Registro from "./Registro.jsx";
import Cotizador from "./Cotizador.jsx";

export default function App() {
  const [cargando, setCargando] = useState(true);
  const [sesion, setSesion] = useState(null);
  const [perfil, setPerfil] = useState(null);
  const [mensajeLogin, setMensajeLogin] = useState("");
  const [vista, setVista] = useState("login"); // "login" | "registro"

  async function cargarPerfil(uid) {
    const { data } = await supabase.from("perfiles").select("*").eq("id", uid).maybeSingle();
    return data || null;
  }

  useEffect(() => {
    let activo = true;

    supabase.auth.getSession().then(async ({ data }) => {
      const s = data.session;
      if (!activo) return;
      if (s) {
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

  if (cargando) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", color: "#3d5064", fontFamily: "sans-serif" }}>
        Cargando…
      </div>
    );
  }

  if (!sesion || !perfil) {
    if (vista === "registro") {
      return <Registro onVolver={() => setVista("login")} />;
    }
    return <Login mensajeInicial={mensajeLogin} onRegistrarse={() => setVista("registro")} />;
  }

  return <Cotizador perfil={perfil} />;
}
