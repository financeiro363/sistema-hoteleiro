'use client';

// ============================================================================
// CONTROLE DE ACESSO DE USUÁRIOS
// - Só ADMIN acessa
// - Lista todos os usuários do hotel: nome, e-mail, papel, status
// - Alternar Ativo / Acesso desativado (bloqueia login sem apagar a conta)
// - Trocar o papel (ADMIN / COLABORADOR / CONTADOR) direto na tela — não
//   precisa mais editar no Supabase para isso
// - O admin NÃO consegue desativar a própria conta (trava na tela E no banco)
// - Criar uma conta NOVA agora é feito direto aqui: preenche nome, e-mail e
//   papel, e o sistema convida a pessoa por e-mail (ela escolhe a própria
//   senha, o admin nunca vê/define a senha dela). Por trás dos panos, isso
//   chama uma rota de servidor (/api/criar-usuario) que usa a chave mestra
//   do Supabase — essa chave nunca fica exposta no navegador.
// ============================================================================

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '../../lib/supabaseClient';
import { bloquearSeNaoPermitido } from '../../lib/restricaoAcesso';

const PAPEL_LABEL = {
  ADMIN: 'Administrador', COLABORADOR: 'Colaborador', CONTADOR: 'Contador (só vê Contabilidade)',
  MANUTENCAO: 'Manutenção (só Minhas Tarefas + Manutenção)', CAMAREIRA: 'Camareira (só Minhas Tarefas + Governança)',
};

function formatarDataHora(valor) {
  if (!valor) return '—';
  try {
    return new Date(valor).toLocaleString('pt-BR', {
      day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
    });
  } catch (e) { return String(valor); }
}

export default function ControleUsuarios() {
  const router = useRouter();

  const [verificandoLogin, setVerificandoLogin] = useState(true);
  const [usuario, setUsuario] = useState(null);
  const [usuarios, setUsuarios] = useState([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState('');
  const [aviso, setAviso] = useState('');
  const [salvandoId, setSalvandoId] = useState(null);

  const [busca, setBusca] = useState('');
  const [confirmandoId, setConfirmandoId] = useState(null); // confirmação de desativar

  // Novo usuário
  const [mostrarFormNovo, setMostrarFormNovo] = useState(false);
  const [novoNome, setNovoNome] = useState('');
  const [novoEmail, setNovoEmail] = useState('');
  const [novoPapel, setNovoPapel] = useState('COLABORADOR');
  const [criandoUsuario, setCriandoUsuario] = useState(false);
  const [erroNovoUsuario, setErroNovoUsuario] = useState('');

  function mostrarAviso(texto) { setAviso(texto); setTimeout(() => setAviso(''), 5000); }

  async function criarUsuario(evento) {
    evento.preventDefault();
    if (criandoUsuario) return;
    setErroNovoUsuario('');

    if (!novoNome.trim()) { setErroNovoUsuario('Informe o nome.'); return; }
    if (!novoEmail.trim()) { setErroNovoUsuario('Informe o e-mail.'); return; }

    setCriandoUsuario(true);
    const { data: sessao } = await supabase.auth.getSession();
    try {
      const resposta = await fetch('/api/criar-usuario', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${sessao.session.access_token}`,
        },
        body: JSON.stringify({ nome: novoNome.trim(), email: novoEmail.trim(), papel: novoPapel }),
      });
      const resultado = await resposta.json();
      setCriandoUsuario(false);

      if (!resposta.ok || resultado.erro) {
        setErroNovoUsuario(resultado.erro || 'Não foi possível criar o usuário.');
        return;
      }

      setNovoNome(''); setNovoEmail(''); setNovoPapel('COLABORADOR');
      setMostrarFormNovo(false);
      mostrarAviso(`Convite enviado para ${novoEmail.trim()}! A pessoa vai receber um e-mail para escolher a própria senha.`);
      carregarTudo(usuario);
    } catch (e) {
      setCriandoUsuario(false);
      setErroNovoUsuario('Falha de conexão com o servidor. Tente novamente.');
    }
  }

  useEffect(() => {
    let ativo = true;
    async function verificar() {
      const { data: sessao } = await supabase.auth.getSession();
      if (!sessao?.session) { router.push('/login'); return; }
      const { data: dadosUsuario, error } = await supabase
        .from('usuarios').select('*').eq('auth_id', sessao.session.user.id).single();
      if (error || !dadosUsuario) { router.push('/login'); return; }
      if (dadosUsuario.papel !== 'ADMIN') { router.push('/'); return; }
      if (!ativo) return;
      setUsuario(dadosUsuario);
      if (bloquearSeNaoPermitido(dadosUsuario.papel, router)) return;
      setVerificandoLogin(false);
    }
    verificar();
    return () => { ativo = false; };
  }, [router]);

  const carregarTudo = useCallback(async (u) => {
    setCarregando(true);
    setErro('');
    const { data, error } = await supabase
      .from('usuarios').select('*').eq('hotel_id', u.hotel_id).order('nome', { ascending: true });
    if (error) setErro('Não foi possível carregar. Detalhe técnico: ' + error.message);
    setUsuarios(data || []);
    setCarregando(false);
  }, []);

  useEffect(() => { if (usuario) carregarTudo(usuario); }, [usuario, carregarTudo]);

  async function alternarAtivo(pessoa) {
    if (pessoa.id === usuario.id) return; // trava extra, já escondida na UI
    setSalvandoId(pessoa.id);
    const { error } = await supabase.from('usuarios').update({ ativo: !pessoa.ativo }).eq('id', pessoa.id);
    setSalvandoId(null);
    setConfirmandoId(null);
    if (error) { setErro('Não foi possível atualizar. Detalhe técnico: ' + error.message); return; }
    mostrarAviso(pessoa.ativo ? `Acesso de ${pessoa.nome} desativado.` : `Acesso de ${pessoa.nome} reativado.`);
    carregarTudo(usuario);
  }

  async function trocarPapel(pessoa, novoPapel) {
    if (novoPapel === pessoa.papel) return;
    if (pessoa.id === usuario.id) {
      setErro('Você não pode trocar o seu próprio papel — peça para outro administrador fazer isso, se for realmente necessário.');
      return;
    }
    setSalvandoId(pessoa.id);
    const { error } = await supabase.from('usuarios').update({ papel: novoPapel }).eq('id', pessoa.id);
    setSalvandoId(null);
    if (error) { setErro('Não foi possível atualizar o papel. Detalhe técnico: ' + error.message); return; }
    mostrarAviso(`${pessoa.nome} agora é ${PAPEL_LABEL[novoPapel]}.`);
    carregarTudo(usuario);
  }

  async function alternarPermissaoAtestado(pessoa) {
    setSalvandoId(pessoa.id);
    const { error } = await supabase.from('usuarios').update({ pode_incluir_atestado: !pessoa.pode_incluir_atestado }).eq('id', pessoa.id);
    setSalvandoId(null);
    if (error) { setErro('Não foi possível atualizar. Detalhe técnico: ' + error.message); return; }
    mostrarAviso(pessoa.pode_incluir_atestado
      ? `${pessoa.nome} não pode mais registrar atestados.`
      : `${pessoa.nome} agora pode registrar atestados médicos/odontológicos.`);
    carregarTudo(usuario);
  }

  const termo = busca.trim().toLowerCase();
  const filtrados = usuarios.filter((u) =>
    !termo || u.nome.toLowerCase().includes(termo) || (u.email || '').toLowerCase().includes(termo)
  );

  if (verificandoLogin) {
    return <main className="conteudo"><p className="texto-suave">Verificando seu acesso…</p></main>;
  }

  return (
    <main className="conteudo">
      <EstilosUsuarios />

      <span className="olho">Segurança do sistema</span>
      <h1 style={{ marginBottom: 6 }}>Controle de Acesso de Usuários</h1>
      <p className="texto-suave" style={{ fontSize: 13, marginTop: -4 }}>
        Módulo visível só para administradores.
      </p>

      {aviso && <div className="aviso-sucesso">{aviso}</div>}
      {erro && <div className="aviso-erro">{erro}</div>}

      <div className="us-barra">
        <input className="campo" type="search" value={busca} onChange={(e) => setBusca(e.target.value)}
          placeholder="Buscar por nome ou e-mail…" />
        <button type="button" className="botao botao-principal" onClick={() => { setMostrarFormNovo(!mostrarFormNovo); setErroNovoUsuario(''); }}>
          {mostrarFormNovo ? 'Fechar' : '+ Novo Usuário'}
        </button>
      </div>

      {mostrarFormNovo && (
        <form className="cartao" style={{ marginBottom: 16 }} onSubmit={criarUsuario}>
          <h2 style={{ fontSize: '1.1rem', marginBottom: 4 }}>Novo usuário</h2>
          <p className="texto-suave" style={{ fontSize: 13 }}>
            A pessoa recebe um e-mail de convite e escolhe a própria senha — você não define a
            senha dela, e ela nunca fica visível para ninguém.
          </p>
          <label className="rotulo">Nome completo *</label>
          <input className="campo" type="text" value={novoNome} onChange={(e) => setNovoNome(e.target.value)} />
          <label className="rotulo">E-mail *</label>
          <input className="campo" type="email" value={novoEmail} onChange={(e) => setNovoEmail(e.target.value)} placeholder="pessoa@seuhotel.com.br" />
          <label className="rotulo">Papel</label>
          <select className="campo" value={novoPapel} onChange={(e) => setNovoPapel(e.target.value)}>
            {Object.entries(PAPEL_LABEL).map(([chave, rotulo]) => <option key={chave} value={chave}>{rotulo}</option>)}
          </select>
          {erroNovoUsuario && <div className="aviso-erro">{erroNovoUsuario}</div>}
          <button type="submit" className="botao botao-principal" disabled={criandoUsuario} style={{ marginTop: 12 }}>
            {criandoUsuario ? 'Enviando convite…' : 'Enviar convite'}
          </button>
        </form>
      )}

      {carregando ? <p className="texto-suave">Carregando…</p> : filtrados.length === 0 ? (
        <div className="cartao" style={{ textAlign: 'center', color: 'var(--texto-suave)' }}>Nenhum usuário encontrado.</div>
      ) : (
        <div className="us-lista">
          {filtrados.map((u) => {
            const souEu = u.id === usuario.id;
            return (
              <div key={u.id} className="cartao us-item" style={!u.ativo ? { opacity: 0.65 } : undefined}>
                <div className="us-item-esq">
                  <div className="us-item-topo">
                    <strong>{u.nome}</strong>
                    {souEu && <span className="us-badge" style={{ background: '#F0F0F0', color: 'var(--texto-suave)' }}>Você</span>}
                    <span className="us-badge" style={u.ativo ? { background: '#DDF2E4', color: '#1E6B3C' } : { background: '#FBDDDD', color: '#A31212' }}>
                      {u.ativo ? 'Ativo' : 'Acesso desativado'}
                    </span>
                  </div>
                  <div className="texto-suave" style={{ fontSize: 13 }}>{u.email}</div>
                </div>
                <div className="us-item-dir">
                  <select className="campo us-select-papel" value={u.papel} disabled={salvandoId === u.id || souEu}
                    title={souEu ? 'Você não pode trocar o próprio papel' : undefined}
                    onChange={(e) => trocarPapel(u, e.target.value)}>
                    {Object.entries(PAPEL_LABEL).map(([chave, rotulo]) => <option key={chave} value={chave}>{rotulo}</option>)}
                  </select>
                  {u.papel !== 'ADMIN' && (
                    <label className="us-checkbox-atestado">
                      <input type="checkbox" checked={!!u.pode_incluir_atestado} disabled={salvandoId === u.id}
                        onChange={() => alternarPermissaoAtestado(u)} />
                      Pode registrar atestados médicos/odontológicos
                    </label>
                  )}
                  {souEu ? (
                    <span className="texto-suave" style={{ fontSize: 12 }}>Você não pode desativar a própria conta.</span>
                  ) : confirmandoId === u.id ? (
                    <span className="us-confirmar">
                      {u.ativo ? 'Desativar acesso?' : 'Reativar acesso?'}
                      <button type="button" className={u.ativo ? 'botao botao-perigo' : 'botao botao-principal'} onClick={() => alternarAtivo(u)} disabled={salvandoId === u.id}>Sim</button>
                      <button type="button" className="botao botao-suave" onClick={() => setConfirmandoId(null)}>Não</button>
                    </span>
                  ) : (
                    <button type="button" className={u.ativo ? 'botao botao-perigo' : 'botao botao-principal'}
                      onClick={() => setConfirmandoId(u.id)} disabled={salvandoId === u.id}>
                      {u.ativo ? 'Desativar acesso' : 'Reativar acesso'}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </main>
  );
}

function EstilosUsuarios() {
  return (
    <style>{`
      .us-lista { display: flex; flex-direction: column; gap: 12px; }
      .us-barra { display: flex; flex-direction: column; gap: 10px; margin: 14px 0; }
      .us-item { display: flex; flex-direction: column; gap: 10px; padding: 16px; }
      .us-item-topo { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
      .us-item-topo strong { font-size: 16px; }
      .us-badge { display: inline-block; font-size: 12px; font-weight: 700; border-radius: 999px; padding: 3px 10px; }
      .us-item-dir { display: flex; flex-direction: column; gap: 8px; align-items: flex-start; }
      .us-select-papel { width: auto; min-width: 220px; }
      .us-checkbox-atestado { display: flex; align-items: center; gap: 8px; font-size: 13px; cursor: pointer; max-width: 240px; }
      .us-checkbox-atestado input { width: 18px; height: 18px; flex-shrink: 0; }
      .us-confirmar { display: inline-flex; align-items: center; gap: 8px; font-size: 13px; font-weight: 600; color: var(--erro-texto); flex-wrap: wrap; }

      @media (min-width: 640px) {
        .us-barra { flex-direction: row; align-items: center; }
        .us-barra .campo { flex: 1; }
        .us-item { flex-direction: row; justify-content: space-between; align-items: center; }
        .us-item-dir { align-items: flex-end; }
      }
    `}</style>
  );
}
