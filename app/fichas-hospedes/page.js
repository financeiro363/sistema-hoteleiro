'use client';

// ============================================================================
// FICHAS DE HÓSPEDES (FNRH) + INTEGRAÇÃO CLOUDBEDS — painel do hotel
// Qualquer pessoa da equipe (ADMIN, COLABORADOR ou CONTADOR) acessa a aba
// "Fichas Recebidas", para poder alimentar a Cloudbeds no dia a dia. Já a
// aba "Configurar Cloudbeds" (a chave da API) e o "Log de Auditoria"
// continuam só para ADMIN — são ações mais sensíveis.
// ============================================================================

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '../../lib/supabaseClient';

function formatarData(valor) {
  if (!valor) return '—';
  const [ano, mes, dia] = String(valor).slice(0, 10).split('-');
  return `${dia}/${mes}/${ano}`;
}
function formatarDataHora(valor) {
  if (!valor) return '—';
  try {
    return new Date(valor).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  } catch (e) { return String(valor); }
}

const MOTIVO_LABEL = { LAZER: 'Lazer', NEGOCIOS: 'Negócios', EVENTOS: 'Eventos', PARENTES: 'Visita a parentes', SAUDE: 'Saúde', OUTRO: 'Outro' };

export default function FichasHospedes() {
  const router = useRouter();
  const [verificandoLogin, setVerificandoLogin] = useState(true);
  const [usuario, setUsuario] = useState(null);
  const [nomeHotel, setNomeHotel] = useState('');
  const [subAba, setSubAba] = useState('fichas');

  useEffect(() => {
    let ativo = true;
    async function verificar() {
      const { data: sessao } = await supabase.auth.getSession();
      if (!sessao?.session) { router.push('/login'); return; }
      const { data: dadosUsuario, error } = await supabase
        .from('usuarios').select('*').eq('auth_id', sessao.session.user.id).single();
      if (error || !dadosUsuario) { router.push('/login'); return; }
      // Qualquer papel pode entrar aqui — só as ações mais sensíveis
      // dentro da tela (configurar Cloudbeds, ver o log) ficam travadas
      // para ADMIN, mais abaixo.
      if (!ativo) return;
      setUsuario(dadosUsuario);
      setVerificandoLogin(false);

      const { data: hotel } = await supabase.from('hoteis').select('nome_fantasia').eq('id', dadosUsuario.hotel_id).single();
      if (ativo && hotel?.nome_fantasia) setNomeHotel(hotel.nome_fantasia);
    }
    verificar();
    return () => { ativo = false; };
  }, [router]);

  if (verificandoLogin) {
    return <main className="conteudo"><p className="texto-suave">Verificando seu acesso…</p></main>;
  }

  const souAdmin = usuario.papel === 'ADMIN';

  return (
    <main className="conteudo">
      <EstilosFichasAdmin />
      <span className="olho">Hóspedes</span>
      <h1 style={{ marginBottom: 6 }}>Fichas de Hóspedes (FNRH)</h1>
      <p className="texto-suave" style={{ fontSize: 13, marginTop: -4 }}>Visualize, vincule e exporte para a Cloudbeds.</p>

      <div className="cartao" style={{ background: 'var(--marca-clara)', marginTop: 14, marginBottom: 4 }}>
        <p style={{ fontSize: 13, margin: 0 }}>
          📋 Link público para o hóspede preencher a ficha antes da chegada:<br />
          <code style={{ fontSize: 12, wordBreak: 'break-all' }}>
            {typeof window !== 'undefined' ? window.location.origin : ''}/ficha-hospede?hotel_id={usuario.hotel_id}
          </code>
        </p>
      </div>

      <nav className="fh-abas" aria-label="Seções">
        <button type="button" className={subAba === 'fichas' ? 'fh-aba fh-aba-ativa' : 'fh-aba'} onClick={() => setSubAba('fichas')}>Fichas Recebidas</button>
        {souAdmin && (
          <button type="button" className={subAba === 'config' ? 'fh-aba fh-aba-ativa' : 'fh-aba'} onClick={() => setSubAba('config')}>Configurar Cloudbeds</button>
        )}
        {souAdmin && (
          <button type="button" className={subAba === 'log' ? 'fh-aba fh-aba-ativa' : 'fh-aba'} onClick={() => setSubAba('log')}>Log de Auditoria</button>
        )}
      </nav>

      {subAba === 'fichas' && <PainelFichas usuario={usuario} nomeHotel={nomeHotel} />}
      {subAba === 'config' && souAdmin && <PainelConfigCloudbeds />}
      {subAba === 'log' && souAdmin && <PainelLogFichas usuario={usuario} />}
    </main>
  );
}

// ============================================================================
// ABA: FICHAS RECEBIDAS
// ============================================================================

function PainelFichas({ usuario, nomeHotel }) {
  const [fichas, setFichas] = useState([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState('');
  const [aviso, setAviso] = useState('');
  const [busca, setBusca] = useState('');
  const [filtroStatus, setFiltroStatus] = useState('TODOS');
  const [reservaPorFicha, setReservaPorFicha] = useState({});
  const [exportando, setExportando] = useState(null);
  const [fichaAberta, setFichaAberta] = useState(null);
  const [fichaImprimindo, setFichaImprimindo] = useState(null);

  function mostrarAviso(texto) { setAviso(texto); setTimeout(() => setAviso(''), 6000); }

  const carregar = useCallback(async () => {
    setCarregando(true);
    const { data, error } = await supabase.from('fichas_fnrh').select('*').order('criado_em', { ascending: false });
    if (error) setErro('Não foi possível carregar. Detalhe técnico: ' + error.message);
    setFichas(data || []);
    setCarregando(false);
  }, []);

  useEffect(() => { carregar(); }, [carregar]);

  async function registrarLog(fichaId, acao, detalhe) {
    await supabase.from('fichas_fnrh_log').insert({
      usuario_id: usuario.id, ficha_id: fichaId, acao, detalhe, hotel_id: usuario.hotel_id,
    });
  }

  function verDetalhes(ficha) {
    const abrindo = fichaAberta !== ficha.id;
    setFichaAberta(abrindo ? ficha.id : null);
    if (abrindo) registrarLog(ficha.id, 'VISUALIZACAO', `Dados de ${ficha.nome_completo} visualizados.`);
  }

  async function exportar(ficha) {
    const reservationId = (reservaPorFicha[ficha.id] || '').trim();
    if (!reservationId) { setErro('Informe o número da reserva na Cloudbeds antes de exportar.'); return; }
    setExportando(ficha.id);
    setErro('');
    const { data: sessao } = await supabase.auth.getSession();
    try {
      const resposta = await fetch('/api/cloudbeds-exportar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${sessao.session.access_token}` },
        body: JSON.stringify({ fichaId: ficha.id, reservationId }),
      });
      const resultado = await resposta.json();
      setExportando(null);
      if (!resposta.ok || resultado.erro) { setErro(resultado.erro || 'Não foi possível exportar.'); return; }
      mostrarAviso(`Dados de ${ficha.nome_completo} exportados para a reserva ${reservationId} na Cloudbeds!`);
      carregar();
    } catch (e) {
      setExportando(null);
      setErro('Falha de conexão com o servidor. Tente novamente.');
    }
  }

  const termo = busca.trim().toLowerCase();
  const filtradas = fichas
    .filter((f) => filtroStatus === 'TODOS' ? true : f.status === filtroStatus)
    .filter((f) => !termo || f.nome_completo.toLowerCase().includes(termo) || f.numero_documento.toLowerCase().includes(termo));

  if (carregando) return <p className="texto-suave">Carregando…</p>;

  return (
    <section>
      {aviso && <div className="aviso-sucesso">{aviso}</div>}
      {erro && <div className="aviso-erro">{erro}</div>}

      <div className="fh-barra">
        <input className="campo" type="search" value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar por nome ou documento…" />
        <select className="campo" value={filtroStatus} onChange={(e) => setFiltroStatus(e.target.value)}>
          <option value="TODOS">Todos os status</option>
          <option value="PENDENTE">Aguardando exportação</option>
          <option value="EXPORTADO">Já exportadas</option>
        </select>
      </div>

      {filtradas.length === 0 ? (
        <div className="cartao" style={{ textAlign: 'center', color: 'var(--texto-suave)' }}>Nenhuma ficha encontrada.</div>
      ) : (
        <div className="fh-lista">
          {filtradas.map((f) => (
            <div key={f.id} className="cartao fh-item">
              <div className="fh-item-esq">
                <div className="fh-item-topo">
                  <strong>{f.nome_completo}</strong>
                  <span className="fh-badge" style={f.status === 'EXPORTADO' ? { background: '#DDF2E4', color: '#1E6B3C' } : { background: '#FDF3D7', color: '#8A6100' }}>
                    {f.status === 'EXPORTADO' ? 'Exportada' : 'Aguardando exportação'}
                  </span>
                </div>
                <div className="texto-suave" style={{ fontSize: 13 }}>
                  {f.tipo_documento} {f.numero_documento} · {f.email} · {f.telefone}
                </div>
                {(f.data_checkin || f.data_checkout) && (
                  <div className="fh-badge-estadia">
                    🗓️ Estadia: {formatarData(f.data_checkin)} até {formatarData(f.data_checkout)}
                  </div>
                )}
                <div className="texto-suave" style={{ fontSize: 12 }}>
                  Enviada em {formatarDataHora(f.criado_em)}
                  {f.status === 'EXPORTADO' && ` · Exportada para a reserva ${f.cloudbeds_reservation_id} em ${formatarDataHora(f.exportado_em)}`}
                </div>
                <button type="button" className="fh-ver-mais" onClick={() => verDetalhes(f)}>
                  {fichaAberta === f.id ? 'Ver menos ▲' : 'Ver todos os dados ▼'}
                </button>
                {fichaAberta === f.id && <DetalhesFicha ficha={f} />}
              </div>
              <div className="fh-item-dir">
                <button type="button" className="botao botao-contorno" onClick={() => setFichaImprimindo(f)}>
                  🖨️ Imprimir ficha
                </button>
                {f.status === 'PENDENTE' ? (
                  <>
                    <input className="campo fh-input-reserva" type="text" placeholder="Nº da reserva Cloudbeds"
                      value={reservaPorFicha[f.id] || ''} onChange={(e) => setReservaPorFicha({ ...reservaPorFicha, [f.id]: e.target.value })} />
                    <button type="button" className="botao botao-principal" onClick={() => exportar(f)} disabled={exportando === f.id}>
                      {exportando === f.id ? 'Exportando…' : '☁️ Exportar para Cloudbeds'}
                    </button>
                  </>
                ) : (
                  <span className="texto-suave" style={{ fontSize: 13 }}>✓ Já vinculada</span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {fichaImprimindo && (
        <FichaImpressao ficha={fichaImprimindo} nomeHotel={nomeHotel} onFechar={() => setFichaImprimindo(null)} />
      )}
    </section>
  );
}

function DetalhesFicha({ ficha: f }) {
  return (
    <div className="fh-detalhes">
      <div><strong>Nascimento:</strong> {formatarData(f.data_nascimento)} · <strong>Gênero:</strong> {f.genero || '—'}</div>
      <div><strong>Nacionalidade:</strong> {f.nacionalidade || '—'} · <strong>Profissão:</strong> {f.profissao || '—'}</div>
      <div><strong>Órgão expedidor:</strong> {f.orgao_expedidor || '—'}</div>
      <div><strong>Endereço:</strong> {[f.endereco, f.numero_endereco, f.complemento].filter(Boolean).join(', ') || '—'}</div>
      <div><strong>Bairro/Cidade/UF:</strong> {[f.bairro, f.cidade, f.estado].filter(Boolean).join(' · ') || '—'} · <strong>CEP:</strong> {f.cep || '—'} · {f.pais || '—'}</div>
      <div><strong>Motivo da viagem:</strong> {MOTIVO_LABEL[f.motivo_viagem] || '—'} · <strong>Transporte:</strong> {f.meio_transporte || '—'}</div>
      <div><strong>Procedência:</strong> {[f.procedencia_cidade, f.procedencia_estado, f.procedencia_pais].filter(Boolean).join(' - ') || '—'}</div>
      <div><strong>Destino:</strong> {[f.destino_cidade, f.destino_estado, f.destino_pais].filter(Boolean).join(' - ') || '—'}</div>
    </div>
  );
}

// ============================================================================
// ABA: CONFIGURAR CLOUDBEDS
// ============================================================================

function PainelConfigCloudbeds() {
  const [carregando, setCarregando] = useState(true);
  const [configurado, setConfigurado] = useState(false);
  const [propertyIdAtual, setPropertyIdAtual] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [propertyId, setPropertyId] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState('');
  const [aviso, setAviso] = useState('');

  function mostrarAviso(texto) { setAviso(texto); setTimeout(() => setAviso(''), 6000); }

  const carregarStatus = useCallback(async () => {
    setCarregando(true);
    const { data: sessao } = await supabase.auth.getSession();
    try {
      const resposta = await fetch('/api/cloudbeds-status', {
        headers: { Authorization: `Bearer ${sessao.session.access_token}` },
      });
      const resultado = await resposta.json();
      setConfigurado(!!resultado.configurado);
      setPropertyIdAtual(resultado.propertyId || '');
      setPropertyId(resultado.propertyId || '');
    } catch (e) { /* silencioso */ }
    setCarregando(false);
  }, []);

  useEffect(() => { carregarStatus(); }, [carregarStatus]);

  async function salvar(evento) {
    evento.preventDefault();
    if (salvando) return;
    setErro('');
    if (!apiKey.trim()) { setErro('Cole a chave da API da Cloudbeds.'); return; }

    setSalvando(true);
    const { data: sessao } = await supabase.auth.getSession();
    try {
      const resposta = await fetch('/api/cloudbeds-salvar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${sessao.session.access_token}` },
        body: JSON.stringify({ apiKey: apiKey.trim(), propertyId: propertyId.trim() }),
      });
      const resultado = await resposta.json();
      setSalvando(false);
      if (!resposta.ok || resultado.erro) { setErro(resultado.erro || 'Não foi possível salvar.'); return; }
      setApiKey('');
      mostrarAviso('Credenciais da Cloudbeds salvas com segurança!');
      carregarStatus();
    } catch (e) {
      setSalvando(false);
      setErro('Falha de conexão com o servidor. Tente novamente.');
    }
  }

  if (carregando) return <p className="texto-suave">Carregando…</p>;

  return (
    <section>
      {aviso && <div className="aviso-sucesso">{aviso}</div>}
      {erro && <div className="aviso-erro">{erro}</div>}

      <div className="cartao" style={{ marginBottom: 16 }}>
        <strong>Status atual: </strong>
        {configurado
          ? <span style={{ color: 'var(--sucesso-texto)', fontWeight: 700 }}>✓ Integração configurada</span>
          : <span style={{ color: 'var(--erro-texto)', fontWeight: 700 }}>✗ Ainda não configurada</span>}
        {propertyIdAtual && <p className="texto-suave" style={{ fontSize: 13, marginTop: 6 }}>Property ID atual: {propertyIdAtual}</p>}
      </div>

      <form className="cartao" onSubmit={salvar}>
        <h2 style={{ fontSize: '1.1rem', marginBottom: 4 }}>{configurado ? 'Atualizar' : 'Configurar'} credenciais</h2>
        <p className="texto-suave" style={{ fontSize: 13 }}>
          No painel da Cloudbeds, vá em <strong>Configurações → API Credentials</strong> e gere uma chave de
          autoatendimento (Self-Service API Key). Cole ela aqui.
        </p>

        <label className="rotulo">Chave da API (API Key) *</label>
        <input className="campo" type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="cbat_..." autoComplete="off" />
        <label className="rotulo">Property ID (opcional — só se o hotel tiver várias propriedades na mesma conta)</label>
        <input className="campo" type="text" value={propertyId} onChange={(e) => setPropertyId(e.target.value)} />

        <button type="submit" className="botao botao-principal" disabled={salvando} style={{ marginTop: 12 }}>
          {salvando ? 'Salvando…' : 'Salvar credenciais'}
        </button>
      </form>

      <p className="texto-suave" style={{ fontSize: 12, marginTop: 10 }}>
        🔒 Por segurança, a chave nunca aparece de volta na tela depois de salva — nem para o administrador.
        Se precisar trocar, é só colar uma nova aqui, ela substitui a anterior.
      </p>
    </section>
  );
}

// ============================================================================
// ABA: LOG DE AUDITORIA (só admin)
// ============================================================================

function PainelLogFichas({ usuario }) {
  const [logs, setLogs] = useState([]);
  const [nomes, setNomes] = useState({});
  const [carregando, setCarregando] = useState(true);

  useEffect(() => {
    async function carregar() {
      const [l, u] = await Promise.all([
        supabase.from('fichas_fnrh_log').select('*').order('data_hora', { ascending: false }).limit(300),
        supabase.from('usuarios').select('id, nome').eq('hotel_id', usuario.hotel_id),
      ]);
      const mapa = {};
      (u.data || []).forEach((p) => { mapa[p.id] = p.nome; });
      setNomes(mapa);
      setLogs(l.data || []);
      setCarregando(false);
    }
    carregar();
  }, [usuario.hotel_id]);

  const ACAO_LABEL = { VISUALIZACAO: 'Visualização', EXPORTACAO: 'Exportação para Cloudbeds' };
  const ACAO_COR = { VISUALIZACAO: '#1D4E89', EXPORTACAO: '#1E6B3C' };

  if (carregando) return <p className="texto-suave">Carregando…</p>;

  return (
    <section className="fh-lista">
      {logs.length === 0 ? (
        <div className="cartao" style={{ textAlign: 'center', color: 'var(--texto-suave)' }}>Nenhum registro no log ainda.</div>
      ) : (
        logs.map((l) => (
          <div key={l.id} className="cartao" style={{ padding: '12px 16px' }}>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'baseline' }}>
              <strong>{nomes[l.usuario_id] || `Usuário #${l.usuario_id}`}</strong>
              <span className="fh-badge" style={{ background: '#F0F0F0', color: ACAO_COR[l.acao] || 'var(--tinta)' }}>
                {ACAO_LABEL[l.acao] || l.acao}
              </span>
            </div>
            {l.detalhe && <div style={{ fontSize: 14, marginTop: 3 }}>{l.detalhe}</div>}
            <div className="texto-suave" style={{ fontSize: 12 }}>{formatarDataHora(l.data_hora)}</div>
          </div>
        ))
      )}
    </section>
  );
}

// ============================================================================
// FICHA PARA IMPRESSÃO — modelo oficial do hotel, 1 página A4
// ============================================================================

function montarHtmlFicha(f, nomeHotel) {
  const numeroDocumentoRG = f.tipo_documento === 'RG' ? f.numero_documento : '';
  const cpfSomenteNumeros = f.tipo_documento === 'CPF' ? String(f.numero_documento || '').replace(/\D/g, '') : '';
  const escapar = (texto) => String(texto || '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<title>Ficha — ${escapar(f.nome_completo)}</title>
<style>
  @page { size: A4 portrait; margin: 14mm; }
  * { box-sizing: border-box; }
  body { font-family: Arial, Helvetica, sans-serif; color: #1a1a1a; font-size: 12px; line-height: 1.4; margin: 0; padding: 0; }
  h1.hotel { font-size: 18px; text-align: center; margin: 0 0 18px; }
  .assinatura { margin-bottom: 18px; }
  .linha-assinatura { display: flex; align-items: flex-end; gap: 10px; }
  .linha { flex: 1; border-bottom: 1px solid #333; height: 1px; }
  .data-linha { white-space: nowrap; font-size: 12px; }
  .legenda-assinatura { display: flex; justify-content: space-between; font-size: 10px; color: #555; margin-top: 2px; }
  .campos { display: grid; grid-template-columns: 1fr 1fr; gap: 10px 24px; margin-bottom: 18px; }
  .campo label { display: block; font-size: 10px; font-weight: 700; color: #555; margin-bottom: 2px; }
  .valor { border-bottom: 1px solid #999; min-height: 16px; font-size: 13px; padding-bottom: 2px; }
  .secao { margin-bottom: 10px; }
  .secao h3 { font-size: 11px; margin: 0 0 4px; }
  .secao p { margin: 0 0 3px; font-size: 9.5px; text-align: justify; }
</style>
</head>
<body>
  <h1 class="hotel">${escapar(nomeHotel)}</h1>

  <div class="assinatura">
    <div class="linha-assinatura">
      <span class="linha"></span>
      <span class="data-linha">____/____/_____</span>
    </div>
    <div class="legenda-assinatura">
      <span>Assinatura (De acordo com o documento)</span>
      <span>Data</span>
    </div>
  </div>

  <div class="campos">
    <div class="campo"><label>Nome</label><div class="valor">${escapar(f.nome_completo)}</div></div>
    <div class="campo"><label>Data de Entrada</label><div class="valor">${escapar(formatarData(f.data_checkin))}</div></div>
    <div class="campo"><label>Número do Documento</label><div class="valor">${escapar(numeroDocumentoRG)}</div></div>
    <div class="campo"><label>Data de partida</label><div class="valor">${escapar(formatarData(f.data_checkout))}</div></div>
    <div class="campo"><label>Número da Acomodação</label><div class="valor"></div></div>
    <div class="campo"><label>CPF (somente números)</label><div class="valor">${escapar(cpfSomenteNumeros)}</div></div>
  </div>

  <div class="secao">
    <h3>1. POLÍTICAS FINANCEIRAS E DE RESERVA</h3>
    <p><strong>Horários:</strong> Check-in a partir das 12h; check-out até as 12h. Early check-in ou late check-out mediante disponibilidade e cobrança de taxa.</p>
    <p><strong>Hóspedes Adicionais:</strong> Acomodação válida para o número de hóspedes da reserva. Pessoas extras devem ser informadas à recepção e estarão sujeitas à cobrança adicional.</p>
    <p><strong>Danos:</strong> Responsabilizo-me por danos causados na acomodação e nas demais dependências do hotel, que deverão ser quitados no check-out (Pix, débito, crédito). Para garantia, autorizo o débito dos custos de reparo/reposição no cartão de crédito informado.</p>
    <p><strong>Abandono de Unidade e Inadimplência:</strong> A inadimplência ou ausência de contato por mais de 12h autoriza o hotel a desocupar a unidade administrativamente, inventariar e guardar pertences por 30 dias, liberando o quarto para novas reservas.</p>
  </div>

  <div class="secao">
    <h3>2. NORMAS DE CONDUTA E SEGURANÇA</h3>
    <p><strong>Silêncio:</strong> Pedimos a colaboração para manter o silêncio, especialmente das 22h às 8h.</p>
    <p><strong>Ambiente Livre de Tabaco:</strong> É proibido fumar (cigarros, vapes, etc.) em qualquer área interna, incluindo apartamentos e varandas (Lei 12.546/11). A infração resultará em multa de uma diária (tarifa balcão) para higienização.</p>
    <p><strong>Visitantes:</strong> O acesso aos apartamentos é restrito aos hóspedes. Visitas são bem-vindas no lobby.</p>
    <p><strong>Convivência:</strong> Para o conforto geral, solicitamos não circular com trajes de banho no lobby e restaurantes. Comportamentos que perturbem o sossego e a segurança de outros hóspedes ou de nossa equipe poderão levar ao encerramento imediato da estada.</p>
    <p><strong>Animais:</strong> Não permitimos animais de estimação, com exceção de cães-guia (conforme legislação).</p>
  </div>

  <div class="secao">
    <h3>3. DEVER DE GUARDA E USO DO COFRE</h3>
    <p>O hotel é responsável pela guarda de seus pertences. Para maior segurança com itens de valor (dinheiro, joias, etc.), recomendamos fortemente o uso do cofre gratuito disponível no apartamento. Pedimos que, por favor, indique abaixo se deseja ou não utilizar o cofre durante a sua estadia:</p>
    <p>[ ] Desejo utilizar o cofre durante a minha estadia.</p>
    <p>[ ] Não desejo utilizar o cofre durante a minha estadia.</p>
  </div>

  <div class="secao">
    <h3>4. PROTEÇÃO DE DADOS (LGPD)</h3>
    <p>Autorizo o tratamento e digitalização de meus dados para fins legais (Lei 11.771/08), segurança e gestão da estada, sob garantia de sigilo.</p>
  </div>

  <div class="secao">
    <h3>5. HOSPEDAGEM DE MENORES DE IDADE</h3>
    <p>Exige-se documento original e, se desacompanhado, autorização dos pais com firma reconhecida (Art. 82 do ECA).</p>
  </div>
</body>
</html>`;
}

function FichaImpressao({ ficha: f, nomeHotel, onFechar }) {
  const numeroDocumentoRG = f.tipo_documento === 'RG' ? f.numero_documento : '';
  const cpfSomenteNumeros = f.tipo_documento === 'CPF' ? String(f.numero_documento || '').replace(/\D/g, '') : '';

  function imprimir() {
    // Abre uma janela nova, LIMPA (só com o conteúdo da ficha, nada mais
    // da tela por perto) — evita de vez qualquer duplicação ou bagunça
    // que a impressão "por cima da tela normal" estava causando.
    const janela = window.open('', '_blank', 'width=900,height=1000');
    if (!janela) {
      alert('Não foi possível abrir a janela de impressão. Confira se o navegador não bloqueou pop-ups para este site.');
      return;
    }
    janela.document.open();
    janela.document.write(montarHtmlFicha(f, nomeHotel));
    janela.document.close();
    janela.onload = () => { janela.focus(); janela.print(); };
    // Reforço, caso onload não dispare a tempo em algum navegador
    setTimeout(() => { try { janela.focus(); janela.print(); } catch (e) {} }, 400);
  }

  return (
    <div className="at-overlay" role="dialog" aria-modal="true">
      <div className="at-modal" style={{ maxWidth: 720 }}>
        <div className="at-modal-topo at-nao-imprimir">
          <h2 style={{ fontSize: '1.15rem', margin: 0 }}>Ficha para impressão — {f.nome_completo}</h2>
          <button type="button" className="at-fechar" onClick={onFechar} aria-label="Fechar">✕</button>
        </div>

        <p className="texto-suave" style={{ fontSize: 13 }}>
          Prévia dos dados que vão para o modelo impresso (o texto completo das políticas aparece só na hora de imprimir):
        </p>
        <div className="ficha-imp-campos">
          <div className="ficha-imp-campo"><label>Nome</label><div className="ficha-imp-valor">{f.nome_completo}</div></div>
          <div className="ficha-imp-campo"><label>Data de Entrada</label><div className="ficha-imp-valor">{formatarData(f.data_checkin)}</div></div>
          <div className="ficha-imp-campo"><label>Número do Documento</label><div className="ficha-imp-valor">{numeroDocumentoRG}</div></div>
          <div className="ficha-imp-campo"><label>Data de partida</label><div className="ficha-imp-valor">{formatarData(f.data_checkout)}</div></div>
          <div className="ficha-imp-campo"><label>Número da Acomodação</label><div className="ficha-imp-valor"></div></div>
          <div className="ficha-imp-campo"><label>CPF (somente números)</label><div className="ficha-imp-valor">{cpfSomenteNumeros}</div></div>
        </div>

        <div className="at-modal-botoes at-nao-imprimir">
          <button type="button" className="botao botao-principal" onClick={imprimir}>🖨️ Abrir e Imprimir</button>
          <button type="button" className="botao botao-suave" onClick={onFechar}>Fechar</button>
        </div>
      </div>
    </div>
  );
}

function EstilosFichasAdmin() {
  return (
    <style>{`
      .fh-abas { display: flex; gap: 6px; overflow-x: auto; margin: 14px 0 16px; padding-bottom: 4px; }
      .fh-aba { border: 1px solid var(--borda); background: var(--branco); color: var(--tinta); border-radius: 999px; padding: 10px 16px; font-size: 14px; font-weight: 600; cursor: pointer; white-space: nowrap; min-height: 42px; }
      .fh-aba-ativa { background: var(--marca); border-color: var(--marca); color: var(--branco); }

      .fh-barra { display: flex; flex-direction: column; gap: 10px; margin-bottom: 14px; }
      .fh-lista { display: flex; flex-direction: column; gap: 12px; }
      .fh-item { display: flex; flex-direction: column; gap: 10px; padding: 16px; }
      .fh-item-topo { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
      .fh-item-topo strong { font-size: 16px; }
      .fh-badge { display: inline-block; font-size: 12px; font-weight: 700; border-radius: 999px; padding: 3px 10px; }
      .fh-badge-estadia { display: inline-block; font-size: 12px; font-weight: 700; color: var(--marca); background: var(--marca-clara); border-radius: 999px; padding: 3px 10px; width: fit-content; }
      .fh-item-dir { display: flex; flex-direction: column; gap: 8px; align-items: flex-start; }
      .fh-input-reserva { width: auto; min-width: 200px; }
      .fh-ver-mais { border: none; background: none; color: var(--marca); font-weight: 600; font-size: 13px; cursor: pointer; padding: 4px 0; text-align: left; }
      .fh-detalhes { background: var(--fundo); border-radius: 10px; padding: 12px; font-size: 13px; display: flex; flex-direction: column; gap: 4px; margin-top: 6px; }

      @media (min-width: 640px) {
        .fh-barra { flex-direction: row; align-items: center; }
        .fh-barra .campo { flex: 1; }
        .fh-item { flex-direction: row; justify-content: space-between; align-items: flex-start; }
        .fh-item-dir { align-items: flex-end; }
      }

      /* ---- Modal genérico (usado pela impressão da ficha) ---- */
      .at-overlay { position: fixed; inset: 0; background: rgba(15, 25, 22, 0.55); display: flex; align-items: flex-end; justify-content: center; z-index: 80; }
      .at-modal { background: var(--branco); width: 100%; max-height: 92vh; overflow-y: auto; border-radius: 18px 18px 0 0; padding: 18px; }
      .at-modal-topo { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-bottom: 10px; }
      .at-fechar { border: none; background: #E9ECE8; border-radius: 999px; width: 40px; height: 40px; font-size: 16px; cursor: pointer; flex-shrink: 0; }
      .at-modal-botoes { display: flex; gap: 10px; flex-wrap: wrap; margin-top: 16px; }
      @media (min-width: 640px) {
        .at-overlay { align-items: center; padding: 24px; }
        .at-modal { max-width: 700px; border-radius: 18px; padding: 24px; }
      }

      /* ---- Prévia dos campos (a impressão de verdade usa uma janela
         separada, com seu próprio CSS embutido — veja montarHtmlFicha) ---- */
      .ficha-imp-campos { display: grid; grid-template-columns: 1fr 1fr; gap: 10px 20px; margin: 12px 0; }
      .ficha-imp-campo label { display: block; font-size: 11px; font-weight: 700; color: var(--texto-suave); margin-bottom: 2px; }
      .ficha-imp-valor { border-bottom: 1px solid var(--borda); min-height: 18px; font-size: 14px; padding-bottom: 3px; }
    `}</style>
  );
}