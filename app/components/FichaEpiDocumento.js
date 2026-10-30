// ============================================================================
// FICHA DE CONTROLE DE EPI — a folha impressa (uma página, como o modelo)
// ============================================================================
// Usada na prévia da tela e na impressão. Os textos ficam em lib/fichasEpi.js.
// A folha cabe numa página A4 ou Carta, com margem de 12 mm.
// ============================================================================

import {
  BASE_LEGAL, LINHAS_FICHA, TERMO_FIM, TERMO_INICIO, TERMO_ITENS, dataDaFicha, linhaPreenchida,
} from '../../lib/fichasEpi';

export function FichaEpiDocumento({ ficha, cidade }) {
  const itens = (ficha?.itens || []).filter(linhaPreenchida).slice(0, LINHAS_FICHA);
  const linhas = [...itens, ...Array.from({ length: LINHAS_FICHA - itens.length }, () => null)];
  const data = dataDaFicha(ficha?.data_entrega);
  return (
    <div className="epi-folha">
      <table className="epi-tabela epi-cabecalho">
        <colgroup><col style={{ width: '33%' }} /><col style={{ width: '24%' }} /><col style={{ width: '43%' }} /></colgroup>
        <tbody>
          <tr>
            <td className="epi-titulo">FICHA DE CONTROLE<br />DE EPI</td>
            <td className="epi-base">
              <strong>BASE LEGAL:</strong>
              {BASE_LEGAL.map((l) => <span key={l}>{l}</span>)}
            </td>
            <td className="epi-hotel"><span>{ficha?.hotel_nome || ''}</span></td>
          </tr>
        </tbody>
      </table>
      <table className="epi-tabela epi-pessoa">
        <colgroup><col style={{ width: '57%' }} /><col style={{ width: '21%' }} /><col style={{ width: '22%' }} /></colgroup>
        <tbody>
          <tr>
            <td><span className="epi-rotulo">NOME:</span><span className="epi-valor epi-nome">{ficha?.colaborador_nome || ''}</span></td>
            <td><span className="epi-rotulo">FUNÇÃO:</span><span className="epi-valor">{ficha?.funcao || ''}</span></td>
            <td><span className="epi-rotulo">SETOR:</span><span className="epi-valor">{ficha?.setor || ''}</span></td>
          </tr>
        </tbody>
      </table>
      <div className="epi-termo">
        <div className="epi-termo-titulo">TERMO DE RESPONSABILIDADE</div>
        <p>{TERMO_INICIO}</p>
        <ol type="A">{TERMO_ITENS.map((t) => <li key={t}>{t}</li>)}</ol>
        <p>{TERMO_FIM}</p>
        <div className="epi-assinatura"><span>Assinatura do empregado</span></div>
      </div>
      <table className="epi-tabela epi-itens">
        <colgroup>
          <col style={{ width: '14%' }} /><col style={{ width: '41%' }} />
          <col style={{ width: '15%' }} /><col style={{ width: '15%' }} /><col style={{ width: '15%' }} />
        </colgroup>
        <thead>
          <tr>
            <th rowSpan={2}>Quantidade</th>
            <th rowSpan={2}>DESCRIÇÃO DO EPI</th>
            <th colSpan={2}>DADOS</th>
            <th rowSpan={2}>ANVISA</th>
          </tr>
          <tr>
            <th className="epi-sub">DATA<br />VALIDADE</th>
            <th className="epi-sub">CA<br />NUMERO</th>
          </tr>
        </thead>
        <tbody>
          {linhas.map((it, i) => (
            // eslint-disable-next-line react/no-array-index-key
            <tr key={i}>
              <td>{it?.quantidade || ''}</td>
              <td>{it?.descricao || ''}</td>
              <td>{it?.validade || ''}</td>
              <td>{it?.ca || ''}</td>
              <td>{it?.anvisa || ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="epi-data">{cidade || 'João Pessoa'}, {data}.</p>
    </div>
  );
}

export const ESTILOS_FICHA_EPI = `
  .epi-folha { font-family: Arial, Helvetica, sans-serif; color: #000; background: #fff; font-size: 9pt; line-height: 1.2; }
  .epi-folha * { box-sizing: border-box; }
  .epi-tabela { width: 100%; border-collapse: collapse; table-layout: fixed; }
  .epi-tabela td, .epi-tabela th { border: 0.8pt solid #000; vertical-align: top; overflow: hidden; overflow-wrap: anywhere; }
  .epi-cabecalho td { height: 15mm; padding: 1.5mm 2mm; vertical-align: middle; }
  .epi-titulo { text-align: center; font-weight: 700; font-size: 13pt; line-height: 1.15; }
  .epi-base { font-size: 6.8pt; font-weight: 700; line-height: 1.25; }
  .epi-base span { display: block; }
  .epi-hotel { font-weight: 700; font-size: 12.5pt; }
  .epi-hotel span { text-decoration: underline; }
  .epi-pessoa td { border-top: none; height: 10mm; padding: 0.8mm 2mm; }
  .epi-rotulo { display: block; font-size: 6.8pt; font-weight: 700; }
  .epi-valor { display: block; font-size: 10pt; font-weight: 700; padding-top: 0.6mm; }
  .epi-nome { padding-left: 14mm; }
  .epi-termo { border: 0.8pt solid #000; border-top: none; padding: 1.2mm 2mm 1.5mm; font-weight: 700; font-size: 9pt; }
  .epi-termo p { margin: 0; }
  .epi-termo-titulo { text-align: center; font-size: 12pt; margin-bottom: 0.6mm; }
  .epi-termo ol { margin: 0.4mm 0 0.4mm 7mm; padding: 0; font-size: 7.6pt; }
  .epi-termo li { padding-left: 1.5mm; }
  .epi-assinatura { display: flex; justify-content: flex-end; padding-top: 8mm; }
  .epi-assinatura span { width: 92mm; border-top: 0.8pt dashed #000; text-align: center; padding-top: 0.6mm; font-size: 8pt; }
  .epi-itens { border-top: none; }
  .epi-itens thead tr:first-child th { border-top: none; }
  .epi-itens th { font-size: 9.5pt; font-weight: 700; text-align: center; vertical-align: middle; padding: 0.8mm 1mm; }
  .epi-itens th.epi-sub { font-size: 7.6pt; line-height: 1.15; }
  .epi-itens td { height: 6.5mm; padding: 0.4mm 1.5mm; text-align: center; vertical-align: middle; font-weight: 700; font-size: 10pt; white-space: nowrap; text-overflow: ellipsis; }
  .epi-itens td:nth-child(2) { text-align: left; }
  .epi-data { margin: 7mm 0 0 14mm; font-weight: 700; font-size: 9pt; }
`;
