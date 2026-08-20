import React, { useState } from "react";
import { LogIn, AlertCircle } from "lucide-react";
import { LOGO_DATA_URI } from "./logo.js";
import { supabase } from "./supabaseClient.js";

export default function Login({ mensajeInicial, onRegistrarse }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState(mensajeInicial || "");

  async function enviar(e) {
    e.preventDefault();
    setError("");
    if (!email.trim() || !password) {
      setError("Ingresa tu correo y tu contraseña.");
      return;
    }
    setCargando(true);
    const { error: errorLogin } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    setCargando(false);
    if (errorLogin) {
      setError("Correo o contraseña incorrectos.");
    }
  }

  return (
    <div className="qf-login">
      <style>{`
        .qf-login {
          --ink: #16233a; --brass: #a9782e; --paper: #f1efe6;
          min-height: 100vh; display: flex; flex-direction: column; align-items: center; justify-content: center;
          background: var(--paper); font-family: 'IBM Plex Sans', -apple-system, sans-serif; padding: 20px;
        }
        .qf-login-card {
          background: #fff; border: 1px solid #d9d4c2; border-radius: 12px; padding: 32px;
          max-width: 380px; width: 100%; box-shadow: 0 10px 30px rgba(0,0,0,0.08);
        }
        .qf-login-logo { display: block; height: 60px; margin: 0 auto 22px; }
        .qf-login-card h1 {
          font-family: 'Spectral', Georgia, serif; font-size: 18px; text-align: center; color: var(--ink);
          margin: 0 0 22px;
        }
        .qf-login-field { margin-bottom: 14px; }
        .qf-login-field label {
          display: block; font-size: 11px; text-transform: uppercase; letter-spacing: 0.6px;
          color: #3d5064; margin-bottom: 4px; font-family: 'IBM Plex Mono', monospace;
        }
        .qf-login-field input {
          width: 100%; padding: 10px 12px; border: 1px solid #d9d4c2; border-radius: 6px; font-size: 14px;
        }
        .qf-login-error {
          background: #f6e6e3; border: 1px solid #e2b5ac; color: #a23b2e; border-radius: 8px;
          padding: 10px 12px; font-size: 13px; margin-bottom: 14px; display: flex; gap: 8px; align-items: flex-start;
        }
        .qf-login-btn {
          width: 100%; background: var(--brass); color: #241a08; border: none; padding: 12px; border-radius: 8px;
          font-size: 14px; font-weight: 600; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 8px;
        }
        .qf-login-btn:disabled { opacity: 0.6; cursor: default; }
        .qf-login-footer {
          margin-top: 22px; text-align: center; font-family: 'IBM Plex Mono', monospace; font-size: 11px;
          color: #6b7280; letter-spacing: 0.3px;
        }
      `}</style>
      <div className="qf-login-card">
        <img src={LOGO_DATA_URI} alt="Grupo D'Brians" className="qf-login-logo" />
        <h1>Quote Flow — Acceso</h1>
        {error && (
          <div className="qf-login-error">
            <AlertCircle size={15} style={{ flexShrink: 0, marginTop: 1 }} />
            <span>{error}</span>
          </div>
        )}
        <form onSubmit={enviar}>
          <div className="qf-login-field">
            <label>Correo</label>
            <input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div className="qf-login-field">
            <label>Contraseña</label>
            <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
          </div>
          <button className="qf-login-btn" type="submit" disabled={cargando}>
            <LogIn size={15} /> {cargando ? "Ingresando…" : "Ingresar"}
          </button>
        </form>
        <p style={{ fontSize: 12, color: "#6b7280", textAlign: "center", marginTop: 16 }}>
          ¿No tienes cuenta?{" "}
          <button
            type="button"
            onClick={onRegistrarse}
            style={{ background: "none", border: "none", padding: 0, color: "#a9782e", textDecoration: "underline", cursor: "pointer", font: "inherit" }}
          >
            Regístrate
          </button>
          . Un administrador deberá activarla.
        </p>
      </div>
      <div className="qf-login-footer">Desarrollado por Grupo D'Brians SRL</div>
    </div>
  );
}
