"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "../../lib/supabaseClient";

export default function Login() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [erro, setErro] = useState("");
  const [entrando, setEntrando] = useState(false);

  async function handleLogin(e) {
    e.preventDefault();
    setErro("");
    setEntrando(true);

    // Passo 1: verifica e-mail e senha usando o Authentication do Supabase.
    const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password: senha,
    });

    if (authError) {
      setErro("E-mail ou senha incorretos.");
      setEntrando(false);
      return;
    }

    // Passo 2: busca, na tabela "usuarios", a qual hotel essa pessoa pertence
    // e qual é o papel dela (ADMIN, COLABORADOR, CONTADOR).
    const { data: usuario, error: usuarioError } = await supabase
      .from("usuarios")
      .select("*")
      .eq("auth_id", authData.user.id)
      .single();

    if (usuarioError || !usuario) {
      setErro("Seu login foi validado, mas não encontramos seu cadastro de usuário. Fale com o administrador.");
      await supabase.auth.signOut();
      setEntrando(false);
      return;
    }

    setEntrando(false);
    router.push("/agenda");
  }

  return (
    <main style={{ padding: 40, maxWidth: 400, margin: "0 auto" }}>
      <h1 style={{ color: "#0E7C66" }}>Entrar no sistema</h1>
      <form onSubmit={handleLogin} style={{ background: "#fff", border: "1px solid #E5E7EB", borderRadius: 12, padding: 20 }}>
        <div style={{ marginBottom: 12 }}>
          <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#374151", marginBottom: 4 }}>
            E-mail
          </label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            style={inputStyle}
            required
          />
        </div>
        <div style={{ marginBottom: 16 }}>
          <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#374151", marginBottom: 4 }}>
            Senha
          </label>
          <input
            type="password"
            value={senha}
            onChange={(e) => setSenha(e.target.value)}
            style={inputStyle}
            required
          />
        </div>
        {erro && <p style={{ color: "#B91C1C", fontSize: 13, marginTop: -6, marginBottom: 12 }}>{erro}</p>}
        <button
          type="submit"
          disabled={entrando}
          style={{
            width: "100%",
            padding: "10px 0",
            background: "#0E7C66",
            color: "#fff",
            border: "none",
            borderRadius: 8,
            fontWeight: 600,
            cursor: "pointer",
            opacity: entrando ? 0.6 : 1,
          }}
        >
          {entrando ? "Entrando..." : "Entrar"}
        </button>
      </form>
    </main>
  );
}

const inputStyle = {
  width: "100%",
  padding: "10px 12px",
  border: "1px solid #D1D5DB",
  borderRadius: 6,
  fontSize: 14,
  boxSizing: "border-box",
};
