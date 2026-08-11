'use client';

// ============================================================================
// AGENDA TELEFÔNICA
// - Exige login (senão manda para /login)
// - Mostra e cadastra contatos apenas do hotel da pessoa logada
// - A segurança de verdade está no banco (RLS); o filtro aqui é reforço
// ============================================================================

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '../../lib/supabaseClient';

// Telefone brasileiro: máscara ao vivo (fixo ou celular) + validação de DDD
function formatarTelefoneBR(texto) {
  const d = String(texto || '').replace(/\D/g, '').slice(0, 11);
  if (d.length <= 2) return d;
  if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
}
function validarTelefoneBR(texto) {
  const d = String(texto || '').replace(/\D/g, '');
  if (d.length !== 10 && d.length !== 11) return false;
  const ddd = Number(d.slice(0, 2));
  return ddd >= 11 && ddd <= 99;
}

export default function AgendaTelefonica() {
  const router = useRouter();

  const [verificandoLogin, setVerificandoLogin] = useState(true);
  const [usuario, setUsuario] = useState(null); // { id, nome, hotel_id, papel }

  const [contatos, setContatos] = useState([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState('');
  const [busca, setBusca] = useState('');

  // Formulário de novo contato
  const [mostrarFormulario, setMostrarFormulario] = useState(false);
  const [nomeCompleto, setNomeCompleto] = useState('');
  const [telefone, setTelefone] = useState('');
  const [email, setEmail] = useState('');
  const [funcao, setFuncao] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [avisoSucesso, setAvisoSucesso] = useState('');

  // Passo 1: confere se a pessoa está logada; se não, vai para o login
  useEffect(() => {
    let ativo = true;
    async function verificar() {
      const { data: sessao } = await supabase.auth.getSession();
      if (!sessao?.session) {
        router.push('/login');
        return;
      }
      const { data: dadosUsuario, error } = await supabase
        .from('usuarios')
        .select('*')
        .eq('auth_id', sessao.session.user.id)
        .single();

      if (error || !dadosUsuario) {
        router.push('/login');
        return;
      }
      if (!ativo) return;
      setUsuario(dadosUsuario);
      setVerificandoLogin(false);
    }
    verificar();
    return () => { ativo = false; };
  }, [router]);

  // Passo 2: com o usuário identificado, busca os contatos do hotel dele
  const carregarContatos = useCallback(async (hotelId) => {
    setCarregando(true);
    setErro('');
    const { data, error } = await supabase
      .from('agenda_telefonica')
      .select('*')
      .eq('hotel_id', hotelId)
      .order('nome_completo', { ascending: true });

    if (error) {
      setErro('Não foi possível carregar os contatos. Detalhe técnico: ' + error.message);
    } else {
      setContatos(data || []);
    }
    setCarregando(false);
  }, []);

  useEffect(() => {
    if (usuario?.hotel_id) carregarContatos(usuario.hotel_id);
  }, [usuario, carregarContatos]);

  // Cadastrar novo contato
  async function salvarContato(evento) {
    evento.preventDefault();
    if (salvando) return;
    setErro('');
    setAvisoSucesso('');

    if (!nomeCompleto.trim() || !telefone.trim()) {
      setErro('Preencha pelo menos o nome e o telefone.');
      return;
    }
    if (!validarTelefoneBR(telefone)) {
      setErro('O telefone precisa ter DDD + número (10 ou 11 dígitos). Ex.: (88) 90000-0000.');
      return;
    }

    setSalvando(true);
    const { error } = await supabase.from('agenda_telefonica').insert({
      nome_completo: nomeCompleto.trim(),
      telefone: telefone.trim(),
      email: email.trim() || null,
      funcao: funcao.trim() || null,
      hotel_id: usuario.hotel_id,
    });
    setSalvando(false);

    if (error) {
      setErro('Não foi possível salvar o contato. Detalhe técnico: ' + error.message);
      return;
    }

    setNomeCompleto('');
    setTelefone('');
    setEmail('');
    setFuncao('');
    setMostrarFormulario(false);
    setAvisoSucesso('Contato salvo com sucesso!');
    setTimeout(() => setAvisoSucesso(''), 4000);
    carregarContatos(usuario.hotel_id);
  }

  // Busca simples (nome, função, telefone ou e-mail)
  const contatosFiltrados = contatos.filter((c) => {
    const texto = busca.trim().toLowerCase();
    if (!texto) return true;
    return (
      (c.nome_completo || '').toLowerCase().includes(texto) ||
      (c.funcao || '').toLowerCase().includes(texto) ||
      (c.telefone || '').toLowerCase().includes(texto) ||
      (c.email || '').toLowerCase().includes(texto)
    );
  });

  if (verificandoLogin) {
    return (
      <main className="conteudo">
        <p className="texto-suave">Verificando seu acesso…</p>
      </main>
    );
  }

  return (
    <main className="conteudo">
      <span className="olho">Contatos do hotel</span>
      <div className="barra-pagina">
        <h1 style={{ margin: 0 }}>Agenda Telefônica</h1>
        <button
          type="button"
          className="botao botao-principal"
          onClick={() => setMostrarFormulario(!mostrarFormulario)}
        >
          {mostrarFormulario ? 'Fechar formulário' : '+ Novo contato'}
        </button>
      </div>

      {avisoSucesso && <div className="aviso-sucesso">{avisoSucesso}</div>}
      {erro && <div className="aviso-erro">{erro}</div>}

      {/* Formulário de cadastro */}
      {mostrarFormulario && (
        <form className="cartao" style={{ marginBottom: 20 }} onSubmit={salvarContato}>
          <h2 style={{ fontSize: '1.2rem', marginBottom: 4 }}>Novo contato</h2>

          <label className="rotulo" htmlFor="contato-nome">Nome completo *</label>
          <input
            id="contato-nome"
            className="campo"
            type="text"
            value={nomeCompleto}
            onChange={(e) => setNomeCompleto(e.target.value)}
            placeholder="Ex.: João da Silva — Gás Central"
          />

          <label className="rotulo" htmlFor="contato-telefone">Telefone *</label>
          <input
            id="contato-telefone"
            className="campo"
            type="tel"
            inputMode="numeric"
            value={telefone}
            onChange={(e) => setTelefone(formatarTelefoneBR(e.target.value))}
            placeholder="(88) 90000-0000"
          />

          <label className="rotulo" htmlFor="contato-email">E-mail</label>
          <input
            id="contato-email"
            className="campo"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="contato@empresa.com.br"
          />

          <label className="rotulo" htmlFor="contato-funcao">Função / Empresa</label>
          <input
            id="contato-funcao"
            className="campo"
            type="text"
            value={funcao}
            onChange={(e) => setFuncao(e.target.value)}
            placeholder="Ex.: Fornecedor de gás"
          />

          <button
            type="submit"
            className="botao botao-principal"
            disabled={salvando}
            style={{ marginTop: 18 }}
          >
            {salvando ? 'Salvando…' : 'Salvar contato'}
          </button>
        </form>
      )}

      {/* Busca */}
      <input
        className="campo"
        type="search"
        value={busca}
        onChange={(e) => setBusca(e.target.value)}
        placeholder="Buscar por nome, função, telefone ou e-mail…"
        aria-label="Buscar contatos"
        style={{ marginBottom: 16 }}
      />

      {/* Lista de contatos */}
      {carregando ? (
        <p className="texto-suave">Carregando contatos…</p>
      ) : contatosFiltrados.length === 0 ? (
        <div className="cartao" style={{ textAlign: 'center', color: 'var(--texto-suave)' }}>
          {busca
            ? 'Nenhum contato encontrado com essa busca.'
            : 'Nenhum contato cadastrado ainda. Use o botão "+ Novo contato" para começar.'}
        </div>
      ) : (
        <div className="grade-contatos">
          {contatosFiltrados.map((c) => (
            <div key={c.id} className="contato-cartao">
              <div className="contato-nome">{c.nome_completo}</div>
              {c.funcao && <span className="contato-funcao">{c.funcao}</span>}
              <div className="contato-linha">
                📞 <a href={`tel:${(c.telefone || '').replace(/[^\d+]/g, '')}`}>{c.telefone}</a>
              </div>
              {c.email && (
                <div className="contato-linha">
                  ✉️ <a href={`mailto:${c.email}`}>{c.email}</a>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </main>
  );
}
