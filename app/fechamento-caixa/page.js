'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '../../lib/supabaseClient';
import { bloquearSeNaoPermitido } from '../../lib/restricaoAcesso';

// "Hoje" e "ontem" sempre no horário de Fortaleza/Paraíba (UTC-3), igual
// para a tela e para o servidor — assim os dois nunca discordam, não
// importa o relógio de onde o código esteja rodando.
const FUSO_HOTEL = 'America/Fortaleza';
function hojeISO() {
  return new Date().toLocaleDateString('en-CA', { timeZone: FUSO_HOTEL });
}
function ontemISO() {
  const [a, m, d] = hojeISO().split('-').map(Number);
  const ontem = new Date(Date.UTC(a, m - 1, d - 1));
  return ontem.toISOString().slice(0, 10);
}
function dinheiro(v) { return Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }); }
function formatarDataBR(iso) {
  if (!iso) return '—';
  const [ano, mes, dia] = iso.split('-');
  return `${dia}/${mes}/${ano}`;
}

export default function FechamentoCaixa() {
  const router = useRouter();
  const [verificandoLogin, setVerificandoLogin] = useState(true);
  const [usuario, setUsuario] = useState(null);
  const [nomeHotel, setNomeHotel] = useState('');

  const [data, setData] = useState(hojeISO());
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState('');
  const [resultado, setResultado] = useState(null);

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
      if (bloquearSeNaoPermitido(dadosUsuario.papel, router)) return;
      if (dadosUsuario.hotel_id) {
        const { data: hotel } = await supabase.from('hoteis').select('nome_fantasia').eq('id', dadosUsuario.hotel_id).single();
        if (ativo && hotel?.nome_fantasia) setNomeHotel(hotel.nome_fantasia);
      }
      setVerificandoLogin(false);
    }
    verificar();
    return () => { ativo = false; };
  }, [router]);

  async function buscar(dataParaBuscar) {
    setCarregando(true);
    setErro('');
    setResultado(null);
    const { data: sessao } = await supabase.auth.getSession();
    try {
      const resposta = await fetch(`/api/fechamento-caixa-listar?data=${dataParaBuscar}`, {
        headers: { Authorization: `Bearer ${sessao.session.access_token}` },
      });
      const resultadoJson = await resposta.json();
      setCarregando(false);
      if (!resposta.ok || resultadoJson.erro) { setErro(resultadoJson.erro || 'Não foi possível buscar.'); return; }
      setResultado(resultadoJson);
    } catch (e) {
      setCarregando(false);
      setErro('Falha de conexão com o servidor.');
    }
  }

  if (verificandoLogin) {
    return <main className="conteudo"><p className="texto-suave">Verificando seu acesso…</p></main>;
  }

  const souAdmin = usuario.papel === 'ADMIN';

  if (!souAdmin && !usuario.pode_acessar_fechamento_caixa) {
    return (
      <main className="conteudo">
        <span className="olho">Operações</span>
        <h1>Fechamento de Caixa</h1>
        <div className="cartao" style={{ textAlign: 'center', color: 'var(--texto-suave)' }}>
          Você ainda não tem permissão pra acessar o Fechamento de Caixa. Peça pro administrador
          liberar em Administração → Usuários.
        </div>
      </main>
    );
  }

  return (
    <main className="conteudo fc-conteudo" style={{ maxWidth: 900 }}>
      <EstilosFechamento />

      {/* ---- Área normal de tela (some na impressão) ---- */}
      <div className="fc-somente-tela">
        <span className="olho">Operações</span>
        <h1>Fechamento de Caixa</h1>

        <div className="cartao" style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div>
            <label className="rotulo">Data</label>
            <input className="campo" type="date" value={data}
              min={souAdmin ? undefined : ontemISO()}
              max={souAdmin ? undefined : hojeISO()}
              onChange={(e) => setData(e.target.value)} />
          </div>
          <button type="button" className="botao botao-principal" onClick={() => buscar(data)} disabled={carregando}>
            {carregando ? 'Buscando…' : 'Buscar'}
          </button>
          {resultado && (
            <button type="button" className="botao botao-suave" onClick={() => window.print()}>
              🖨️ Imprimir Folha de Fechamento
            </button>
          )}
          {!souAdmin && (
            <span className="texto-suave" style={{ fontSize: 12 }}>Você só pode consultar hoje ou ontem.</span>
          )}
        </div>

        {erro && <div className="aviso-erro" style={{ marginTop: 14 }}>{erro}</div>}
      </div>

      {/* ---- Conteúdo (aparece na tela E na impressão) ---- */}
      {resultado && (
        <div className="fc-folha">
          <div className="fc-cabecalho-impressao">
            <h2 style={{ margin: 0 }}>Fechamento de Caixa — {nomeHotel}</h2>
            <p style={{ margin: '2px 0 0', color: '#666' }}>Data: {formatarDataBR(resultado.data)}</p>
          </div>

          {resultado.avisoCloudbeds && (
            <div className="aviso-erro" style={{ marginBottom: 12 }}>
              <strong>Atenção — os valores da Cloudbeds não foram carregados:</strong> {resultado.avisoCloudbeds}{' '}
              O total abaixo inclui apenas os pagamentos da Sala de Reunião.
            </div>
          )}
          {resultado.avisoSalaReuniao && (
            <div className="aviso-erro fc-somente-tela" style={{ marginBottom: 12 }}>
              <strong>Atenção:</strong> {resultado.avisoSalaReuniao}
            </div>
          )}

          <div className="fc-cards-resumo">
            <div className="fc-card-resumo">
              <span className="fc-card-numero">{dinheiro(resultado.totalGeral)}</span>
              <span className="fc-card-rotulo">Total recebido no dia</span>
            </div>
            <div className="fc-card-resumo">
              <span className="fc-card-numero">{dinheiro(resultado.totalSalaReuniao)}</span>
              <span className="fc-card-rotulo">Sala de Reunião (já incluído no total)</span>
            </div>
            <div className="fc-card-resumo">
              <span className="fc-card-numero">{dinheiro(resultado.totalEstornos)}</span>
              <span className="fc-card-rotulo">Total em estornos</span>
            </div>
          </div>

          <h3>Totais por forma de pagamento</h3>
          <table className="fc-tabela">
            <thead>
              <tr><th>Forma de pagamento</th><th style={{ textAlign: 'right' }}>Total</th></tr>
            </thead>
            <tbody>
              {Object.entries(resultado.totaisPorForma).sort((a, b) => b[1] - a[1]).map(([forma, total]) => (
                <tr key={forma}><td>{forma}</td><td style={{ textAlign: 'right' }}>{dinheiro(total)}</td></tr>
              ))}
              {Object.entries(resultado.totaisSalaPorForma || {}).sort((a, b) => b[1] - a[1]).map(([forma, total]) => (
                <tr key={`sala-${forma}`} className="fc-linha-sala">
                  <td><span className="fc-selo-sala">Sala de Reunião</span> {forma}</td>
                  <td style={{ textAlign: 'right' }}>{dinheiro(total)}</td>
                </tr>
              ))}
              {Object.keys(resultado.totaisPorForma).length === 0 && Object.keys(resultado.totaisSalaPorForma || {}).length === 0 && (
                <tr><td colSpan={2} style={{ textAlign: 'center', color: '#888' }}>Nenhum pagamento nesse dia.</td></tr>
              )}
            </tbody>
            <tfoot>
              <tr><td><strong>Total geral</strong></td><td style={{ textAlign: 'right' }}><strong>{dinheiro(resultado.totalGeral)}</strong></td></tr>
            </tfoot>
          </table>

          <h3>Lançamentos detalhados</h3>
          <table className="fc-tabela fc-tabela-detalhe">
            <thead>
              <tr><th>Horário</th><th>Forma de pagamento</th><th>Apartamento</th><th>Usuário</th><th style={{ textAlign: 'right' }}>Valor</th></tr>
            </thead>
            <tbody>
              {resultado.pagamentos.map((l) => (
                <tr key={l.id} style={l.tipo === 'ANULADO' ? { color: '#A31212', textDecoration: 'line-through' } : undefined}>
                  <td>{l.horario}</td>
                  <td>{l.formaPagamento}{l.tipo === 'ANULADO' ? ' (anulado)' : ''}</td>
                  <td>{l.apartamento}</td>
                  <td>{l.usuario}</td>
                  <td style={{ textAlign: 'right' }}>{dinheiro(l.valor)}</td>
                </tr>
              ))}
              {resultado.pagamentos.length === 0 && (
                <tr><td colSpan={5} style={{ textAlign: 'center', color: '#888' }}>Nenhum lançamento nesse dia.</td></tr>
              )}
            </tbody>
          </table>

          <h3>🏛️ Sala de Reunião — pagamentos do dia</h3>
          <table className="fc-tabela fc-tabela-detalhe">
            <thead>
              <tr><th>Horário</th><th>Forma de pagamento</th><th>Sala / Cliente</th><th>Recibo</th><th>Usuário</th><th style={{ textAlign: 'right' }}>Valor</th></tr>
            </thead>
            <tbody>
              {(resultado.salaReuniao || []).map((l) => (
                <tr key={l.id} style={l.anulado ? { color: '#A31212', textDecoration: 'line-through' } : undefined}>
                  <td>{l.horario}</td>
                  <td>{l.formaPagamento}{l.anulado ? ' (anulado)' : ''}</td>
                  <td>{l.sala} — {l.cliente}</td>
                  <td>{l.recibo}</td>
                  <td>{l.usuario}</td>
                  <td style={{ textAlign: 'right' }}>{dinheiro(l.valor)}</td>
                </tr>
              ))}
              {(resultado.salaReuniao || []).length === 0 && (
                <tr><td colSpan={6} style={{ textAlign: 'center', color: '#888' }}>Nenhum pagamento da Sala de Reunião nesse dia.</td></tr>
              )}
            </tbody>
            <tfoot>
              <tr><td colSpan={5}><strong>Total Sala de Reunião</strong></td><td style={{ textAlign: 'right' }}><strong>{dinheiro(resultado.totalSalaReuniao)}</strong></td></tr>
            </tfoot>
          </table>
          {(resultado.salaReuniao || []).some((l) => l.anulado) && (
            <p style={{ fontSize: 12, color: '#666', marginTop: -12 }}>
              Pagamentos riscados foram anulados pelo administrador e não entram no total.
            </p>
          )}

          <h3>🚫 Abatimentos e estornos</h3>
          <table className="fc-tabela fc-tabela-detalhe">
            <thead>
              <tr><th>Horário</th><th>Forma de pagamento</th><th>Apartamento</th><th>Usuário</th><th style={{ textAlign: 'right' }}>Valor</th></tr>
            </thead>
            <tbody>
              {resultado.estornos.map((l) => (
                <tr key={l.id}>
                  <td>{l.horario}</td>
                  <td>{l.formaPagamento}</td>
                  <td>{l.apartamento}</td>
                  <td>{l.usuario}</td>
                  <td style={{ textAlign: 'right' }}>{dinheiro(l.valor)}</td>
                </tr>
              ))}
              {resultado.estornos.length === 0 && (
                <tr><td colSpan={5} style={{ textAlign: 'center', color: '#888' }}>Nenhum estorno/abatimento nesse dia.</td></tr>
              )}
            </tbody>
          </table>

          <div className="fc-assinatura fc-somente-impressao">
            <div className="fc-linha-assinatura">Assinatura de quem está passando o caixa</div>
            <div className="fc-linha-assinatura">Assinatura de quem está recebendo o caixa</div>
          </div>
        </div>
      )}
    </main>
  );
}

function EstilosFechamento() {
  return (
    <style>{`
      .fc-cards-resumo { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin: 14px 0; }
      @media (max-width: 640px) { .fc-cards-resumo { grid-template-columns: 1fr 1fr; } }
      .fc-selo-sala {
        display: inline-block; font-size: 11px; font-weight: 700; border-radius: 999px;
        padding: 1px 8px; margin-right: 4px; background: var(--marca-clara, #E3F0EC); color: var(--marca, #0E5A4E);
      }
      .fc-linha-sala td { background: rgba(14, 90, 78, 0.04); }
      .fc-card-resumo {
        background: var(--branco); border: 1px solid var(--borda); border-radius: 12px;
        padding: 14px; display: flex; flex-direction: column; gap: 2px;
      }
      .fc-card-numero { font-size: 22px; font-weight: 700; }
      .fc-card-rotulo { font-size: 12px; color: var(--texto-suave); text-transform: uppercase; letter-spacing: 0.02em; }

      .fc-tabela { width: 100%; border-collapse: collapse; margin-bottom: 20px; font-size: 14px; }
      .fc-tabela th, .fc-tabela td { border-bottom: 1px solid var(--borda); padding: 6px 8px; text-align: left; }
      .fc-tabela-detalhe { font-size: 13px; }
      .fc-tabela tfoot td { border-top: 2px solid #333; border-bottom: none; padding-top: 8px; }

      .fc-somente-impressao { display: none; }
      .fc-cabecalho-impressao { display: none; }

      @media print {
        .fc-somente-tela { display: none !important; }
        .fc-somente-impressao { display: block !important; }
        .fc-assinatura.fc-somente-impressao { display: flex !important; }
        .fc-cabecalho-impressao { display: block !important; margin-bottom: 14px; }
        nav, header, .cabecalho, .menu-principal { display: none !important; }
        .fc-conteudo { max-width: 100% !important; }
        .fc-tabela { page-break-inside: auto; }
        .fc-tabela tr { page-break-inside: avoid; }
        h3 { page-break-after: avoid; }
      }
      .fc-assinatura { display: flex; gap: 40px; margin-top: 50px; }
      .fc-linha-assinatura { flex: 1; border-top: 1px solid #333; padding-top: 6px; text-align: center; font-size: 12px; }
    `}</style>
  );
}
