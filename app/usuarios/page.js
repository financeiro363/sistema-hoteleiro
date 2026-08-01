'use client';

// ============================================================================
// CONTROLE DE ACESSO DE USUÁRIOS
// - Só ADMIN acessa
// - Lista todos os usuários do hotel: nome, e-mail, papel, status
// - Alternar Ativo / Acesso desativado (bloqueia login sem apagar a conta)
// - Trocar o papel (ADMIN / COLABORADOR / CONTADOR) direto na tela — não
//   precisa mais editar no Supabase para isso
// - O admin NÃO consegue desativar a própria conta (trava na tela E no banco)
// - Criar uma conta NOVA (usuário que ainda não existe) continua exigindo um
//   passo manual no Supabase (Authentication → Add user), porque isso exige
//   uma chave de administrador que não pode ficar exposta no site — está
//   documentado no LEIA-ME.
// ============================================================================

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '../../lib/supabaseClient';

const PAPEL_LABEL = {
  ADMIN: 'Administrador', COLABORADOR: 'Colaborador', CONTADOR: 'Contador (só vê Contabilidade)',
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

  function mostrarAviso(texto) { setAviso(texto); setTimeout(() => setAviso(''), 5000); }

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
    setSalvandoId(pessoa.id);
    const { error } = await supabase.from('usuarios').update({ papel: novoPapel }).eq('id', pessoa.id);
    setSalvandoId(null);
    if (error) { setErro('Não foi possível atualizar o papel. Detalhe técnico: ' + error.message); return; }
    mostrarAviso(`${pessoa.nome} agora é ${PAPEL_LABEL[novoPapel]}.`);
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

      <div className="aviso-erro" style={{ background: 'var(--marca-clara)', color: 'var(--marca)', fontSize: 13 }}>
        Para criar uma conta NOVA (pessoa que ainda não tem login), é preciso um passo manual no
        Supabase (Authentication → Add user) — veja o LEIA-ME. Aqui você só ativa/desativa acesso e
        troca o papel de quem já existe.
      </div>

      <input className="campo" type="search" value={busca} onChange={(e) => setBusca(e.target.value)}
        placeholder="Buscar por nome ou e-mail…" style={{ margin: '14px 0' }} />

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
                  <select className="campo us-select-papel" value={u.papel} disabled={salvandoId === u.id}
                    onChange={(e) => trocarPapel(u, e.target.value)}>
                    {Object.entries(PAPEL_LABEL).map(([chave, rotulo]) => <option key={chave} value={chave}>{rotulo}</option>)}
                  </select>
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
      .us-item { display: flex; flex-direction: column; gap: 10px; padding: 16px; }
      .us-item-topo { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
      .us-item-topo strong { font-size: 16px; }
      .us-badge { display: inline-block; font-size: 12px; font-weight: 700; border-radius: 999px; padding: 3px 10px; }
      .us-item-dir { display: flex; flex-direction: column; gap: 8px; align-items: flex-start; }
      .us-select-papel { width: auto; min-width: 220px; }
      .us-confirmar { display: inline-flex; align-items: center; gap: 8px; font-size: 13px; font-weight: 600; color: var(--erro-texto); flex-wrap: wrap; }

      @media (min-width: 640px) {
        .us-item { flex-direction: row; justify-content: space-between; align-items: center; }
        .us-item-dir { align-items: flex-end; }
      }
    `}</style>
  );
}
