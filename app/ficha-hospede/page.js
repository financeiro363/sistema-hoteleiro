'use client';

// ============================================================================
// FICHA FNRH (Ficha Nacional de Registro de Hóspedes) — PÁGINA PÚBLICA
// ============================================================================
// Acesso: /ficha-hospede?hotel_id=NÚMERO — sem necessidade de login. Pensada
// para ser compartilhada com o hóspede antes da chegada (por WhatsApp,
// e-mail, ou um QR code na recepção).
// ============================================================================

import { useEffect, useState, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { supabase } from '../../lib/supabaseClient';

const GENEROS = ['Masculino', 'Feminino', 'Outro', 'Prefiro não informar'];
const MOTIVOS_VIAGEM = [
  { valor: 'LAZER', rotulo: 'Lazer' }, { valor: 'NEGOCIOS', rotulo: 'Negócios' },
  { valor: 'EVENTOS', rotulo: 'Eventos' }, { valor: 'PARENTES', rotulo: 'Visita a parentes' },
  { valor: 'SAUDE', rotulo: 'Saúde' }, { valor: 'OUTRO', rotulo: 'Outro' },
];
const MEIOS_TRANSPORTE = [
  { valor: 'AVIAO', rotulo: 'Avião' }, { valor: 'AUTOMOVEL', rotulo: 'Automóvel' },
  { valor: 'ONIBUS', rotulo: 'Ônibus' }, { valor: 'TREM', rotulo: 'Trem' }, { valor: 'OUTRO', rotulo: 'Outro' },
];

function formatarCPF(texto) {
  const d = String(texto || '').replace(/\D/g, '').slice(0, 11);
  if (d.length <= 3) return d;
  if (d.length <= 6) return `${d.slice(0, 3)}.${d.slice(3)}`;
  if (d.length <= 9) return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6)}`;
  return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
}
function validarCPF(cpf) {
  const d = String(cpf || '').replace(/\D/g, '');
  if (d.length !== 11) return false;
  if (/^(\d)\1{10}$/.test(d)) return false;
  let soma = 0;
  for (let i = 0; i < 9; i++) soma += Number(d[i]) * (10 - i);
  let dv1 = (soma * 10) % 11; if (dv1 === 10) dv1 = 0;
  if (dv1 !== Number(d[9])) return false;
  soma = 0;
  for (let i = 0; i < 10; i++) soma += Number(d[i]) * (11 - i);
  let dv2 = (soma * 10) % 11; if (dv2 === 10) dv2 = 0;
  return dv2 === Number(d[10]);
}
function formatarCEP(texto) {
  const d = String(texto || '').replace(/\D/g, '').slice(0, 8);
  if (d.length <= 5) return d;
  return `${d.slice(0, 5)}-${d.slice(5)}`;
}

export default function FichaHospedePagina() {
  return (
    <Suspense fallback={<main className="conteudo"><p className="texto-suave">Carregando…</p></main>}>
      <FichaHospede />
    </Suspense>
  );
}

function FichaHospede() {
  const parametros = useSearchParams();
  const hotelId = parametros.get('hotel_id');

  const [carregandoHotel, setCarregandoHotel] = useState(true);
  const [nomeHotel, setNomeHotel] = useState('');
  const [erroHotel, setErroHotel] = useState('');

  const [nomeCompleto, setNomeCompleto] = useState('');
  const [email, setEmail] = useState('');
  const [telefone, setTelefone] = useState('');
  const [dataNascimento, setDataNascimento] = useState('');
  const [genero, setGenero] = useState('');
  const [nacionalidade, setNacionalidade] = useState('Brasileira');
  const [profissao, setProfissao] = useState('');

  const [tipoDocumento, setTipoDocumento] = useState('CPF');
  const [numeroDocumento, setNumeroDocumento] = useState('');
  const [orgaoExpedidor, setOrgaoExpedidor] = useState('');

  const [cep, setCep] = useState('');
  const [endereco, setEndereco] = useState('');
  const [numeroEndereco, setNumeroEndereco] = useState('');
  const [complemento, setComplemento] = useState('');
  const [bairro, setBairro] = useState('');
  const [cidade, setCidade] = useState('');
  const [estado, setEstado] = useState('');
  const [pais, setPais] = useState('Brasil');

  const [motivoViagem, setMotivoViagem] = useState('LAZER');
  const [meioTransporte, setMeioTransporte] = useState('AUTOMOVEL');
  const [procedenciaPais, setProcedenciaPais] = useState('Brasil');
  const [procedenciaEstado, setProcedenciaEstado] = useState('');
  const [procedenciaCidade, setProcedenciaCidade] = useState('');
  const [destinoPais, setDestinoPais] = useState('Brasil');
  const [destinoEstado, setDestinoEstado] = useState('');
  const [destinoCidade, setDestinoCidade] = useState('');

  const [enviando, setEnviando] = useState(false);
  const [erroForm, setErroForm] = useState('');
  const [enviado, setEnviado] = useState(false);
  const [buscandoCpf, setBuscandoCpf] = useState(false);
  const [cpfEncontrado, setCpfEncontrado] = useState(false);
  const [buscandoCep, setBuscandoCep] = useState(false);
  const [cepEncontrado, setCepEncontrado] = useState(false);

  useEffect(() => {
    if (!hotelId) { setErroHotel('Link inválido — faltou identificar o hotel.'); setCarregandoHotel(false); return; }
    supabase.from('hoteis').select('nome_fantasia').eq('id', hotelId).single()
      .then(({ data, error }) => {
        if (error || !data) { setErroHotel('Não foi possível identificar o hotel deste link.'); }
        else { setNomeHotel(data.nome_fantasia); }
        setCarregandoHotel(false);
      });
  }, [hotelId]);

  // Busca automática dos dados pessoais assim que o CPF é digitado por completo
  async function buscarPorCpf(valorCpf) {
    const digitos = String(valorCpf || '').replace(/\D/g, '');
    if (digitos.length !== 11 || !validarCPF(digitos)) return;
    setBuscandoCpf(true);
    setCpfEncontrado(false);
    try {
      const resposta = await fetch(`/api/directd-cpf?cpf=${digitos}`);
      const dados = await resposta.json();
      if (resposta.ok && dados?.nomeCompleto) {
        setNomeCompleto(dados.nomeCompleto);
        if (dados.genero) setGenero(dados.genero);
        if (dados.dataNascimento) setDataNascimento(dados.dataNascimento);
        setCpfEncontrado(true);
      }
    } catch (e) { /* silencioso — a pessoa ainda pode preencher manualmente */ }
    setBuscandoCpf(false);
  }

  // Busca automática do endereço assim que o CEP é digitado por completo (ViaCEP)
  async function buscarPorCep(valorCep) {
    const digitos = String(valorCep || '').replace(/\D/g, '');
    if (digitos.length !== 8) return;
    setBuscandoCep(true);
    setCepEncontrado(false);
    try {
      const resposta = await fetch(`https://viacep.com.br/ws/${digitos}/json/`);
      const dados = await resposta.json();
      if (!dados?.erro) {
        setEndereco(dados.logradouro || '');
        setBairro(dados.bairro || '');
        setCidade(dados.localidade || '');
        setEstado(dados.uf || '');
        setCepEncontrado(true);
      }
    } catch (e) { /* silencioso — a pessoa ainda pode preencher manualmente */ }
    setBuscandoCep(false);
  }

  async function enviar(evento) {
    evento.preventDefault();
    if (enviando) return;
    setErroForm('');

    if (!nomeCompleto.trim()) { setErroForm('Informe seu nome completo.'); return; }
    if (!email.trim()) { setErroForm('Informe seu e-mail.'); return; }
    if (!telefone.trim()) { setErroForm('Informe seu telefone/WhatsApp.'); return; }
    if (!numeroDocumento.trim()) { setErroForm('Informe o número do documento.'); return; }
    if (tipoDocumento === 'CPF' && !validarCPF(numeroDocumento)) {
      setErroForm('O CPF informado não é válido — confira os números.'); return;
    }

    setEnviando(true);
    const { error } = await supabase.from('fichas_fnrh').insert({
      hotel_id: Number(hotelId),
      nome_completo: nomeCompleto.trim(), email: email.trim(), telefone: telefone.trim(),
      data_nascimento: dataNascimento || null, genero: genero || null,
      nacionalidade: nacionalidade.trim() || null, profissao: profissao.trim() || null,
      tipo_documento: tipoDocumento, numero_documento: numeroDocumento.trim(), orgao_expedidor: orgaoExpedidor.trim() || null,
      cep: cep.trim() || null, endereco: endereco.trim() || null, numero_endereco: numeroEndereco.trim() || null,
      complemento: complemento.trim() || null, bairro: bairro.trim() || null, cidade: cidade.trim() || null,
      estado: estado.trim() || null, pais: pais.trim() || null,
      motivo_viagem: motivoViagem, meio_transporte: meioTransporte,
      procedencia_pais: procedenciaPais.trim() || null, procedencia_estado: procedenciaEstado.trim() || null,
      procedencia_cidade: procedenciaCidade.trim() || null,
      destino_pais: destinoPais.trim() || null, destino_estado: destinoEstado.trim() || null,
      destino_cidade: destinoCidade.trim() || null,
    });
    setEnviando(false);

    if (error) { setErroForm('Não foi possível enviar. Detalhe técnico: ' + error.message); return; }
    setEnviado(true);
  }

  if (carregandoHotel) {
    return <main className="conteudo"><p className="texto-suave">Carregando…</p></main>;
  }

  if (erroHotel) {
    return <main className="conteudo"><div className="aviso-erro">{erroHotel}</div></main>;
  }

  if (enviado) {
    return (
      <main className="conteudo">
        <div className="cartao" style={{ textAlign: 'center', padding: '32px 20px', maxWidth: 520, margin: '40px auto' }}>
          <h1 style={{ fontSize: '1.4rem' }}>✅ Ficha enviada com sucesso!</h1>
          <p className="texto-suave">Obrigado por preencher seus dados para o <strong>{nomeHotel}</strong>. Nos vemos em breve!</p>
        </div>
      </main>
    );
  }

  return (
    <main className="conteudo">
      <EstilosFicha />
      <div style={{ maxWidth: 640, margin: '0 auto' }}>
        <span className="olho">Ficha Nacional de Registro de Hóspedes</span>
        <h1 style={{ marginBottom: 6 }}>{nomeHotel}</h1>
        <p className="texto-suave">Preencha seus dados abaixo — leva menos de 3 minutos.</p>

        <form className="cartao" onSubmit={enviar} style={{ marginTop: 16 }}>
          <div className="fnrh-secao">Documentação</div>
          <p className="texto-suave" style={{ fontSize: 13, marginTop: -4 }}>
            Comece digitando seu CPF — se encontrarmos seus dados, preenchemos o resto para você.
          </p>
          <div className="fnrh-duas">
            <div>
              <label className="rotulo">Tipo de documento</label>
              <select className="campo" value={tipoDocumento} onChange={(e) => { setTipoDocumento(e.target.value); setNumeroDocumento(''); setCpfEncontrado(false); }}>
                <option value="CPF">CPF</option>
                <option value="RG">RG</option>
                <option value="PASSAPORTE">Passaporte</option>
              </select>
            </div>
            <div>
              <label className="rotulo">Número do documento *</label>
              <input className="campo" type="text" inputMode={tipoDocumento === 'CPF' ? 'numeric' : 'text'} value={numeroDocumento}
                onChange={(e) => {
                  const novoValor = tipoDocumento === 'CPF' ? formatarCPF(e.target.value) : e.target.value;
                  setNumeroDocumento(novoValor);
                  setCpfEncontrado(false);
                  if (tipoDocumento === 'CPF') buscarPorCpf(novoValor);
                }}
                placeholder={tipoDocumento === 'CPF' ? '000.000.000-00' : ''} />
              {tipoDocumento === 'CPF' && buscandoCpf && <p className="fnrh-buscando">🔎 Buscando seus dados…</p>}
              {tipoDocumento === 'CPF' && !buscandoCpf && cpfEncontrado && <p className="fnrh-doc-ok">✓ Dados encontrados e preenchidos abaixo!</p>}
              {tipoDocumento === 'CPF' && !buscandoCpf && !cpfEncontrado && numeroDocumento.trim() && (
                validarCPF(numeroDocumento)
                  ? <p className="fnrh-doc-ok">✓ CPF válido</p>
                  : <p className="fnrh-doc-erro">✗ CPF inválido</p>
              )}
            </div>
          </div>
          <label className="rotulo">Órgão expedidor (se RG)</label>
          <input className="campo" type="text" value={orgaoExpedidor} onChange={(e) => setOrgaoExpedidor(e.target.value)} placeholder="Ex.: SSP/PB" />

          <div className="fnrh-secao">Dados pessoais</div>
          <label className="rotulo">Nome completo *{cpfEncontrado && <span className="fnrh-travado"> 🔒 preenchido automaticamente</span>}</label>
          <input className="campo" type="text" value={nomeCompleto} onChange={(e) => setNomeCompleto(e.target.value)} readOnly={cpfEncontrado} />
          <div className="fnrh-duas">
            <div>
              <label className="rotulo">E-mail *</label>
              <input className="campo" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div>
              <label className="rotulo">Telefone / WhatsApp *</label>
              <input className="campo" type="tel" value={telefone} onChange={(e) => setTelefone(e.target.value)} placeholder="(00) 90000-0000" />
            </div>
          </div>
          <div className="fnrh-duas">
            <div>
              <label className="rotulo">Data de nascimento{cpfEncontrado && <span className="fnrh-travado"> 🔒</span>}</label>
              <input className="campo" type="date" value={dataNascimento} onChange={(e) => setDataNascimento(e.target.value)} readOnly={cpfEncontrado} />
            </div>
            <div>
              <label className="rotulo">Gênero{cpfEncontrado && <span className="fnrh-travado"> 🔒</span>}</label>
              <select className="campo" value={genero} onChange={(e) => setGenero(e.target.value)} disabled={cpfEncontrado}>
                <option value="">Selecione…</option>
                {GENEROS.map((g) => <option key={g} value={g}>{g}</option>)}
              </select>
            </div>
          </div>
          <div className="fnrh-duas">
            <div>
              <label className="rotulo">Nacionalidade</label>
              <input className="campo" type="text" value={nacionalidade} onChange={(e) => setNacionalidade(e.target.value)} />
            </div>
            <div>
              <label className="rotulo">Profissão</label>
              <input className="campo" type="text" value={profissao} onChange={(e) => setProfissao(e.target.value)} />
            </div>
          </div>

          <div className="fnrh-secao">Residência permanente</div>
          <div className="fnrh-duas">
            <div>
              <label className="rotulo">CEP</label>
              <input className="campo" type="text" inputMode="numeric" value={cep}
                onChange={(e) => { const novoValor = formatarCEP(e.target.value); setCep(novoValor); buscarPorCep(novoValor); }} />
              {buscandoCep && <p className="fnrh-buscando">🔎 Buscando endereço…</p>}
              {!buscandoCep && cepEncontrado && <p className="fnrh-doc-ok">✓ Endereço encontrado!</p>}
            </div>
            <div>
              <label className="rotulo">Endereço{cepEncontrado && <span className="fnrh-travado"> 🔒</span>}</label>
              <input className="campo" type="text" value={endereco} onChange={(e) => setEndereco(e.target.value)} readOnly={cepEncontrado} />
            </div>
          </div>
          <div className="fnrh-duas">
            <div>
              <label className="rotulo">Número</label>
              <input className="campo" type="text" value={numeroEndereco} onChange={(e) => setNumeroEndereco(e.target.value)} />
            </div>
            <div>
              <label className="rotulo">Complemento</label>
              <input className="campo" type="text" value={complemento} onChange={(e) => setComplemento(e.target.value)} />
            </div>
          </div>
          <div className="fnrh-duas">
            <div>
              <label className="rotulo">Bairro{cepEncontrado && <span className="fnrh-travado"> 🔒</span>}</label>
              <input className="campo" type="text" value={bairro} onChange={(e) => setBairro(e.target.value)} readOnly={cepEncontrado} />
            </div>
            <div>
              <label className="rotulo">Cidade{cepEncontrado && <span className="fnrh-travado"> 🔒</span>}</label>
              <input className="campo" type="text" value={cidade} onChange={(e) => setCidade(e.target.value)} readOnly={cepEncontrado} />
            </div>
          </div>
          <div className="fnrh-duas">
            <div>
              <label className="rotulo">Estado{cepEncontrado && <span className="fnrh-travado"> 🔒</span>}</label>
              <input className="campo" type="text" value={estado} onChange={(e) => setEstado(e.target.value)} readOnly={cepEncontrado} />
            </div>
            <div>
              <label className="rotulo">País{cepEncontrado && <span className="fnrh-travado"> 🔒</span>}</label>
              <input className="campo" type="text" value={pais} onChange={(e) => setPais(e.target.value)} readOnly={cepEncontrado} />
            </div>
          </div>

          <div className="fnrh-secao">Dados da viagem</div>
          <div className="fnrh-duas">
            <div>
              <label className="rotulo">Motivo da viagem</label>
              <select className="campo" value={motivoViagem} onChange={(e) => setMotivoViagem(e.target.value)}>
                {MOTIVOS_VIAGEM.map((m) => <option key={m.valor} value={m.valor}>{m.rotulo}</option>)}
              </select>
            </div>
            <div>
              <label className="rotulo">Meio de transporte</label>
              <select className="campo" value={meioTransporte} onChange={(e) => setMeioTransporte(e.target.value)}>
                {MEIOS_TRANSPORTE.map((m) => <option key={m.valor} value={m.valor}>{m.rotulo}</option>)}
              </select>
            </div>
          </div>
          <p className="rotulo" style={{ marginTop: 10 }}>De onde você está vindo</p>
          <div className="fnrh-tres">
            <input className="campo" type="text" value={procedenciaPais} onChange={(e) => setProcedenciaPais(e.target.value)} placeholder="País" />
            <input className="campo" type="text" value={procedenciaEstado} onChange={(e) => setProcedenciaEstado(e.target.value)} placeholder="Estado" />
            <input className="campo" type="text" value={procedenciaCidade} onChange={(e) => setProcedenciaCidade(e.target.value)} placeholder="Cidade" />
          </div>
          <p className="rotulo" style={{ marginTop: 10 }}>Para onde você vai depois</p>
          <div className="fnrh-tres">
            <input className="campo" type="text" value={destinoPais} onChange={(e) => setDestinoPais(e.target.value)} placeholder="País" />
            <input className="campo" type="text" value={destinoEstado} onChange={(e) => setDestinoEstado(e.target.value)} placeholder="Estado" />
            <input className="campo" type="text" value={destinoCidade} onChange={(e) => setDestinoCidade(e.target.value)} placeholder="Cidade" />
          </div>

          {erroForm && <div className="aviso-erro">{erroForm}</div>}
          <button type="submit" className="botao botao-principal" disabled={enviando} style={{ marginTop: 16, width: '100%' }}>
            {enviando ? 'Enviando…' : 'Enviar Ficha'}
          </button>
        </form>
      </div>
    </main>
  );
}

function EstilosFicha() {
  return (
    <style>{`
      .fnrh-secao { font-size: 14px; font-weight: 700; color: var(--marca); margin: 18px 0 8px; border-top: 1px solid var(--borda); padding-top: 14px; }
      .fnrh-secao:first-child { margin-top: 0; border-top: none; padding-top: 0; }
      .fnrh-duas { display: grid; grid-template-columns: 1fr; gap: 0 14px; }
      .fnrh-tres { display: grid; grid-template-columns: 1fr; gap: 10px; margin-bottom: 10px; }
      .fnrh-doc-ok { color: var(--sucesso-texto); font-weight: 700; font-size: 12px; margin: 4px 0 0; }
      .fnrh-buscando { color: var(--texto-suave); font-weight: 600; font-size: 12px; margin: 4px 0 0; }
      .fnrh-travado { color: var(--texto-suave); font-weight: 400; font-size: 12px; }
      input[readonly].campo, select:disabled.campo { background: var(--fundo); color: var(--tinta); cursor: not-allowed; }
      .fnrh-doc-erro { color: var(--erro-texto); font-weight: 700; font-size: 12px; margin: 4px 0 0; }
      @media (min-width: 640px) {
        .fnrh-duas { grid-template-columns: 1fr 1fr; }
        .fnrh-tres { grid-template-columns: 1fr 1fr 1fr; }
      }
    `}</style>
  );
}
