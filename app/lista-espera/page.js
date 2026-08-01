'use client';

// ============================================================================
// LISTA DE ESPERA (Waitlist de reservas)
// - Exige login; cada hotel só vê a própria lista (RLS no banco)
// - Ao salvar, abre automaticamente o WhatsApp e o e-mail com a mensagem
//   de confirmação pronta (o mesmo texto validado no protótipo)
// - Fila de prioridade: ordenada por data de check-in e, dentro da mesma
//   data, por ordem de chegada (quem pediu primeiro fica na frente)
// - Por padrão, esconde solicitações com check-in já passado
// ============================================================================

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '../../lib/supabaseClient';

// ---- Funções de apoio -------------------------------------------------------

// Data de hoje no formato AAAA-MM-DD (para comparar com o campo date)
function hojeISO() {
  const h = new Date();
  return `${h.getFullYear()}-${String(h.getMonth() + 1).padStart(2, '0')}-${String(h.getDate()).padStart(2, '0')}`;
}

// dd/mm/aaaa para exibir e usar na mensagem
function formatarData(valor) {
  if (!valor) return '—';
  const [ano, mes, dia] = String(valor).slice(0, 10).split('-');
  return `${dia}/${mes}/${ano}`;
}

function formatarDataHora(valor) {
  if (!valor) return '—';
  try {
    return new Date(valor).toLocaleString('pt-BR', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  } catch (e) {
    return String(valor);
  }
}

// Valida e normaliza o telefone: precisa ter DDD (10 ou 11 dígitos).
// Devolve o número pronto para o WhatsApp (com 55 na frente) ou null se inválido.
function normalizarTelefone(texto) {
  let digitos = String(texto || '').replace(/\D/g, '');
  if (digitos.startsWith('55') && (digitos.length === 12 || digitos.length === 13)) {
    return digitos; // já veio com o código do Brasil
  }
  if (digitos.length === 10 || digitos.length === 11) {
    return '55' + digitos;
  }
  return null;
}

// Máscara ao vivo enquanto digita (fixo ou celular, sem o 55 do Brasil)
function formatarTelefoneBR(texto) {
  const d = String(texto || '').replace(/\D/g, '').slice(0, 11);
  if (d.length <= 2) return d;
  if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
}

function emailValido(texto) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(texto || '').trim());
}

// Monta a mensagem de confirmação (mesmo texto do protótipo)
function montarMensagem(registro, nomeHotel) {
  return (
    `Olá, ${registro.nome_completo}! Que alegria ver que você escolheu o nosso hotel para os seus dias de descanso! 🌟\n\n` +
    `Esta mensagem é para confirmar que recebemos os seus dados e você já está oficialmente em nossa Lista de Espera para o período de ${formatarData(registro.data_checkin)} até ${formatarData(registro.data_checkout)}.\n\n` +
    `⚠️ Atenção: Queremos lembrá-lo de que esta mensagem ainda não é a confirmação da sua reserva, tudo bem? Ela garante apenas que você está na nossa fila de prioridade para essas datas.\n\n` +
    `Assim que tivermos um apartamento liberado e prontinho para recebê-los, entraremos em contato com você imediatamente!\n\n` +
    `Agradecemos imensamente pela preferência e paciência. Estamos torcendo para conseguir recebê-los em breve!\n\n` +
    `Com carinho, Equipe de Reservas - ${nomeHotel}`
  );
}

// ---- Componente principal ---------------------------------------------------

export default function ListaEspera() {
  const router = useRouter();

  const [verificandoLogin, setVerificandoLogin] = useState(true);
  const [usuario, setUsuario] = useState(null);
  const [nomeHotel, setNomeHotel] = useState('nosso hotel');

  const [registros, setRegistros] = useState([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState('');
  const [avisoSucesso, setAvisoSucesso] = useState('');

  // Filtros
  const [busca, setBusca] = useState('');
  const [mostrarPassados, setMostrarPassados] = useState(false);

  // Formulário
  const [mostrarFormulario, setMostrarFormulario] = useState(false);
  const [nomeCompleto, setNomeCompleto] = useState('');
  const [telefoneWhatsapp, setTelefoneWhatsapp] = useState('');
  const [email, setEmail] = useState('');
  const [dataCheckin, setDataCheckin] = useState('');
  const [dataCheckout, setDataCheckout] = useState('');
  const [qtdApartamentos, setQtdApartamentos] = useState(1);
  const [qtdHospedes, setQtdHospedes] = useState(1);
  const [flexibilidade, setFlexibilidade] = useState(false);
  const [observacoes, setObservacoes] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [erroFormulario, setErroFormulario] = useState('');

  // Remoção
  const [removendoId, setRemovendoId] = useState(null); // id aguardando confirmação

  // Passo 1: confere o login e identifica o usuário e o hotel
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

      // Busca o nome fantasia do hotel (para assinar a mensagem)
      const { data: hotel } = await supabase
        .from('hoteis')
        .select('nome_fantasia')
        .eq('id', dadosUsuario.hotel_id)
        .single();
      if (ativo && hotel?.nome_fantasia) setNomeHotel(hotel.nome_fantasia);
    }
    verificar();
    return () => { ativo = false; };
  }, [router]);

  // Passo 2: carrega a lista de espera do hotel
  const carregarRegistros = useCallback(async (hotelId) => {
    setCarregando(true);
    setErro('');
    const { data, error } = await supabase
      .from('lista_espera')
      .select('*')
      .eq('hotel_id', hotelId)
      .order('data_checkin', { ascending: true })
      .order('data_solicitacao', { ascending: true });

    if (error) {
      setErro('Não foi possível carregar a lista de espera. Detalhe técnico: ' + error.message);
    } else {
      setRegistros(data || []);
    }
    setCarregando(false);
  }, []);

  useEffect(() => {
    if (usuario?.hotel_id) carregarRegistros(usuario.hotel_id);
  }, [usuario, carregarRegistros]);

  // Abre o WhatsApp e o e-mail com a mensagem pronta
  function dispararMensagens(registro) {
    const mensagem = montarMensagem(registro, nomeHotel);
    const telefone = normalizarTelefone(registro.telefone_whatsapp);

    if (telefone) {
      window.open(`https://wa.me/${telefone}?text=${encodeURIComponent(mensagem)}`, '_blank');
    }
    // Pequena pausa para o navegador não bloquear a segunda janela
    setTimeout(() => {
      const assunto = 'Você está na nossa Lista de Espera 🌟';
      window.open(
        `mailto:${registro.email}?subject=${encodeURIComponent(assunto)}&body=${encodeURIComponent(mensagem)}`,
        '_self'
      );
    }, 600);
  }

  // Salvar e confirmar (cadastra + dispara WhatsApp e e-mail)
  async function salvarRegistro(evento) {
    evento.preventDefault();
    if (salvando) return;
    setErroFormulario('');
    setAvisoSucesso('');

    // ---- Validações (as mesmas regras do protótipo) ----
    if (!nomeCompleto.trim()) {
      setErroFormulario('Preencha o nome completo do hóspede.');
      return;
    }
    const telefoneNormalizado = normalizarTelefone(telefoneWhatsapp);
    if (!telefoneNormalizado) {
      setErroFormulario('Telefone inválido: informe o DDD + número (10 ou 11 dígitos). Ex.: (88) 99999-0000');
      return;
    }
    if (!emailValido(email)) {
      setErroFormulario('E-mail inválido. Confira se está no formato nome@dominio.com');
      return;
    }
    if (!dataCheckin || !dataCheckout) {
      setErroFormulario('Preencha as datas de check-in e check-out.');
      return;
    }
    if (dataCheckout <= dataCheckin) {
      setErroFormulario('A data de check-out precisa ser depois da data de check-in.');
      return;
    }
    if (Number(qtdApartamentos) < 1 || Number(qtdHospedes) < 1) {
      setErroFormulario('Quantidade de apartamentos e de hóspedes precisa ser pelo menos 1.');
      return;
    }

    setSalvando(true);
    const novoRegistro = {
      nome_completo: nomeCompleto.trim(),
      telefone_whatsapp: telefoneWhatsapp.trim(),
      email: email.trim(),
      data_checkin: dataCheckin,
      data_checkout: dataCheckout,
      qtd_apartamentos: Number(qtdApartamentos),
      qtd_hospedes: Number(qtdHospedes),
      flexibilidade_datas: flexibilidade,
      observacoes: observacoes.trim() || null,
      criado_por_id: usuario.id,
      hotel_id: usuario.hotel_id,
    };

    const { data: salvo, error } = await supabase
      .from('lista_espera')
      .insert(novoRegistro)
      .select()
      .single();
    setSalvando(false);

    if (error) {
      setErroFormulario('Não foi possível salvar. Detalhe técnico: ' + error.message);
      return;
    }

    // Dispara a mensagem de confirmação (WhatsApp + e-mail)
    dispararMensagens(salvo);

    // Limpa o formulário e recarrega
    setNomeCompleto('');
    setTelefoneWhatsapp('');
    setEmail('');
    setDataCheckin('');
    setDataCheckout('');
    setQtdApartamentos(1);
    setQtdHospedes(1);
    setFlexibilidade(false);
    setObservacoes('');
    setMostrarFormulario(false);
    setAvisoSucesso('Hóspede adicionado à lista de espera! O WhatsApp e o e-mail foram abertos com a mensagem pronta — é só enviar.');
    setTimeout(() => setAvisoSucesso(''), 8000);
    carregarRegistros(usuario.hotel_id);
  }

  // Remover da lista (quando o hóspede foi acomodado ou desistiu)
  async function removerRegistro(id) {
    const { error } = await supabase.from('lista_espera').delete().eq('id', id);
    setRemovendoId(null);
    if (error) {
      setErro('Não foi possível remover. Detalhe técnico: ' + error.message);
      return;
    }
    setAvisoSucesso('Registro removido da lista de espera.');
    setTimeout(() => setAvisoSucesso(''), 4000);
    carregarRegistros(usuario.hotel_id);
  }

  // ---- Filtros aplicados na tela ----
  const hoje = hojeISO();
  const registrosFiltrados = registros.filter((r) => {
    // Regra padrão: esconde check-ins que já passaram
    if (!mostrarPassados && String(r.data_checkin).slice(0, 10) < hoje) return false;

    const texto = busca.trim().toLowerCase();
    if (!texto) return true;
    return (
      (r.nome_completo || '').toLowerCase().includes(texto) ||
      (r.telefone_whatsapp || '').toLowerCase().includes(texto) ||
      (r.email || '').toLowerCase().includes(texto)
    );
  });

  const totalPassados = registros.filter(
    (r) => String(r.data_checkin).slice(0, 10) < hoje
  ).length;

  if (verificandoLogin) {
    return (
      <main className="conteudo">
        <p className="texto-suave">Verificando seu acesso…</p>
      </main>
    );
  }

  return (
    <main className="conteudo">
      <EstilosListaEspera />

      <span className="olho">Fila de reservas</span>
      <div className="barra-pagina">
        <h1 style={{ margin: 0 }}>Lista de Espera</h1>
        <button
          type="button"
          className="botao botao-principal"
          onClick={() => { setMostrarFormulario(!mostrarFormulario); setErroFormulario(''); }}
        >
          {mostrarFormulario ? 'Fechar formulário' : '+ Adicionar à lista'}
        </button>
      </div>

      {avisoSucesso && <div className="aviso-sucesso">{avisoSucesso}</div>}
      {erro && <div className="aviso-erro">{erro}</div>}

      {/* ---- Formulário de cadastro ---- */}
      {mostrarFormulario && (
        <form className="cartao" style={{ marginBottom: 20 }} onSubmit={salvarRegistro}>
          <h2 style={{ fontSize: '1.2rem', marginBottom: 4 }}>Novo hóspede na lista de espera</h2>
          <p className="texto-suave" style={{ fontSize: 14 }}>
            Ao salvar, o WhatsApp e o e-mail abrem sozinhos com a mensagem de
            confirmação pronta — você só confere e envia.
          </p>

          <label className="rotulo" htmlFor="le-nome">Nome completo *</label>
          <input
            id="le-nome"
            className="campo"
            type="text"
            value={nomeCompleto}
            onChange={(e) => setNomeCompleto(e.target.value)}
            placeholder="Ex.: Maria Souza"
          />

          <div className="le-duas-colunas">
            <div>
              <label className="rotulo" htmlFor="le-telefone">Telefone / WhatsApp (com DDD) *</label>
              <input
                id="le-telefone"
                className="campo"
                type="tel"
                inputMode="numeric"
                value={telefoneWhatsapp}
                onChange={(e) => setTelefoneWhatsapp(formatarTelefoneBR(e.target.value))}
                placeholder="(88) 99999-0000"
              />
            </div>
            <div>
              <label className="rotulo" htmlFor="le-email">E-mail *</label>
              <input
                id="le-email"
                className="campo"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="hospede@email.com"
              />
            </div>
          </div>

          <div className="le-duas-colunas">
            <div>
              <label className="rotulo" htmlFor="le-checkin">Data de check-in *</label>
              <input
                id="le-checkin"
                className="campo"
                type="date"
                value={dataCheckin}
                onChange={(e) => setDataCheckin(e.target.value)}
              />
            </div>
            <div>
              <label className="rotulo" htmlFor="le-checkout">Data de check-out *</label>
              <input
                id="le-checkout"
                className="campo"
                type="date"
                value={dataCheckout}
                onChange={(e) => setDataCheckout(e.target.value)}
              />
            </div>
          </div>

          <div className="le-duas-colunas">
            <div>
              <label className="rotulo" htmlFor="le-aptos">Qtd. de apartamentos *</label>
              <input
                id="le-aptos"
                className="campo"
                type="number"
                min={1}
                value={qtdApartamentos}
                onChange={(e) => setQtdApartamentos(e.target.value)}
              />
            </div>
            <div>
              <label className="rotulo" htmlFor="le-hospedes">Qtd. de hóspedes *</label>
              <input
                id="le-hospedes"
                className="campo"
                type="number"
                min={1}
                value={qtdHospedes}
                onChange={(e) => setQtdHospedes(e.target.value)}
              />
            </div>
          </div>

          <label className="le-caixa-flex">
            <input
              type="checkbox"
              checked={flexibilidade}
              onChange={() => setFlexibilidade(!flexibilidade)}
            />
            <span>
              <strong>Flexível quanto às datas</strong> — o hóspede aceita datas
              próximas caso o período pedido não libere
            </span>
          </label>

          <label className="rotulo" htmlFor="le-obs">Observações</label>
          <textarea
            id="le-obs"
            className="campo"
            rows={3}
            value={observacoes}
            onChange={(e) => setObservacoes(e.target.value)}
            placeholder="Ex.: Prefere andar térreo; aniversário de casamento…"
          />

          {erroFormulario && <div className="aviso-erro">{erroFormulario}</div>}

          <button
            type="submit"
            className="botao botao-principal"
            disabled={salvando}
            style={{ marginTop: 16 }}
          >
            {salvando ? 'Salvando…' : 'Salvar e enviar confirmação'}
          </button>
        </form>
      )}

      {/* ---- Busca e filtro de passados ---- */}
      <div className="le-barra-filtros">
        <input
          className="campo"
          type="search"
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder="Buscar por nome, telefone ou e-mail…"
          aria-label="Buscar na lista de espera"
        />
        <label className="le-caixa-flex" style={{ margin: 0, whiteSpace: 'nowrap' }}>
          <input
            type="checkbox"
            checked={mostrarPassados}
            onChange={() => setMostrarPassados(!mostrarPassados)}
          />
          <span>Mostrar datas passadas ({totalPassados})</span>
        </label>
      </div>

      {/* ---- Fila ---- */}
      {carregando ? (
        <p className="texto-suave">Carregando a lista de espera…</p>
      ) : registrosFiltrados.length === 0 ? (
        <div className="cartao" style={{ textAlign: 'center', color: 'var(--texto-suave)' }}>
          {busca
            ? 'Nenhum registro encontrado com essa busca.'
            : 'A lista de espera está vazia. Use o botão "+ Adicionar à lista" quando um hóspede pedir datas sem disponibilidade.'}
        </div>
      ) : (
        <ol className="le-fila">
          {registrosFiltrados.map((r, indice) => {
            const passado = String(r.data_checkin).slice(0, 10) < hoje;
            return (
              <li key={r.id} className={`cartao le-item ${passado ? 'le-item-passado' : ''}`}>
                <div className="le-item-topo">
                  <span className="le-posicao" aria-label={`Posição ${indice + 1} na fila`}>
                    {indice + 1}º
                  </span>
                  <div className="le-item-nome">
                    <strong>{r.nome_completo}</strong>
                    <div className="le-item-etiquetas">
                      {r.flexibilidade_datas && (
                        <span className="le-etiqueta le-etiqueta-flex">Flexível nas datas</span>
                      )}
                      {passado && <span className="le-etiqueta le-etiqueta-passado">Check-in já passou</span>}
                    </div>
                  </div>
                </div>

                <div className="le-item-detalhes">
                  <span>📅 {formatarData(r.data_checkin)} → {formatarData(r.data_checkout)}</span>
                  <span>🛏️ {r.qtd_apartamentos} apto(s)</span>
                  <span>👥 {r.qtd_hospedes} hóspede(s)</span>
                  <span>📞 {r.telefone_whatsapp}</span>
                  <span>✉️ {r.email}</span>
                </div>

                {r.observacoes && (
                  <p className="le-item-obs">📝 {r.observacoes}</p>
                )}

                <p className="texto-suave" style={{ fontSize: 12, margin: '6px 0 10px' }}>
                  Solicitado em {formatarDataHora(r.data_solicitacao)}
                </p>

                <div className="le-item-acoes">
                  <button
                    type="button"
                    className="botao botao-contorno"
                    onClick={() => {
                      const tel = normalizarTelefone(r.telefone_whatsapp);
                      const msg = montarMensagem(r, nomeHotel);
                      if (tel) window.open(`https://wa.me/${tel}?text=${encodeURIComponent(msg)}`, '_blank');
                    }}
                  >
                    WhatsApp
                  </button>
                  <button
                    type="button"
                    className="botao botao-contorno"
                    onClick={() => {
                      const msg = montarMensagem(r, nomeHotel);
                      window.open(
                        `mailto:${r.email}?subject=${encodeURIComponent('Você está na nossa Lista de Espera 🌟')}&body=${encodeURIComponent(msg)}`,
                        '_self'
                      );
                    }}
                  >
                    E-mail
                  </button>

                  {removendoId === r.id ? (
                    <span className="le-confirmar-remocao">
                      Remover mesmo?
                      <button
                        type="button"
                        className="botao botao-perigo"
                        onClick={() => removerRegistro(r.id)}
                      >
                        Sim, remover
                      </button>
                      <button
                        type="button"
                        className="botao botao-suave"
                        onClick={() => setRemovendoId(null)}
                      >
                        Não
                      </button>
                    </span>
                  ) : (
                    <button
                      type="button"
                      className="botao botao-suave"
                      onClick={() => setRemovendoId(r.id)}
                    >
                      Remover da lista
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </main>
  );
}

// ---- Estilos específicos deste módulo ---------------------------------------

function EstilosListaEspera() {
  return (
    <style>{`
      .le-duas-colunas { display: grid; grid-template-columns: 1fr; gap: 0 16px; }

      .le-caixa-flex {
        display: flex; align-items: flex-start; gap: 10px;
        margin: 16px 0 4px; font-size: 14px; cursor: pointer; line-height: 1.45;
      }
      .le-caixa-flex input { width: 18px; height: 18px; margin-top: 2px; flex-shrink: 0; }

      .le-barra-filtros {
        display: flex; flex-direction: column; gap: 10px;
        margin-bottom: 16px;
      }

      .le-fila { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 12px; }

      .le-item { padding: 16px; }
      .le-item-passado { opacity: 0.72; }

      .le-item-topo { display: flex; align-items: flex-start; gap: 12px; }
      .le-posicao {
        display: inline-flex; align-items: center; justify-content: center;
        min-width: 42px; height: 42px; border-radius: 12px;
        background: var(--marca-clara); color: var(--marca);
        font-family: var(--fonte-titulo); font-weight: 700; font-size: 16px;
        flex-shrink: 0;
      }
      .le-item-nome strong { font-size: 16px; }
      .le-item-etiquetas { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 4px; }
      .le-etiqueta {
        display: inline-block; font-size: 11px; font-weight: 700;
        letter-spacing: 0.04em; text-transform: uppercase;
        border-radius: 999px; padding: 3px 10px;
      }
      .le-etiqueta-flex { background: #F4ECD7; color: var(--latao-texto); }
      .le-etiqueta-passado { background: #EFEFEF; color: #666666; }

      .le-item-detalhes {
        display: flex; flex-wrap: wrap; gap: 6px 18px;
        font-size: 14px; color: var(--tinta); margin-top: 12px;
      }
      .le-item-obs {
        font-size: 14px; color: var(--texto-suave);
        background: var(--fundo); border-radius: 10px; padding: 10px 12px;
        margin: 10px 0 0;
      }
      .le-item-acoes { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
      .le-confirmar-remocao {
        display: inline-flex; align-items: center; gap: 8px;
        font-size: 14px; font-weight: 600; color: var(--erro-texto);
        flex-wrap: wrap;
      }

      @media (min-width: 640px) {
        .le-duas-colunas { grid-template-columns: 1fr 1fr; }
        .le-barra-filtros { flex-direction: row; align-items: center; }
        .le-barra-filtros .campo { flex: 1; }
      }
    `}</style>
  );
}
