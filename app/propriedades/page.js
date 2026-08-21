'use client';

// ============================================================================
// PROPRIEDADES (Painel de Administrador Geral)
// - Só visível para quem tem o "chapéu extra" super_admin = true
// - Aba "Hotéis": lista todos os hotéis cadastrados, cadastra um hotel novo
//   (com o primeiro administrador dele, convidado por e-mail — reaproveita
//   o mesmo mecanismo seguro de /api/criar-usuario), ativa/desativa hotéis
// - Aba "Usuários de Todos os Hotéis": mesma lógica de /usuarios, mas sem
//   o filtro de hotel — mostra todo mundo, com o nome do hotel de cada um
// ============================================================================

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '../../lib/supabaseClient';
import { bloquearSeNaoPermitido } from '../../lib/restricaoAcesso';

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

// Máscara CPF/CNPJ (hotéis normalmente têm CNPJ, mas aceita CPF também
// para casos de pessoa física/MEI)
function formatarDocumento(texto) {
  const d = String(texto || '').replace(/\D/g, '').slice(0, 14);
  if (d.length <= 11) {
    if (d.length <= 3) return d;
    if (d.length <= 6) return `${d.slice(0, 3)}.${d.slice(3)}`;
    if (d.length <= 9) return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6)}`;
    return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
  }
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
}

// Validação REAL de CPF (dígitos verificadores)
function validarCPF(cpf) {
  const d = String(cpf || '').replace(/\D/g, '');
  if (d.length !== 11) return false;
  if (/^(\d)\1{10}$/.test(d)) return false;
  let soma = 0;
  for (let i = 0; i < 9; i++) soma += Number(d[i]) * (10 - i);
  let dv1 = (soma * 10) % 11;
  if (dv1 === 10) dv1 = 0;
  if (dv1 !== Number(d[9])) return false;
  soma = 0;
  for (let i = 0; i < 10; i++) soma += Number(d[i]) * (11 - i);
  let dv2 = (soma * 10) % 11;
  if (dv2 === 10) dv2 = 0;
  return dv2 === Number(d[10]);
}

// Validação REAL de CNPJ (dígitos verificadores)
function validarCNPJ(cnpj) {
  const d = String(cnpj || '').replace(/\D/g, '');
  if (d.length !== 14) return false;
  if (/^(\d)\1{13}$/.test(d)) return false;
  function calcularDV(base) {
    const tamanho = base.length;
    let pos = tamanho - 7;
    let soma = 0;
    for (let i = tamanho; i >= 1; i--) {
      soma += Number(base.charAt(tamanho - i)) * pos--;
      if (pos < 2) pos = 9;
    }
    const resto = soma % 11;
    return resto < 2 ? 0 : 11 - resto;
  }
  if (calcularDV(d.substring(0, 12)) !== Number(d.charAt(12))) return false;
  return calcularDV(d.substring(0, 13)) === Number(d.charAt(13));
}

function validarDocumento(texto) {
  const d = String(texto || '').replace(/\D/g, '');
  if (d.length === 11) return validarCPF(d);
  if (d.length === 14) return validarCNPJ(d);
  return null;
}

export default function Propriedades() {
  const router = useRouter();

  const [verificandoLogin, setVerificandoLogin] = useState(true);
  const [usuario, setUsuario] = useState(null);

  const [subAba, setSubAba] = useState('hoteis'); // hoteis | usuarios
  const [hoteis, setHoteis] = useState([]);
  const [usuarios, setUsuarios] = useState([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState('');
  const [aviso, setAviso] = useState('');
  const [salvando, setSalvando] = useState(false);

  function mostrarAviso(texto) { setAviso(texto); setTimeout(() => setAviso(''), 5000); }

  // ---- Login: precisa ser super_admin ----
  useEffect(() => {
    let ativo = true;
    async function verificar() {
      const { data: sessao } = await supabase.auth.getSession();
      if (!sessao?.session) { router.push('/login'); return; }
      const { data: dadosUsuario, error } = await supabase
        .from('usuarios').select('*').eq('auth_id', sessao.session.user.id).single();
      if (error || !dadosUsuario) { router.push('/login'); return; }
      if (dadosUsuario.super_admin !== true) { router.push('/'); return; }
      if (!ativo) return;
      setUsuario(dadosUsuario);
      if (bloquearSeNaoPermitido(dadosUsuario.papel, router)) return;
      setVerificandoLogin(false);
    }
    verificar();
    return () => { ativo = false; };
  }, [router]);

  const carregarTudo = useCallback(async () => {
    setCarregando(true);
    setErro('');
    const [h, u] = await Promise.all([
      supabase.from('hoteis').select('*').order('nome_fantasia', { ascending: true }),
      supabase.from('usuarios').select('*').order('nome', { ascending: true }),
    ]);
    if (h.error) setErro('Não foi possível carregar. Detalhe técnico: ' + h.error.message);
    setHoteis(h.data || []);
    setUsuarios(u.data || []);
    setCarregando(false);
  }, []);

  useEffect(() => { if (usuario) carregarTudo(); }, [usuario, carregarTudo]);

  const nomeHotel = useCallback((id) => hoteis.find((h) => h.id === id)?.nome_fantasia || `Hotel #${id}`, [hoteis]);

  if (verificandoLogin) {
    return <main className="conteudo"><p className="texto-suave">Verificando seu acesso…</p></main>;
  }

  return (
    <main className="conteudo">
      <EstilosPropriedades />

      <span className="olho">Administração geral</span>
      <h1 style={{ marginBottom: 6 }}>Propriedades</h1>
      <p className="texto-suave" style={{ fontSize: 13, marginTop: -4 }}>
        Painel visível só para administradores gerais — gerencia todos os hotéis cadastrados no sistema.
      </p>

      {aviso && <div className="aviso-sucesso">{aviso}</div>}
      {erro && <div className="aviso-erro">{erro}</div>}

      <nav className="pr-abas" aria-label="Seções">
        <button type="button" className={subAba === 'hoteis' ? 'pr-aba pr-aba-ativa' : 'pr-aba'} onClick={() => setSubAba('hoteis')}>
          Hotéis <span className="pr-contador">{hoteis.length}</span>
        </button>
        <button type="button" className={subAba === 'usuarios' ? 'pr-aba pr-aba-ativa' : 'pr-aba'} onClick={() => setSubAba('usuarios')}>
          Usuários de Todos os Hotéis <span className="pr-contador">{usuarios.length}</span>
        </button>
      </nav>

      {carregando ? <p className="texto-suave">Carregando…</p> : (
        <>
          {subAba === 'hoteis' && (
            <PainelHoteis hoteis={hoteis} usuario={usuario} salvando={salvando} setSalvando={setSalvando}
              mostrarAviso={mostrarAviso} setErro={setErro} recarregar={carregarTudo} usuariosPorHotel={usuarios} />
          )}
          {subAba === 'usuarios' && (
            <PainelUsuariosGeral usuarios={usuarios} usuario={usuario} nomeHotel={nomeHotel}
              salvando={salvando} setSalvando={setSalvando} mostrarAviso={mostrarAviso} setErro={setErro} recarregar={carregarTudo} />
          )}
        </>
      )}
    </main>
  );
}

// ============================================================================
// ABA HOTÉIS
// ============================================================================

function PainelHoteis({ hoteis, usuario, salvando, setSalvando, mostrarAviso, setErro, recarregar, usuariosPorHotel }) {
  const [mostrarForm, setMostrarForm] = useState(false);
  const [nomeFantasia, setNomeFantasia] = useState('');
  const [razaoSocial, setRazaoSocial] = useState('');
  const [documento, setDocumento] = useState('');
  const [cidade, setCidade] = useState('');
  const [endereco, setEndereco] = useState('');
  const [nomeAdmin, setNomeAdmin] = useState('');
  const [emailAdmin, setEmailAdmin] = useState('');
  const [erroForm, setErroForm] = useState('');
  const [criando, setCriando] = useState(false);

  async function criarHotel(evento) {
    evento.preventDefault();
    if (criando) return;
    setErroForm('');

    if (!nomeFantasia.trim()) { setErroForm('Informe o nome do hotel.'); return; }
    if (!nomeAdmin.trim() || !emailAdmin.trim()) { setErroForm('Informe o nome e o e-mail do primeiro administrador.'); return; }
    if (documento.trim()) {
      const documentoValido = validarDocumento(documento);
      if (documentoValido === null) { setErroForm('O CPF/CNPJ está incompleto — confira os números.'); return; }
      if (documentoValido === false) { setErroForm('O CPF/CNPJ digitado é inválido — confira os números.'); return; }
    }

    setCriando(true);
    const { data: sessao } = await supabase.auth.getSession();
    try {
      const resposta = await fetch('/api/criar-hotel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${sessao.session.access_token}` },
        body: JSON.stringify({
          nomeFantasia: nomeFantasia.trim(), razaoSocial: razaoSocial.trim(), documento: documento.trim(),
          cidade: cidade.trim(), endereco: endereco.trim(), nomeAdmin: nomeAdmin.trim(), emailAdmin: emailAdmin.trim(),
        }),
      });
      const resultado = await resposta.json();
      setCriando(false);

      if (!resposta.ok || resultado.erro) {
        setErroForm(resultado.erro || 'Não foi possível cadastrar o hotel.');
        return;
      }

      setNomeFantasia(''); setRazaoSocial(''); setDocumento(''); setCidade(''); setEndereco(''); setNomeAdmin(''); setEmailAdmin('');
      setMostrarForm(false);
      mostrarAviso(`Hotel "${nomeFantasia.trim()}" cadastrado! Convite enviado para ${emailAdmin.trim()}.`);
      recarregar();
    } catch (e) {
      setCriando(false);
      setErroForm('Falha de conexão com o servidor. Tente novamente.');
    }
  }

  async function alternarAtivo(hotel) {
    setSalvando(true);
    const { error } = await supabase.from('hoteis').update({ ativo: !hotel.ativo }).eq('id', hotel.id);
    setSalvando(false);
    if (error) { setErro('Não foi possível atualizar. Detalhe técnico: ' + error.message); return; }
    mostrarAviso(hotel.ativo ? `${hotel.nome_fantasia} foi desativado.` : `${hotel.nome_fantasia} foi reativado.`);
    recarregar();
  }

  function contarUsuarios(hotelId) {
    return usuariosPorHotel.filter((u) => u.hotel_id === hotelId).length;
  }

  return (
    <section>
      <div className="pr-barra">
        <p className="texto-suave" style={{ fontSize: 13, margin: 0 }}>
          Cada hotel novo já nasce com o primeiro administrador convidado por e-mail.
        </p>
        <button type="button" className="botao botao-principal" onClick={() => { setMostrarForm(!mostrarForm); setErroForm(''); }}>
          {mostrarForm ? 'Fechar' : '+ Novo Hotel'}
        </button>
      </div>

      {mostrarForm && (
        <form className="cartao" style={{ marginBottom: 16 }} onSubmit={criarHotel}>
          <h2 style={{ fontSize: '1.1rem', marginBottom: 4 }}>Novo hotel</h2>

          <label className="rotulo">Nome fantasia *</label>
          <input className="campo" type="text" value={nomeFantasia} onChange={(e) => setNomeFantasia(e.target.value)} placeholder="Ex.: Pousada Vista Mar" />

          <div className="pr-duas">
            <div>
              <label className="rotulo">Razão social</label>
              <input className="campo" type="text" value={razaoSocial} onChange={(e) => setRazaoSocial(e.target.value)} />
            </div>
            <div>
              <label className="rotulo">CNPJ</label>
              <input className="campo" type="text" inputMode="numeric" value={documento}
                onChange={(e) => setDocumento(formatarDocumento(e.target.value))} placeholder="00.000.000/0000-00" />
              {(() => {
                const status = documento.trim() ? validarDocumento(documento) : null;
                if (status === true) return <p className="pr-doc-ok">✓ documento válido</p>;
                if (status === false) return <p className="pr-doc-erro">✗ documento inválido</p>;
                return null;
              })()}
            </div>
          </div>

          <div className="pr-duas">
            <div>
              <label className="rotulo">Cidade</label>
              <input className="campo" type="text" value={cidade} onChange={(e) => setCidade(e.target.value)} />
            </div>
            <div>
              <label className="rotulo">Endereço</label>
              <input className="campo" type="text" value={endereco} onChange={(e) => setEndereco(e.target.value)} />
            </div>
          </div>

          <div className="pr-divisor">Primeiro administrador deste hotel</div>

          <div className="pr-duas">
            <div>
              <label className="rotulo">Nome *</label>
              <input className="campo" type="text" value={nomeAdmin} onChange={(e) => setNomeAdmin(e.target.value)} />
            </div>
            <div>
              <label className="rotulo">E-mail *</label>
              <input className="campo" type="email" value={emailAdmin} onChange={(e) => setEmailAdmin(e.target.value)} placeholder="admin@hotel.com.br" />
            </div>
          </div>

          {erroForm && <div className="aviso-erro">{erroForm}</div>}
          <button type="submit" className="botao botao-principal" disabled={criando} style={{ marginTop: 12 }}>
            {criando ? 'Cadastrando…' : 'Cadastrar hotel e enviar convite'}
          </button>
        </form>
      )}

      {hoteis.length === 0 ? (
        <div className="cartao" style={{ textAlign: 'center', color: 'var(--texto-suave)' }}>Nenhum hotel cadastrado.</div>
      ) : (
        <div className="pr-lista">
          {hoteis.map((h) => (
            <div key={h.id} className="cartao pr-item" style={h.ativo === false ? { opacity: 0.65 } : undefined}>
              <div className="pr-item-esq">
                <div className="pr-item-topo">
                  <strong>{h.nome_fantasia}</strong>
                  <span className="pr-badge" style={h.ativo === false ? { background: '#FBDDDD', color: '#A31212' } : { background: '#DDF2E4', color: '#1E6B3C' }}>
                    {h.ativo === false ? 'Inativo' : 'Ativo'}
                  </span>
                </div>
                <div className="texto-suave" style={{ fontSize: 13 }}>
                  {h.razao_social || '—'} {h.documento ? `· ${h.documento}` : ''}
                </div>
                <div className="texto-suave" style={{ fontSize: 13 }}>
                  {h.cidade || '—'} · {contarUsuarios(h.id)} usuário(s)
                </div>
              </div>
              <div className="pr-item-dir">
                <button type="button" className="botao botao-suave" onClick={() => alternarAtivo(h)} disabled={salvando}>
                  {h.ativo === false ? 'Reativar' : 'Desativar'}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

// ============================================================================
// ABA USUÁRIOS DE TODOS OS HOTÉIS
// ============================================================================

function PainelUsuariosGeral({ usuarios, usuario, nomeHotel, salvando, setSalvando, mostrarAviso, setErro, recarregar }) {
  const [busca, setBusca] = useState('');
  const [filtroHotel, setFiltroHotel] = useState('TODOS');
  const [confirmandoId, setConfirmandoId] = useState(null);

  async function alternarAtivo(pessoa) {
    if (pessoa.id === usuario.id) return;
    setSalvando(true);
    const { error } = await supabase.from('usuarios').update({ ativo: !pessoa.ativo }).eq('id', pessoa.id);
    setSalvando(false);
    setConfirmandoId(null);
    if (error) { setErro('Não foi possível atualizar. Detalhe técnico: ' + error.message); return; }
    mostrarAviso(pessoa.ativo ? `Acesso de ${pessoa.nome} desativado.` : `Acesso de ${pessoa.nome} reativado.`);
    recarregar();
  }

  async function trocarPapel(pessoa, novoPapel) {
    if (novoPapel === pessoa.papel || pessoa.id === usuario.id) return;
    setSalvando(true);
    const { error } = await supabase.from('usuarios').update({ papel: novoPapel }).eq('id', pessoa.id);
    setSalvando(false);
    if (error) { setErro('Não foi possível atualizar o papel. Detalhe técnico: ' + error.message); return; }
    mostrarAviso(`${pessoa.nome} agora é ${PAPEL_LABEL[novoPapel]}.`);
    recarregar();
  }

  const hoteisUnicos = Array.from(new Set(usuarios.map((u) => u.hotel_id)));
  const termo = busca.trim().toLowerCase();
  const filtrados = usuarios
    .filter((u) => filtroHotel === 'TODOS' ? true : String(u.hotel_id) === filtroHotel)
    .filter((u) => !termo || u.nome.toLowerCase().includes(termo) || (u.email || '').toLowerCase().includes(termo));

  return (
    <section>
      <div className="pr-barra">
        <input className="campo" type="search" value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar por nome ou e-mail…" />
        <select className="campo" value={filtroHotel} onChange={(e) => setFiltroHotel(e.target.value)}>
          <option value="TODOS">Todos os hotéis</option>
          {hoteisUnicos.map((id) => <option key={id} value={id}>{nomeHotel(id)}</option>)}
        </select>
      </div>

      {filtrados.length === 0 ? (
        <div className="cartao" style={{ textAlign: 'center', color: 'var(--texto-suave)' }}>Nenhum usuário encontrado.</div>
      ) : (
        <div className="pr-lista">
          {filtrados.map((u) => {
            const souEu = u.id === usuario.id;
            return (
              <div key={u.id} className="cartao pr-item" style={!u.ativo ? { opacity: 0.65 } : undefined}>
                <div className="pr-item-esq">
                  <div className="pr-item-topo">
                    <strong>{u.nome}</strong>
                    {souEu && <span className="pr-badge" style={{ background: '#F0F0F0', color: 'var(--texto-suave)' }}>Você</span>}
                    <span className="pr-badge" style={u.ativo ? { background: '#DDF2E4', color: '#1E6B3C' } : { background: '#FBDDDD', color: '#A31212' }}>
                      {u.ativo ? 'Ativo' : 'Acesso desativado'}
                    </span>
                  </div>
                  <div className="texto-suave" style={{ fontSize: 13 }}>{u.email}</div>
                  <div className="texto-suave" style={{ fontSize: 13 }}>🏨 {nomeHotel(u.hotel_id)}</div>
                </div>
                <div className="pr-item-dir">
                  <select className="campo pr-select-papel" value={u.papel} disabled={salvando || souEu}
                    title={souEu ? 'Você não pode trocar o próprio papel' : undefined}
                    onChange={(e) => trocarPapel(u, e.target.value)}>
                    {Object.entries(PAPEL_LABEL).map(([chave, rotulo]) => <option key={chave} value={chave}>{rotulo}</option>)}
                  </select>
                  {souEu ? (
                    <span className="texto-suave" style={{ fontSize: 12 }}>Você não pode desativar a própria conta.</span>
                  ) : confirmandoId === u.id ? (
                    <span className="pr-confirmar">
                      {u.ativo ? 'Desativar?' : 'Reativar?'}
                      <button type="button" className={u.ativo ? 'botao botao-perigo' : 'botao botao-principal'} onClick={() => alternarAtivo(u)} disabled={salvando}>Sim</button>
                      <button type="button" className="botao botao-suave" onClick={() => setConfirmandoId(null)}>Não</button>
                    </span>
                  ) : (
                    <button type="button" className={u.ativo ? 'botao botao-perigo' : 'botao botao-principal'} onClick={() => setConfirmandoId(u.id)} disabled={salvando}>
                      {u.ativo ? 'Desativar acesso' : 'Reativar acesso'}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

function EstilosPropriedades() {
  return (
    <style>{`
      .pr-abas { display: flex; gap: 6px; overflow-x: auto; margin: 14px 0 16px; padding-bottom: 4px; }
      .pr-aba {
        border: 1px solid var(--borda); background: var(--branco); color: var(--tinta);
        border-radius: 999px; padding: 10px 16px; font-size: 14px; font-weight: 600;
        cursor: pointer; white-space: nowrap; min-height: 42px;
      }
      .pr-aba-ativa { background: var(--marca); border-color: var(--marca); color: var(--branco); }
      .pr-contador { display: inline-block; margin-left: 6px; font-size: 12px; background: rgba(0,0,0,0.10); border-radius: 999px; padding: 1px 8px; }
      .pr-aba-ativa .pr-contador { background: rgba(255,255,255,0.22); }

      .pr-barra { display: flex; flex-direction: column; gap: 10px; margin-bottom: 14px; }
      .pr-duas { display: grid; grid-template-columns: 1fr; gap: 0 14px; }
      .pr-divisor { font-size: 13px; font-weight: 700; color: var(--texto-suave); margin: 14px 0 6px; border-top: 1px solid var(--borda); padding-top: 12px; }
      .pr-doc-ok { color: var(--sucesso-texto); font-weight: 700; font-size: 13px; margin: 6px 0 0; }
      .pr-doc-erro { color: var(--erro-texto); font-weight: 700; font-size: 13px; margin: 6px 0 0; }

      .pr-lista { display: flex; flex-direction: column; gap: 12px; }
      .pr-item { display: flex; flex-direction: column; gap: 10px; padding: 16px; }
      .pr-item-topo { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
      .pr-item-topo strong { font-size: 16px; }
      .pr-badge { display: inline-block; font-size: 12px; font-weight: 700; border-radius: 999px; padding: 3px 10px; }
      .pr-item-dir { display: flex; flex-direction: column; gap: 8px; align-items: flex-start; }
      .pr-select-papel { width: auto; min-width: 220px; }
      .pr-confirmar { display: inline-flex; align-items: center; gap: 8px; font-size: 13px; font-weight: 600; color: var(--erro-texto); flex-wrap: wrap; }

      @media (min-width: 640px) {
        .pr-barra { flex-direction: row; align-items: center; }
        .pr-barra .campo { flex: 1; }
        .pr-duas { grid-template-columns: 1fr 1fr; }
        .pr-item { flex-direction: row; justify-content: space-between; align-items: center; }
        .pr-item-dir { align-items: flex-end; }
      }
    `}</style>
  );
}
