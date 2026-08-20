'use client';

// ============================================================================
// TAREFAS PESSOAIS — lista de tarefas estilo Todoist
// - Estritamente privada: cada colaborador só vê/mexe nas próprias tarefas.
//   Não existe, na tela dele, nenhum indício de que outra pessoa poderia
//   ver essa lista — nada de aviso, nada de seletor, nada.
// - Exceção: ADMIN tem um seletor discreto no topo pra "espiar" a lista de
//   qualquer pessoa (modo supervisão). Mesmo assim, só PODE VER — a regra
//   do banco não deixa nem o admin editar, concluir ou apagar a tarefa de
//   outra pessoa, só a leitura é liberada.
// - A permissão inteira é garantida pelo RLS do Supabase (não por uma rota
//   de backend própria) — é o mesmo padrão usado no resto do sistema, e
//   garante que a regra vale mesmo que alguém tente burlar a tela.
// ============================================================================

import { useEffect, useState, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '../../lib/supabaseClient';

export default function TarefasPessoais() {
  const router = useRouter();

  const [verificandoLogin, setVerificandoLogin] = useState(true);
  const [usuario, setUsuario] = useState(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState('');
  const [aviso, setAviso] = useState('');

  const [tarefas, setTarefas] = useState([]);
  const [novoTitulo, setNovoTitulo] = useState('');
  const [adicionando, setAdicionando] = useState(false);
  const [mostrarConcluidas, setMostrarConcluidas] = useState(false);
  const [editandoId, setEditandoId] = useState(null);
  const [editandoTitulo, setEditandoTitulo] = useState('');
  const [excluindoId, setExcluindoId] = useState(null);

  // Modo supervisão (só existe pra admin)
  const [usuariosHotel, setUsuariosHotel] = useState([]);
  const [usuarioAlvoId, setUsuarioAlvoId] = useState(null);

  const inputRef = useRef(null);
  const souAdmin = usuario?.papel === 'ADMIN';
  const vendoPropriaLista = !usuarioAlvoId || !usuario || Number(usuarioAlvoId) === usuario.id;

  function mostrarAviso(texto) { setAviso(texto); setTimeout(() => setAviso(''), 4000); }

  // ---- Login ----
  useEffect(() => {
    let ativo = true;
    async function verificar() {
      const { data: sessao } = await supabase.auth.getSession();
      if (!sessao?.session) { router.push('/login'); return; }
      const { data: dadosUsuario, error } = await supabase
        .from('usuarios').select('*').eq('auth_id', sessao.session.user.id).single();
      if (error || !dadosUsuario) { router.push('/login'); return; }
      if (!ativo) return;
      setUsuario(dadosUsuario);
      setUsuarioAlvoId(dadosUsuario.id);
      setVerificandoLogin(false);
    }
    verificar();
    return () => { ativo = false; };
  }, [router]);

  const carregarTarefas = useCallback(async (alvoId) => {
    if (!alvoId) return;
    setCarregando(true);
    setErro('');
    const { data, error } = await supabase.from('tarefas_pessoais')
      .select('*').eq('usuario_id', alvoId)
      .order('concluida', { ascending: true }).order('criado_em', { ascending: true });
    if (error) setErro('Não foi possível carregar as tarefas. Detalhe técnico: ' + error.message);
    else setTarefas(data || []);
    setCarregando(false);
  }, []);

  useEffect(() => { if (usuarioAlvoId) carregarTarefas(usuarioAlvoId); }, [usuarioAlvoId, carregarTarefas]);

  // Lista de usuários do hotel — só carregada (e só usada) se for admin.
  useEffect(() => {
    if (!usuario || usuario.papel !== 'ADMIN') return;
    (async () => {
      const { data } = await supabase.from('usuarios').select('id, nome')
        .eq('hotel_id', usuario.hotel_id).order('nome', { ascending: true });
      setUsuariosHotel(data || []);
    })();
  }, [usuario]);

  async function adicionarTarefa(evento) {
    evento.preventDefault();
    if (!novoTitulo.trim() || adicionando || !vendoPropriaLista) return;
    setAdicionando(true);
    const { data, error } = await supabase.from('tarefas_pessoais')
      .insert({ hotel_id: usuario.hotel_id, usuario_id: usuario.id, titulo: novoTitulo.trim() })
      .select().single();
    setAdicionando(false);
    if (error) { setErro('Não foi possível adicionar. Detalhe técnico: ' + error.message); return; }
    setTarefas([...tarefas, data]);
    setNovoTitulo('');
    inputRef.current?.focus();
  }

  async function alternarConcluida(t) {
    if (!vendoPropriaLista) return;
    const novoValor = !t.concluida;
    const agora = new Date().toISOString();
    setTarefas(tarefas.map((x) => (x.id === t.id ? { ...x, concluida: novoValor, concluida_em: novoValor ? agora : null } : x)));
    const { error } = await supabase.from('tarefas_pessoais')
      .update({ concluida: novoValor, concluida_em: novoValor ? agora : null, atualizado_em: agora }).eq('id', t.id);
    if (error) { setErro('Não foi possível atualizar. Detalhe técnico: ' + error.message); carregarTarefas(usuarioAlvoId); }
  }

  function abrirEdicao(t) {
    if (!vendoPropriaLista) return;
    setEditandoId(t.id); setEditandoTitulo(t.titulo);
  }

  async function salvarEdicao(id) {
    if (!editandoTitulo.trim()) { setEditandoId(null); return; }
    const novoTexto = editandoTitulo.trim();
    setEditandoId(null);
    setTarefas(tarefas.map((x) => (x.id === id ? { ...x, titulo: novoTexto } : x)));
    const { error } = await supabase.from('tarefas_pessoais')
      .update({ titulo: novoTexto, atualizado_em: new Date().toISOString() }).eq('id', id);
    if (error) { setErro('Não foi possível salvar. Detalhe técnico: ' + error.message); carregarTarefas(usuarioAlvoId); }
  }

  async function excluirTarefa(id) {
    setExcluindoId(null);
    const restante = tarefas.filter((x) => x.id !== id);
    setTarefas(restante);
    const { error } = await supabase.from('tarefas_pessoais').delete().eq('id', id);
    if (error) { setErro('Não foi possível excluir. Detalhe técnico: ' + error.message); carregarTarefas(usuarioAlvoId); }
  }

  const pendentes = tarefas.filter((t) => !t.concluida);
  const concluidas = tarefas.filter((t) => t.concluida);
  const nomeAlvo = usuariosHotel.find((u) => u.id === Number(usuarioAlvoId))?.nome;

  if (verificandoLogin) {
    return (
      <main className="conteudo">
        <p className="texto-suave">Verificando seu acesso…</p>
      </main>
    );
  }

  return (
    <main className="conteudo tp-conteudo">
      <EstilosTarefas />
      <span className="olho">Bloco de notas</span>
      <h1 style={{ marginBottom: 10 }}>
        {vendoPropriaLista ? 'Minhas Tarefas' : `Tarefas de ${nomeAlvo || 'usuário'}`}
      </h1>

      {souAdmin && (
        <div className="tp-seletor-admin">
          <label className="rotulo" style={{ margin: 0, whiteSpace: 'nowrap' }}>Ver tarefas de</label>
          <select className="campo" value={usuarioAlvoId || ''} onChange={(e) => setUsuarioAlvoId(Number(e.target.value))}>
            {usuariosHotel.map((u) => (
              <option key={u.id} value={u.id}>{u.id === usuario.id ? `${u.nome} (você)` : u.nome}</option>
            ))}
          </select>
        </div>
      )}

      {erro && <div className="aviso-erro">{erro}</div>}
      {aviso && <div className="aviso-sucesso">{aviso}</div>}

      {!vendoPropriaLista && (
        <p className="texto-suave" style={{ fontSize: 13, marginBottom: 10 }}>
          👁️ Modo supervisão — você só consegue ver esta lista, não editar, concluir ou excluir itens dela.
        </p>
      )}

      {vendoPropriaLista && (
        <form onSubmit={adicionarTarefa} className="tp-add-form">
          <input ref={inputRef} className="campo" type="text" value={novoTitulo}
            onChange={(e) => setNovoTitulo(e.target.value)}
            placeholder="+ Adicionar tarefa e apertar Enter…" />
        </form>
      )}

      {carregando ? (
        <p className="texto-suave">Carregando…</p>
      ) : (
        <>
          <p className="texto-suave" style={{ fontSize: 13 }}>
            {pendentes.length === 0 ? 'Nenhuma tarefa pendente 🎉' : `${pendentes.length} pendente${pendentes.length > 1 ? 's' : ''}`}
          </p>

          {pendentes.length === 0 ? (
            <div className="cartao" style={{ textAlign: 'center', color: 'var(--texto-suave)' }}>
              {vendoPropriaLista ? 'Nada por aqui — adicione sua primeira tarefa acima.' : 'Nenhuma tarefa pendente.'}
            </div>
          ) : (
            <div className="tp-lista">
              {pendentes.map((t) => (
                <div key={t.id} className="tp-item">
                  <button type="button" className="tp-checkbox" onClick={() => alternarConcluida(t)}
                    disabled={!vendoPropriaLista} aria-label="Concluir tarefa" />
                  {editandoId === t.id ? (
                    <input className="campo tp-editar-input" type="text" value={editandoTitulo} autoFocus
                      onChange={(e) => setEditandoTitulo(e.target.value)}
                      onBlur={() => salvarEdicao(t.id)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') { e.preventDefault(); salvarEdicao(t.id); }
                        if (e.key === 'Escape') setEditandoId(null);
                      }} />
                  ) : (
                    <span className="tp-titulo" onClick={() => abrirEdicao(t)}>{t.titulo}</span>
                  )}
                  {vendoPropriaLista && editandoId !== t.id && (
                    <div className="tp-acoes">
                      <button type="button" className="tp-icone" onClick={() => abrirEdicao(t)} aria-label="Editar">✏️</button>
                      {excluindoId === t.id ? (
                        <span style={{ display: 'flex', gap: 4 }}>
                          <button type="button" className="tp-icone tp-icone-perigo" onClick={() => excluirTarefa(t.id)}>Sim</button>
                          <button type="button" className="tp-icone" onClick={() => setExcluindoId(null)}>Não</button>
                        </span>
                      ) : (
                        <button type="button" className="tp-icone" onClick={() => setExcluindoId(t.id)} aria-label="Excluir">🗑️</button>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {concluidas.length > 0 && (
            <div style={{ marginTop: 18 }}>
              <button type="button" className="tp-toggle-concluidas" onClick={() => setMostrarConcluidas(!mostrarConcluidas)}>
                {mostrarConcluidas ? '▾' : '▸'} {concluidas.length} concluída{concluidas.length > 1 ? 's' : ''}
              </button>
              {mostrarConcluidas && (
                <div className="tp-lista" style={{ marginTop: 8 }}>
                  {concluidas.map((t) => (
                    <div key={t.id} className="tp-item">
                      <button type="button" className="tp-checkbox tp-checkbox-marcado" onClick={() => alternarConcluida(t)}
                        disabled={!vendoPropriaLista} aria-label="Reabrir tarefa">✓</button>
                      <span className="tp-titulo tp-titulo-concluida">{t.titulo}</span>
                      {vendoPropriaLista && (
                        <div className="tp-acoes">
                          {excluindoId === t.id ? (
                            <span style={{ display: 'flex', gap: 4 }}>
                              <button type="button" className="tp-icone tp-icone-perigo" onClick={() => excluirTarefa(t.id)}>Sim</button>
                              <button type="button" className="tp-icone" onClick={() => setExcluindoId(null)}>Não</button>
                            </span>
                          ) : (
                            <button type="button" className="tp-icone" onClick={() => setExcluindoId(t.id)} aria-label="Excluir">🗑️</button>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </main>
  );
}

// ---- Estilos ----------------------------------------------------------------

function EstilosTarefas() {
  return (
    <style>{`
      .tp-conteudo { max-width: 640px; }

      .tp-seletor-admin {
        display: flex; align-items: center; gap: 10px; margin-bottom: 16px;
        background: #F7F8F6; border-radius: 10px; padding: 10px 14px; width: fit-content;
      }
      .tp-seletor-admin .campo { padding: 6px 10px; font-size: 13px; width: auto; }

      .tp-add-form { margin-bottom: 16px; }

      .tp-lista { display: flex; flex-direction: column; border: 1px solid var(--borda); border-radius: 12px; overflow: hidden; }
      .tp-item {
        display: flex; align-items: center; gap: 12px; padding: 12px 14px;
        border-bottom: 1px solid var(--borda); background: var(--branco);
      }
      .tp-item:last-child { border-bottom: none; }

      .tp-checkbox {
        flex-shrink: 0; width: 22px; height: 22px; border-radius: 50%;
        border: 2px solid var(--borda); background: var(--branco); cursor: pointer;
        display: flex; align-items: center; justify-content: center; font-size: 12px; color: var(--branco);
        padding: 0;
      }
      .tp-checkbox:hover:not(:disabled) { border-color: var(--marca); }
      .tp-checkbox:disabled { cursor: default; opacity: 0.6; }
      .tp-checkbox-marcado { background: var(--marca); border-color: var(--marca); }

      .tp-titulo { flex: 1; font-size: 15px; cursor: pointer; word-break: break-word; }
      .tp-titulo-concluida { text-decoration: line-through; color: var(--texto-suave); }

      .tp-editar-input { flex: 1; padding: 6px 10px; font-size: 15px; }

      .tp-acoes { display: flex; gap: 2px; flex-shrink: 0; }
      .tp-icone {
        border: none; background: none; cursor: pointer; font-size: 14px;
        padding: 6px; border-radius: 6px; line-height: 1;
      }
      .tp-icone:hover { background: #EFEFEF; }
      .tp-icone-perigo { color: var(--erro-texto, #A31212); font-weight: 700; font-size: 12px; }

      .tp-toggle-concluidas {
        border: none; background: none; color: var(--texto-suave); font-size: 13px;
        cursor: pointer; font-family: inherit; padding: 4px 0;
      }
      .tp-toggle-concluidas:hover { color: var(--marca); }
    `}</style>
  );
}
