"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "../../lib/supabaseClient";

export default function AgendaTelefonica() {
  const router = useRouter();

  const [verificandoLogin, setVerificandoLogin] = useState(true);
  const [usuario, setUsuario] = useState(null); // { nome, hotel_id, papel }

  const [contatos, setContatos] = useState([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState("");

  const [nomeCompleto, setNomeCompleto] = useState("");
  const [telefone, setTelefone] = useState("");
  const [email, setEmail] = useState("");
  const [funcao, setFuncao] = useState("");
  const [salvando, setSalvando] = useState(false);

  // Passo 1: ao abrir a página, confere se a pessoa está logada. Se não
  // estiver, manda ela direto para a tela de login.
  useEffect(() => {
    async function verificar() {
      const { data: sessao } = await supabase.auth.getSession();
      if (!sessao.session) {
        router.push("/login");
        return;
      }

      const { data: dadosUsuario, error } = await supabase
        .from("usuarios")
        .select("*")
        .eq("auth_id", sessao.session.user.id)
        .single();

      if (error || !dadosUsuario) {
        router.push("/login");
        return;
      }

      setUsuario(dadosUsuario);
      setVerificandoLogin(false);
    }
    verificar();
  }, [router]);

  // Passo 2: só depois de saber quem é o usuário (e de qual hotel), busca os
  // contatos — e só os contatos DAQUELE hotel específico.
  async function carregarContatos(hotelId) {
    setCarregando(true);
    setErro("");
    const { data, error } = await supabase
      .from("agenda_telefonica")
      .select("*")
      .eq("hotel_id", hotelId)
      .order("nome_completo", { ascending: true });

    if (error) {
      setErro("Não foi possível carregar os contatos: " + error.message);
    } else {
      setContatos(data);
    }
    setCarregando(false);
  }

  useEffect(() => {
    if (usuario) {
      carregarContatos(usuario.hotel_id);
    }
  }, [usuario]);

  async function salvarContato(e) {
    e.preventDefault();
    if (!nomeCompleto.trim() || !telefone.trim()) return;

    setSalvando(true);
    setErro("");
    const { error } = await supabase.from("agenda_telefonica").insert({
      nome_completo: nomeCompleto.trim(),
      telefone: telefone.trim(),
      email: email.trim(),
      funcao: funcao.trim(),
      hotel_id: usuario.hotel_id,
    });

    if (error) {
      setErro("Não foi possível salvar: " + error.message);
    } else {
      setNomeCompleto("");
      setTelefone("");
      setEmail("");
      setFuncao("");
      await carregarContatos(usuario.hotel_id);
    }
    setSalvando(false);
  }

  async function sair() {
    await supabase.auth.signOut();
    router.push("/login");
  }

  if (verificandoLogin) {
    return (
      <main style={{ padding: 40, textAlign: "center", color: "#6B7280" }}>
        Verificando login...
      </main>
    );
  }

  return (
    <main style={{ padding: 40, maxWidth: 640, margin: "0 auto" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <div style={{ fontSize: 13, color: "#6B7280" }}>Olá, {usuario.nome}</div>
          <h1 style={{ color: "#111827", margin: "4px 0 0" }}>Agenda Telefônica</h1>
        </div>
        <button
          onClick={sair}
          style={{ padding: "8px 14px", background: "#fff", border: "1px solid #E5E7EB", borderRadius: 8, cursor: "pointer", color: "#6B7280", fontSize: 13 }}
        >
          Sair
        </button>
      </div>

      <form
        onSubmit={salvarContato}
        style={{
          background: "#fff",
          border: "1px solid #E5E7EB",
          borderRadius: 12,
          padding: 20,
          marginTop: 20,
          marginBottom: 24,
        }}
      >
        <h3 style={{ marginTop: 0, fontSize: 15, color: "#111827" }}>Novo contato</h3>
        <Campo label="Nome completo">
          <input style={inputStyle} value={nomeCompleto} onChange={(e) => setNomeCompleto(e.target.value)} />
        </Campo>
        <Campo label="Telefone">
          <input style={inputStyle} value={telefone} onChange={(e) => setTelefone(e.target.value)} />
        </Campo>
        <Campo label="E-mail (opcional)">
          <input style={inputStyle} value={email} onChange={(e) => setEmail(e.target.value)} />
        </Campo>
        <Campo label="O que ele faz (opcional)">
          <input style={inputStyle} value={funcao} onChange={(e) => setFuncao(e.target.value)} />
        </Campo>
        <button
          type="submit"
          disabled={salvando}
          style={{
            padding: "10px 18px",
            background: "#0E7C66",
            color: "#fff",
            border: "none",
            borderRadius: 8,
            fontWeight: 600,
            cursor: "pointer",
            opacity: salvando ? 0.6 : 1,
          }}
        >
          {salvando ? "Salvando..." : "Salvar contato"}
        </button>
      </form>

      {erro && <p style={{ color: "#B91C1C" }}>{erro}</p>}

      {carregando ? (
        <p style={{ color: "#6B7280" }}>Carregando...</p>
      ) : contatos.length === 0 ? (
        <p style={{ color: "#9CA3AF" }}>Nenhum contato cadastrado ainda.</p>
      ) : (
        <div style={{ display: "grid", gap: 10 }}>
          {contatos.map((c) => (
            <div
              key={c.id}
              style={{ background: "#fff", border: "1px solid #E5E7EB", borderRadius: 10, padding: 14 }}
            >
              <div style={{ fontWeight: 700, color: "#111827" }}>{c.nome_completo}</div>
              {c.funcao && <div style={{ fontSize: 12, color: "#0E7C66" }}>{c.funcao}</div>}
              <div style={{ fontSize: 13, color: "#374151", marginTop: 4 }}>{c.telefone}</div>
              {c.email && <div style={{ fontSize: 13, color: "#374151" }}>{c.email}</div>}
            </div>
          ))}
        </div>
      )}
    </main>
  );
}

function Campo({ label, children }) {
  return (
    <div style={{ marginBottom: 10 }}>
      <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#374151", marginBottom: 4 }}>
        {label}
      </label>
      {children}
    </div>
  );
}

const inputStyle = {
  width: "100%",
  padding: "8px 10px",
  border: "1px solid #D1D5DB",
  borderRadius: 6,
  fontSize: 14,
  boxSizing: "border-box",
};
