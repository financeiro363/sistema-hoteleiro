'use client';

// ============================================================================
// DOCUMENTOS DO NOVO COLABORADOR (para tela de prévia e para impressão)
// ============================================================================
// 1) Contrato Individual de Trabalho a Título de Experiência
// 2) Manual de Procedimentos Internos (9 páginas, igual ao original)
// 3) Termo de Ciência e Aceite do Manual (página 9), já com nome e data
//
// Recebe "valores": { CAMPO: 'texto já formatado' }. Campo vazio sai como uma
// linha em branco, para preencher à mão.
// O texto do contrato fica em lib/contratoExperienciaModelo.js e o do manual
// em lib/manualProcedimentosModelo.js.
// ============================================================================

import { Fragment } from 'react';
import { CONTRATO_EXPERIENCIA_BLOCOS } from '../../lib/contratoExperienciaModelo';
import {
  MANUAL_PAGINAS, MANUAL_EMPRESAS, MANUAL_DATA_VERSAO, MANUAL_TOTAL_PAGINAS, MANUAL_VERSAO_PADRAO,
} from '../../lib/manualProcedimentosModelo';

// Troca cada {{CAMPO}} pelo valor (em negrito) ou por uma linha em branco
function comCampos(texto, valores) {
  return String(texto || '').split(/(\{\{[A-Z_]+\}\})/).map((parte, i) => {
    const m = parte.match(/^\{\{([A-Z_]+)\}\}$/);
    if (!m) return <Fragment key={i}>{parte}</Fragment>;
    const valor = valores[m[1]];
    if (valor) return <strong key={i} className="dc-valor">{valor}</strong>;
    return <span key={i} className="dc-vazio" aria-label="campo em branco" />;
  });
}

// **negrito** dentro do texto do manual
function comNegrito(texto) {
  return String(texto || '').split(/(\*\*[^*]+\*\*)/).map((parte, i) => (
    /^\*\*[^*]+\*\*$/.test(parte) ? <strong key={i}>{parte.slice(2, -2)}</strong> : <Fragment key={i}>{parte}</Fragment>
  ));
}

function LinhaAssinatura({ rotulo }) {
  return (
    <div className="dc-assinatura">
      <div className="dc-assinatura-linha" />
      <div className="dc-assinatura-rotulo">{rotulo}</div>
    </div>
  );
}

function Assinaturas({ bloco, valores }) {
  const localData = comCampos(bloco.x, valores);
  if (bloco.tipo === 'prorrogacao') {
    return (
      <>
        <p className="dc-local-data">{localData}</p>
        <div className="dc-assinaturas">
          <LinhaAssinatura rotulo="EMPREGADOR(A)" />
          <LinhaAssinatura rotulo="EMPREGADO(A)" />
          <LinhaAssinatura rotulo="TESTEMUNHA – CPF" />
          <LinhaAssinatura rotulo="TESTEMUNHA – CPF" />
        </div>
      </>
    );
  }
  return (
    <>
      <p className="dc-local-data">{localData}</p>
      <div className="dc-assinaturas">
        <LinhaAssinatura rotulo={<>EMPREGADOR(A) – {valores.EMPREGADOR_RAZAO_SOCIAL || ''}</>} />
        <LinhaAssinatura rotulo={<>EMPREGADO(A) – {valores.EMPREGADO_NOME || ''}</>} />
        <LinhaAssinatura rotulo="TESTEMUNHA 1 – Nome e CPF" />
        <LinhaAssinatura rotulo="TESTEMUNHA 2 – Nome e CPF" />
      </div>
    </>
  );
}

function Bloco({ bloco, valores, atribuicoes }) {
  switch (bloco.t) {
    case 'titulo_doc':
      return <h1 className="dc-titulo-doc">{bloco.x}</h1>;
    case 'titulo':
      return <h2 className="dc-titulo">{bloco.x}</h2>;
    case 'texto': {
      const m = bloco.x.match(/^(EMPREGADOR\(A\):|EMPREGADO\(A\):)\s*(.*)$/);
      if (m) return <p className="dc-p dc-qualificacao"><strong>{m[1]}</strong> {comCampos(m[2], valores)}</p>;
      return <p className="dc-p">{comCampos(bloco.x, valores)}</p>;
    }
    case 'clausula':
      return <p className="dc-p dc-clausula"><strong>{bloco.h}</strong> {comCampos(bloco.x, valores)}</p>;
    case 'par': {
      // Título curto no início do parágrafo (ex.: "Danos.", "Termo de Prorrogação.") sai em negrito
      const t = bloco.x.match(/^([A-ZÀ-Ú][^.()]{1,40}\.)\s+(?=[A-ZÀ-Ú{])/);
      if (t && t[1].split(' ').length <= 5) {
        return <p className="dc-p dc-par"><strong>{bloco.h} {t[1]}</strong> {comCampos(bloco.x.slice(t[0].length), valores)}</p>;
      }
      return <p className="dc-p dc-par"><strong>{bloco.h}</strong> {comCampos(bloco.x, valores)}</p>;
    }
    case 'item':
      return <p className="dc-p dc-item"><span className="dc-item-num">{bloco.h}</span>{comCampos(bloco.x, valores)}</p>;
    case 'atribuicoes':
      return atribuicoes
        ? <div className="dc-atribuicoes">{atribuicoes}</div>
        : <div className="dc-atribuicoes dc-atribuicoes-vazia"><span /><span /><span /><span /><span /></div>;
    case 'email_contracheque':
      return <p className="dc-destaque">{valores.EMPREGADO_EMAIL_CONTRACHEQUE ? <strong>{valores.EMPREGADO_EMAIL_CONTRACHEQUE}</strong> : <span className="dc-vazio dc-vazio-largo" />}</p>;
    case 'rubrica39':
      return <p className="dc-rubrica">{bloco.x} <span className="dc-linha-rubrica" /></p>;
    case 'assinaturas':
      return <Assinaturas bloco={bloco} valores={valores} />;
    default:
      return null;
  }
}

export function ContratoExperiencia({ valores, atribuicoes }) {
  const blocos = CONTRATO_EXPERIENCIA_BLOCOS;
  const saida = [];
  for (let i = 0; i < blocos.length; i += 1) {
    const b = blocos[i];
    const proximo = blocos[i + 1];
    // Termo de Prorrogação (§ 3º da Cláusula 5ª): texto + assinaturas numa caixa, sem quebrar
    const ehTermoProrrogacao = b.t === 'par' && b.x.startsWith('Termo de Prorrogação') && proximo?.t === 'assinaturas';
    // Fecho do contrato ("E, por estarem...") junto com as assinaturas finais
    const ehFecho = b.t === 'texto' && b.x.startsWith('E, por estarem') && proximo?.t === 'assinaturas';
    if (ehTermoProrrogacao || ehFecho) {
      saida.push(
        <div key={i} className={ehTermoProrrogacao ? 'dc-caixa dc-junto' : 'dc-fecho dc-junto'}>
          <Bloco bloco={b} valores={valores} atribuicoes={atribuicoes} />
          <Bloco bloco={proximo} valores={valores} atribuicoes={atribuicoes} />
        </div>
      );
      i += 1;
      continue;
    }
    // Título de seção nunca fica sozinho no pé da página
    if (b.t === 'titulo' && proximo) {
      saida.push(
        <div key={i} className="dc-junto">
          <Bloco bloco={b} valores={valores} atribuicoes={atribuicoes} />
          <Bloco bloco={proximo} valores={valores} atribuicoes={atribuicoes} />
        </div>
      );
      i += 1;
      continue;
    }
    saida.push(<Bloco key={i} bloco={b} valores={valores} atribuicoes={atribuicoes} />);
  }
  return <section className="dc-contrato">{saida}</section>;
}

function ItemManual({ item }) {
  const [tipo, a, b] = item;
  if (tipo === 'h2') return <h2 className="dc-mp-h2">{a}</h2>;
  if (tipo === 'h3') return <h3 className="dc-mp-h3">{a}</h3>;
  if (tipo === 'h4') return <h4 className="dc-mp-h4">{a}</h4>;
  if (tipo === 'p') return <p>{comNegrito(a)}</p>;
  if (tipo === 'ul') return <ul>{a.map((t, i) => <li key={i}>{comNegrito(t)}</li>)}</ul>;
  if (tipo === 'ol') return <ol>{a.map((t, i) => <li key={i}>{comNegrito(t)}</li>)}</ol>;
  if (tipo === 'alerta') return <div className="dc-mp-alerta"><strong>{a}</strong> {b}</div>;
  return null;
}

function PaginaManual({ numero, children, classe }) {
  return (
    <div className="dc-mp">
      <div className="dc-mp-topo">Manual de Procedimentos Internos · {MANUAL_EMPRESAS}</div>
      <div className={`dc-mp-corpo ${classe || ''}`}>{children}</div>
      <div className="dc-mp-rodape">Página {numero} de {MANUAL_TOTAL_PAGINAS}</div>
    </div>
  );
}

function TermoCiencia({ valores, numero }) {
  return (
    <PaginaManual numero={numero} classe="dc-mp-termo">
      <h2 className="dc-mp-h2">Termo de Ciência e Aceite</h2>
      <p>
        Eu, abaixo identificado, declaro que recebi da empresa contratante uma cópia do Manual de
        Procedimentos Internos do hotel, versão {valores.MANUAL_VERSAO || MANUAL_VERSAO_PADRAO}, composto
        por {valores.MANUAL_PAGINAS || '09 (nove)'} páginas.
      </p>
      <p>
        Comprometo-me a cumprir integralmente todas as normas e procedimentos deste manual. Estou ciente de
        que o descumprimento pode resultar nas medidas previstas na CLT e na Convenção Coletiva da categoria,
        podendo chegar à demissão por justa causa.
      </p>
      <p>
        Estou ciente também de que, em caso de atualização do manual, receberei a nova versão e assinarei um
        novo termo, sendo que a versão mais recente é a única que vale.
      </p>
      <div className="dc-termo-campos">
        <p><span>Nome completo:</span> {valores.EMPREGADO_NOME ? <strong>{valores.EMPREGADO_NOME}</strong> : <span className="dc-vazio dc-vazio-largo" />}</p>
        <p><span>Data:</span> {valores.DATA_TERMO ? <strong>{valores.DATA_TERMO}</strong> : <span className="dc-vazio" />}</p>
      </div>
      <div className="dc-termo-assinatura">
        <LinhaAssinatura rotulo="Assinatura do colaborador" />
      </div>
    </PaginaManual>
  );
}

export function ManualProcedimentos({ valores, incluirManual, incluirTermo }) {
  return (
    <section className="dc-manual">
      {MANUAL_PAGINAS.map((pagina, idx) => {
        const numero = idx + 1;
        if (pagina.termo) return incluirTermo ? <TermoCiencia key={idx} valores={valores} numero={numero} /> : null;
        if (!incluirManual) return null;
        if (pagina.capa) {
          return (
            <PaginaManual key={idx} numero={numero} classe="dc-mp-capa">
              <div className="dc-capa-titulo">MANUAL DE PROCEDIMENTOS INTERNOS</div>
              <div className="dc-capa-sub">Normas, Condutas e Procedimentos Operacionais</div>
              <div className="dc-capa-empresas">JR Hotel Ltda - Guarany Hotel Ltda</div>
              <div className="dc-capa-versao">
                Versão {valores.MANUAL_VERSAO || MANUAL_VERSAO_PADRAO} · {MANUAL_DATA_VERSAO}<br />
                Documento de uso interno · Confidencial
              </div>
            </PaginaManual>
          );
        }
        return (
          <PaginaManual key={idx} numero={numero}>
            {pagina.map((item, i) => <ItemManual key={i} item={item} />)}
          </PaginaManual>
        );
      })}
    </section>
  );
}

// Diminui a letra de uma página do manual só se o texto não couber na folha
// (garante que o manual continue com 9 páginas, como diz o Termo).
export function ajustarPaginasManual(raiz) {
  if (!raiz) return;
  raiz.querySelectorAll('.dc-mp-corpo').forEach((corpo) => {
    let tamanho = 10;
    corpo.style.fontSize = `${tamanho}pt`;
    while (corpo.scrollHeight > corpo.clientHeight + 1 && tamanho > 7) {
      tamanho -= 0.25;
      corpo.style.fontSize = `${tamanho}pt`;
    }
  });
}

// Estilos dos documentos (servem para a prévia na tela e para o papel)
export const ESTILOS_DOCUMENTOS = `
  .dc-docs { color: #111; font-family: Arial, Helvetica, sans-serif; }
  .dc-docs strong { font-weight: 700; }

  /* ---------- Contrato ---------- */
  .dc-contrato { page: contrato; font-size: 10.5pt; line-height: 1.42; text-align: justify; hyphens: auto; }
  .dc-titulo-doc { font-size: 13pt; text-align: center; margin: 0 0 14pt; letter-spacing: 0.02em; font-family: Arial, Helvetica, sans-serif; }
  .dc-titulo { font-size: 10.5pt; text-align: center; margin: 14pt 0 6pt; padding: 4pt 0; border-top: 1.2pt solid #111; border-bottom: 0.6pt solid #111; text-transform: uppercase; letter-spacing: 0.03em; font-family: Arial, Helvetica, sans-serif; }
  .dc-p { margin: 0 0 5pt; orphans: 3; widows: 3; }
  .dc-qualificacao { margin-bottom: 7pt; }
  .dc-clausula { margin-top: 8pt; }
  .dc-par { padding-left: 0; }
  .dc-item { display: flex; gap: 6pt; padding-left: 12pt; }
  .dc-item-num { min-width: 14pt; font-weight: 700; }
  .dc-valor { font-weight: 700; }
  .dc-vazio { display: inline-block; min-width: 38mm; border-bottom: 0.7pt solid #111; height: 1em; vertical-align: -0.15em; }
  .dc-vazio-largo { min-width: 90mm; }
  .dc-atribuicoes { white-space: pre-wrap; margin: 2pt 0 7pt 12pt; padding: 5pt 8pt; border-left: 2pt solid #888; text-align: left; }
  .dc-atribuicoes-vazia { display: flex; flex-direction: column; gap: 14pt; padding-top: 12pt; }
  .dc-atribuicoes-vazia span { display: block; border-bottom: 0.7pt solid #111; }
  .dc-destaque { margin: 2pt 0 8pt 12pt; }
  .dc-rubrica { margin: 8pt 0; padding: 6pt 8pt; border: 0.8pt solid #111; font-weight: 700; }
  .dc-linha-rubrica { display: inline-block; width: 55mm; border-bottom: 0.8pt solid #111; height: 1.4em; vertical-align: -0.3em; margin-left: 6pt; }
  .dc-caixa { border: 0.8pt solid #111; padding: 8pt 10pt; margin: 6pt 0 8pt; }
  .dc-junto { break-inside: avoid; page-break-inside: avoid; }
  .dc-fecho { margin-top: 10pt; }
  .dc-local-data { text-align: right; margin: 8pt 0 4pt; }
  .dc-assinaturas { display: grid; grid-template-columns: 1fr 1fr; column-gap: 14mm; row-gap: 4pt; }
  .dc-assinatura { padding-top: 24pt; text-align: center; font-size: 9pt; line-height: 1.3; }
  .dc-assinatura-linha { border-top: 0.8pt solid #111; margin-bottom: 3pt; }

  /* ---------- Manual (cada página = 1 folha A4) ---------- */
  .dc-manual { page: manual; }
  .dc-mp { width: 210mm; height: 296mm; padding: 10mm 18mm 9mm; display: flex; flex-direction: column; background: #fff; overflow: hidden; font-family: Arial, Helvetica, sans-serif; color: #111; break-after: page; page-break-after: always; }
  .dc-mp:last-child { break-after: auto; page-break-after: auto; }
  .dc-mp-topo { text-align: right; font-size: 7.5pt; color: #666; padding-bottom: 6mm; }
  .dc-mp-rodape { text-align: center; font-size: 7.5pt; color: #666; padding-top: 4mm; }
  .dc-mp-corpo { flex: 1; min-height: 0; overflow: hidden; font-size: 10pt; line-height: 1.38; text-align: justify; }
  .dc-mp-corpo p { margin: 0 0 4pt; }
  .dc-mp-corpo ul, .dc-mp-corpo ol { margin: 0 0 5pt; padding-left: 20pt; }
  .dc-mp-corpo li { margin-bottom: 1.5pt; }
  .dc-mp-h2 { font-size: 1.45em; margin: 10pt 0 5pt; font-family: Arial, Helvetica, sans-serif; }
  .dc-mp-corpo > .dc-mp-h2:first-child, .dc-mp-corpo > .dc-mp-h3:first-child { margin-top: 0; }
  .dc-mp-h3 { font-size: 1.1em; margin: 8pt 0 3pt; font-family: Arial, Helvetica, sans-serif; }
  .dc-mp-h4 { font-size: 1em; margin: 6pt 0 3pt; font-family: Arial, Helvetica, sans-serif; }
  .dc-mp-alerta { border-left: 3pt solid #111; background: #f1f1f1; padding: 5pt 8pt; margin: 3pt 0 6pt; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .dc-mp-capa { display: flex; flex-direction: column; align-items: center; text-align: center; }
  .dc-capa-titulo { margin-top: 62mm; font-size: 17pt; font-weight: 700; }
  .dc-capa-sub { margin-top: 3mm; font-size: 11pt; }
  .dc-capa-empresas { margin-top: 2mm; font-size: 9.5pt; font-style: italic; }
  .dc-capa-versao { margin-top: 48mm; font-size: 9pt; line-height: 1.6; }
  .dc-mp-termo p { margin-bottom: 9pt; }
  .dc-mp-termo .dc-mp-h2 { margin-bottom: 12pt; }
  .dc-termo-campos { margin-top: 18pt; }
  .dc-termo-campos p { margin-bottom: 14pt; }
  .dc-termo-campos p > span:first-child { display: inline-block; min-width: 30mm; }
  .dc-termo-assinatura { width: 90mm; margin: 30pt auto 0; font-size: 10pt; }

  /* ---------- Folhas de papel ---------- */
  @page contrato {
    size: A4;
    margin: 16mm 16mm 18mm 18mm;
    @bottom-left { content: "Contrato de Experiência · Página " counter(page); font-family: Arial, sans-serif; font-size: 7.5pt; color: #555; }
    @bottom-right { content: "Rubricas: ____________  ____________"; font-family: Arial, sans-serif; font-size: 7.5pt; color: #555; }
  }
  @page manual { size: A4; margin: 0; }
`;
