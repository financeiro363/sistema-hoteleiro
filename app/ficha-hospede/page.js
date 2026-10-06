'use client';

// ============================================================================
// FICHA FNRH (Ficha Nacional de Registro de Hóspedes) — PÁGINA PÚBLICA
// ============================================================================
// Acesso: /ficha-hospede?hotel_id=NÚMERO — sem necessidade de login. Pensada
// para ser compartilhada com o hóspede antes da chegada (por WhatsApp,
// e-mail, ou um QR code na recepção).
//
// Dois tipos de documento:
//  • CPF (hóspede brasileiro) — formulário completo, com busca automática
//    de dados pelo CPF e do endereço pelo CEP.
//  • Passaporte (hóspede estrangeiro) — formulário próprio, em português,
//    inglês e francês, com envio da foto do passaporte.
// ============================================================================

import { useEffect, useState, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { supabase } from '../../lib/supabaseClient';
import { PAISES_POR_NOME_EN, nomePais } from '../../lib/paises';

const GENEROS = ['Masculino', 'Feminino', 'Outro', 'Prefiro não informar'];
const GENEROS_TRI = [
  { valor: 'Masculino', rotulo: 'Masculino (Male)' },
  { valor: 'Feminino', rotulo: 'Feminino (Female)' },
  { valor: 'Outro', rotulo: 'Outro (Other)' },
  { valor: 'Prefiro não informar', rotulo: 'Prefiro não informar (Prefer not to say)' },
];
const MOTIVOS_VIAGEM = [
  { valor: 'LAZER', rotulo: 'Lazer' }, { valor: 'NEGOCIOS', rotulo: 'Negócios' },
  { valor: 'EVENTOS', rotulo: 'Eventos' }, { valor: 'PARENTES', rotulo: 'Visita a parentes' },
  { valor: 'SAUDE', rotulo: 'Saúde' }, { valor: 'OUTRO', rotulo: 'Outro' },
];
const MEIOS_TRANSPORTE = [
  { valor: 'AVIAO', rotulo: 'Avião' }, { valor: 'AUTOMOVEL', rotulo: 'Automóvel' },
  { valor: 'ONIBUS', rotulo: 'Ônibus' }, { valor: 'TREM', rotulo: 'Trem' }, { valor: 'OUTRO', rotulo: 'Outro' },
];

// Tipo de viagem do hóspede estrangeiro — e o "motivo de viagem" equivalente
// já usado no resto do sistema (impressão, exportação, filtros).
const TIPOS_VIAGEM_ESTRANGEIRO = [
  { valor: 'TURISMO', pt: 'Turismo', en: 'Tourism', motivoEquivalente: 'LAZER' },
  { valor: 'TRABALHO_NEGOCIOS', pt: 'Trabalho ou Negócios', en: 'Work or business', motivoEquivalente: 'NEGOCIOS' },
  { valor: 'ESTUDO_CONGRESSO', pt: 'Estudo ou congresso', en: 'Study or Congress', motivoEquivalente: 'EVENTOS' },
  { valor: 'OUTROS', pt: 'Outros', en: 'Others', motivoEquivalente: 'OUTRO' },
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
// "Hoje" no horário de Paraíba (os hotéis ficam lá). Antes usava o horário
// UTC, que adianta o dia 3 horas: depois das 21h, o hóspede via "hoje" como
// se já fosse amanhã e o check-in do próprio dia era recusado.
function hoje() {
  try {
    return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Fortaleza' });
  } catch (e) {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
}

function formatarCEP(texto) {
  const d = String(texto || '').replace(/\D/g, '').slice(0, 8);
  if (d.length <= 5) return d;
  return `${d.slice(0, 5)}-${d.slice(5)}`;
}
function formatarTelefoneBR(texto) {
  const d = String(texto || '').replace(/\D/g, '').slice(0, 11);
  if (d.length <= 2) return d;
  if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
}

// Reduz a foto antes de enviar: lado maior de 1600 px, JPEG. Uma foto de
// celular (3 a 8 MB) vira algo em torno de 300 a 600 KB — mais rápido de
// enviar (inclusive em internet de hotel/roaming) e ainda dá pra ler tudo
// no passaporte. Também evita estourar o limite de tamanho do servidor.
async function comprimirImagem(arquivo) {
  const LADO_MAXIMO = 1600;
  const urlTemporaria = URL.createObjectURL(arquivo);
  try {
    const imagem = await new Promise((resolver, rejeitar) => {
      const el = new Image();
      el.onload = () => resolver(el);
      el.onerror = () => rejeitar(new Error('Não foi possível ler essa imagem. Tente uma foto em JPG ou PNG. / Could not read this image. Please try a JPG or PNG photo.'));
      el.src = urlTemporaria;
    });
    const escala = Math.min(1, LADO_MAXIMO / Math.max(imagem.naturalWidth, imagem.naturalHeight));
    const largura = Math.max(1, Math.round(imagem.naturalWidth * escala));
    const altura = Math.max(1, Math.round(imagem.naturalHeight * escala));
    const quadro = document.createElement('canvas');
    quadro.width = largura;
    quadro.height = altura;
    const contexto = quadro.getContext('2d');
    contexto.fillStyle = '#ffffff';
    contexto.fillRect(0, 0, largura, altura);
    contexto.drawImage(imagem, 0, 0, largura, altura);
    const blob = await new Promise((resolver) => quadro.toBlob(resolver, 'image/jpeg', 0.8));
    if (!blob) throw new Error('Não foi possível preparar a imagem. / Could not prepare the image.');
    return blob;
  } finally {
    URL.revokeObjectURL(urlTemporaria);
  }
}

export default function FichaHospedePagina() {
  return (
    <Suspense fallback={<main className="conteudo"><p className="texto-suave">Carregando…</p></main>}>
      <FichaHospede />
    </Suspense>
  );
}

// Rótulo com o texto em português e, logo abaixo, em inglês e francês
function RotuloTri({ pt, en, fr, obrigatorio }) {
  return (
    <label className="rotulo">
      {pt}{obrigatorio ? ' *' : ''}
      {(en || fr) && (
        <span className="fnrh-tri">{[en, fr].filter(Boolean).map((texto) => `(${texto})`).join(' ')}</span>
      )}
    </label>
  );
}

function SeletorPais({ valor, onChange }) {
  return (
    <select className="campo" value={valor} onChange={(e) => onChange(e.target.value)}>
      <option value="">Selecione / Select…</option>
      {PAISES_POR_NOME_EN.map((p) => (
        <option key={p.codigo} value={p.codigo}>{p.en === p.pt ? p.en : `${p.en} — ${p.pt}`}</option>
      ))}
    </select>
  );
}

function FichaHospede() {
  const parametros = useSearchParams();
  const hotelId = parametros.get('hotel_id');

  const [carregandoHotel, setCarregandoHotel] = useState(true);
  const [nomeHotel, setNomeHotel] = useState('');
  const [erroHotel, setErroHotel] = useState('');

  // ---- Campos comuns aos dois formulários ----
  const [nomeCompleto, setNomeCompleto] = useState('');
  const [email, setEmail] = useState('');
  const [dataNascimento, setDataNascimento] = useState('');
  const [genero, setGenero] = useState('');
  const [tipoDocumento, setTipoDocumento] = useState('CPF'); // 'CPF' ou 'PASSAPORTE'
  const [numeroDocumento, setNumeroDocumento] = useState('');
  const [dataCheckin, setDataCheckin] = useState('');
  const [dataCheckout, setDataCheckout] = useState('');

  // ---- Só do formulário de CPF (brasileiro) ----
  const [telefone, setTelefone] = useState('');
  const [nacionalidade, setNacionalidade] = useState('Brasileira');
  const [profissao, setProfissao] = useState('');
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

  // ---- Só do formulário de passaporte (estrangeiro) ----
  const [paisExpedidor, setPaisExpedidor] = useState('');
  const [validadeDocumento, setValidadeDocumento] = useState('');
  const [paisOrigem, setPaisOrigem] = useState('');
  const [enderecoOrigem, setEnderecoOrigem] = useState('');
  const [dataEntradaPais, setDataEntradaPais] = useState('');
  const [localResidenciaBR, setLocalResidenciaBR] = useState('');
  const [tipoViagem, setTipoViagem] = useState('TURISMO');
  const [fotoArquivo, setFotoArquivo] = useState(null);
  const [fotoPrevia, setFotoPrevia] = useState('');
  const [processandoFoto, setProcessandoFoto] = useState(false);
  const [erroFoto, setErroFoto] = useState('');

  const [enviando, setEnviando] = useState(false);
  const [erroForm, setErroForm] = useState('');
  const [enviado, setEnviado] = useState(false);
  const [buscandoCpf, setBuscandoCpf] = useState(false);
  const [cpfEncontrado, setCpfEncontrado] = useState(false);
  const [buscandoCep, setBuscandoCep] = useState(false);
  const [cepEncontrado, setCepEncontrado] = useState(false);

  const ehPassaporte = tipoDocumento === 'PASSAPORTE';

  useEffect(() => {
    if (!hotelId) { setErroHotel('Link inválido — faltou identificar o hotel.'); setCarregandoHotel(false); return; }
    supabase.from('hoteis').select('nome_fantasia').eq('id', hotelId).single()
      .then(({ data, error }) => {
        if (error || !data) { setErroHotel('Não foi possível identificar o hotel deste link.'); }
        else { setNomeHotel(data.nome_fantasia); }
        setCarregandoHotel(false);
      });
  }, [hotelId]);

  function trocarTipoDocumento(novoTipo) {
    setTipoDocumento(novoTipo);
    setNumeroDocumento('');
    setCpfEncontrado(false);
    setErroForm('');
  }

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

  // Foto do passaporte: comprime na hora e guarda pra enviar no "Enviar Ficha"
  async function escolherFoto(evento) {
    const arquivo = evento.target.files?.[0];
    if (!arquivo) return;
    setErroFoto('');
    setProcessandoFoto(true);
    try {
      if (!String(arquivo.type || '').startsWith('image/')) {
        throw new Error('Escolha um arquivo de imagem (foto). / Please choose an image file (photo).');
      }
      const comprimida = await comprimirImagem(arquivo);
      if (fotoPrevia) URL.revokeObjectURL(fotoPrevia);
      setFotoArquivo(comprimida);
      setFotoPrevia(URL.createObjectURL(comprimida));
    } catch (e) {
      setErroFoto(e.message);
      setFotoArquivo(null);
      setFotoPrevia('');
    }
    setProcessandoFoto(false);
  }

  // ------------------------------------------------------------------------
  // Envio — formulário de PASSAPORTE (estrangeiro)
  // ------------------------------------------------------------------------
  async function enviarPassaporte() {
    const falha = (texto) => { setErroForm(texto); };

    if (!nomeCompleto.trim()) return falha('Informe seu nome completo. / Please enter your full name.');
    if (!genero) return falha('Selecione seu gênero. / Please select your gender.');
    if (!dataNascimento) return falha('Informe sua data de nascimento. / Please enter your birth date.');
    if (dataNascimento >= hoje()) return falha('A data de nascimento precisa ser no passado. / The birth date must be in the past.');
    if (!email.trim()) return falha('Informe seu e-mail. / Please enter your e-mail.');
    if (!numeroDocumento.trim()) return falha('Informe o número do passaporte. / Please enter your passport number.');
    if (!paisExpedidor) return falha('Selecione o país que emitiu o passaporte. / Please select the country that issued your passport.');
    if (!validadeDocumento) return falha('Informe a validade do passaporte. / Please enter your passport expiry date.');
    if (validadeDocumento < hoje()) return falha('O passaporte está vencido. / The passport has expired.');
    if (!paisOrigem) return falha('Selecione seu país de procedência. / Please select your country of origin.');
    if (!enderecoOrigem.trim()) return falha('Informe seu endereço residencial no país de procedência. / Please enter your home address in your country of origin.');
    if (!dataEntradaPais) return falha('Informe a data de entrada no país. / Please enter your date of entry into the country.');
    if (!localResidenciaBR.trim()) return falha('Informe o local de residência no Brasil. / Please enter your place of residence in Brazil.');
    if (!dataCheckin) return falha('Informe a data de check-in. / Please enter the check-in date.');
    if (dataCheckin < hoje()) return falha('A data de check-in não pode ser antes de hoje. / The check-in date cannot be before today.');
    if (!dataCheckout) return falha('Informe a data de check-out. / Please enter the check-out date.');
    if (dataCheckout <= dataCheckin) return falha('O check-out precisa ser pelo menos 1 dia depois do check-in. / Check-out must be at least 1 day after check-in.');
    if (dataEntradaPais > dataCheckin) return falha('A data de entrada no país não pode ser depois do check-in. / The date of entry into the country cannot be after check-in.');
    if (!fotoArquivo) return falha('Envie a foto do passaporte. / Please upload the passport photo.');

    setEnviando(true);

    // 1) Envia a foto (vai pra um espaço privado do hotel)
    let caminhoFoto = null;
    try {
      const dadosEnvio = new FormData();
      dadosEnvio.append('arquivo', fotoArquivo, 'passaporte.jpg');
      dadosEnvio.append('hotel_id', String(hotelId));
      const resposta = await fetch('/api/ficha-upload-passaporte', { method: 'POST', body: dadosEnvio });
      const resultado = await resposta.json().catch(() => ({}));
      if (!resposta.ok || resultado.erro) throw new Error(resultado.erro || 'Falha no envio da foto.');
      caminhoFoto = resultado.caminho;
    } catch (e) {
      setEnviando(false);
      return falha('Não foi possível enviar a foto do passaporte. Tente de novo. / Could not upload the passport photo. Please try again. (' + e.message + ')');
    }

    // 2) Grava a ficha
    const nomePaisOrigem = nomePais(paisOrigem);
    const viagem = TIPOS_VIAGEM_ESTRANGEIRO.find((t) => t.valor === tipoViagem);
    const { error } = await supabase.from('fichas_fnrh').insert({
      hotel_id: Number(hotelId),
      nome_completo: nomeCompleto.trim(), email: email.trim(), telefone: null,
      data_nascimento: dataNascimento, genero,
      // Nacionalidade = país que emitiu o passaporte (é o que o passaporte comprova)
      nacionalidade: nomePais(paisExpedidor), profissao: null,
      tipo_documento: 'PASSAPORTE', numero_documento: numeroDocumento.trim(), orgao_expedidor: null,
      // Residência permanente = endereço e país de procedência
      endereco: enderecoOrigem.trim(), pais: nomePaisOrigem,
      motivo_viagem: viagem ? viagem.motivoEquivalente : 'OUTRO',
      procedencia_pais: nomePaisOrigem,
      data_checkin: dataCheckin, data_checkout: dataCheckout,
      // Campos próprios do passaporte
      pais_expedidor_documento: paisExpedidor, validade_documento: validadeDocumento,
      pais_origem: paisOrigem, data_entrada_pais: dataEntradaPais,
      local_residencia_brasil: localResidenciaBR.trim(), tipo_viagem_estrangeiro: tipoViagem,
      foto_passaporte_caminho: caminhoFoto,
    });
    setEnviando(false);

    if (error) { return falha('Não foi possível enviar. / Could not submit. (' + error.message + ')'); }
    setEnviado(true);
  }

  // ------------------------------------------------------------------------
  // Envio — formulário de CPF (brasileiro)
  // ------------------------------------------------------------------------
  async function enviarCpf() {
    if (!nomeCompleto.trim()) { setErroForm('Informe seu nome completo.'); return; }
    if (!email.trim()) { setErroForm('Informe seu e-mail.'); return; }
    if (!telefone.trim()) { setErroForm('Informe seu telefone/WhatsApp.'); return; }
    if (!dataNascimento) { setErroForm('Informe sua data de nascimento.'); return; }
    if (!genero) { setErroForm('Selecione seu gênero.'); return; }
    if (!nacionalidade.trim()) { setErroForm('Informe sua nacionalidade.'); return; }
    if (!profissao.trim()) { setErroForm('Informe sua profissão.'); return; }
    if (!numeroDocumento.trim()) { setErroForm('Informe o número do documento.'); return; }
    if (!validarCPF(numeroDocumento)) {
      setErroForm('O CPF informado não é válido — confira os números.'); return;
    }
    if (!cep.trim()) { setErroForm('Informe o CEP da sua residência.'); return; }
    if (!endereco.trim()) { setErroForm('Informe o endereço.'); return; }
    if (!numeroEndereco.trim()) { setErroForm('Informe o número da residência.'); return; }
    if (!bairro.trim()) { setErroForm('Informe o bairro.'); return; }
    if (!cidade.trim()) { setErroForm('Informe a cidade.'); return; }
    if (!estado.trim()) { setErroForm('Informe o estado.'); return; }
    if (!pais.trim()) { setErroForm('Informe o país.'); return; }
    if (!procedenciaPais.trim() || !procedenciaEstado.trim() || !procedenciaCidade.trim()) {
      setErroForm('Preencha de onde você está vindo (país, estado e cidade).'); return;
    }
    if (!destinoPais.trim() || !destinoEstado.trim() || !destinoCidade.trim()) {
      setErroForm('Preencha para onde você vai depois (país, estado e cidade).'); return;
    }
    if (!dataCheckin) { setErroForm('Informe a data de check-in.'); return; }
    if (dataCheckin < hoje()) { setErroForm('A data de check-in não pode ser antes de hoje.'); return; }
    if (!dataCheckout) { setErroForm('Informe a data de check-out.'); return; }
    if (dataCheckout <= dataCheckin) { setErroForm('A data de check-out precisa ser pelo menos 1 dia depois do check-in.'); return; }

    setEnviando(true);
    const { error } = await supabase.from('fichas_fnrh').insert({
      hotel_id: Number(hotelId),
      nome_completo: nomeCompleto.trim(), email: email.trim(), telefone: telefone.trim(),
      data_nascimento: dataNascimento || null, genero: genero || null,
      nacionalidade: nacionalidade.trim() || null, profissao: profissao.trim() || null,
      tipo_documento: 'CPF', numero_documento: numeroDocumento.trim(), orgao_expedidor: null,
      cep: cep.trim() || null, endereco: endereco.trim() || null, numero_endereco: numeroEndereco.trim() || null,
      complemento: complemento.trim() || null, bairro: bairro.trim() || null, cidade: cidade.trim() || null,
      estado: estado.trim() || null, pais: pais.trim() || null,
      motivo_viagem: motivoViagem, meio_transporte: meioTransporte,
      procedencia_pais: procedenciaPais.trim() || null, procedencia_estado: procedenciaEstado.trim() || null,
      procedencia_cidade: procedenciaCidade.trim() || null,
      destino_pais: destinoPais.trim() || null, destino_estado: destinoEstado.trim() || null,
      destino_cidade: destinoCidade.trim() || null,
      data_checkin: dataCheckin, data_checkout: dataCheckout,
    });
    setEnviando(false);

    if (error) { setErroForm('Não foi possível enviar. Detalhe técnico: ' + error.message); return; }
    setEnviado(true);
  }

  async function enviar(evento) {
    evento.preventDefault();
    if (enviando) return;
    setErroForm('');
    if (ehPassaporte) await enviarPassaporte();
    else await enviarCpf();
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
          <h1 style={{ fontSize: '1.4rem' }}>
            ✅ Ficha enviada com sucesso!{ehPassaporte && <span className="fnrh-tri" style={{ fontSize: '0.95rem' }}>(Form submitted successfully!)</span>}
          </h1>
          <p className="texto-suave">Obrigado por preencher seus dados para o <strong>{nomeHotel}</strong>. Nos vemos em breve!</p>
          {ehPassaporte && (
            <p className="texto-suave">Thank you for filling in your details for <strong>{nomeHotel}</strong>. See you soon!</p>
          )}
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
          {ehPassaporte ? (
            <p className="texto-suave" style={{ fontSize: 13, marginTop: -4 }}>
              Hóspede estrangeiro: preencha os dados abaixo. <span className="fnrh-tri">(Foreign guest: please fill in the details below.) (Client étranger : veuillez remplir les informations ci-dessous.)</span>
            </p>
          ) : (
            <p className="texto-suave" style={{ fontSize: 13, marginTop: -4 }}>
              Comece digitando seu CPF — se encontrarmos seus dados, preenchemos o resto para você.
            </p>
          )}

          <div className={ehPassaporte ? '' : 'fnrh-duas'}>
            <div>
              <label className="rotulo">Tipo de documento{ehPassaporte && <span className="fnrh-tri">(Document type) (Type de document)</span>}</label>
              <select className="campo" value={tipoDocumento} onChange={(e) => trocarTipoDocumento(e.target.value)}>
                <option value="CPF">CPF</option>
                <option value="PASSAPORTE">Passaporte (Passport)</option>
              </select>
            </div>
            {!ehPassaporte && (
              <div>
                <label className="rotulo">Número do documento *</label>
                <input className="campo" type="text" inputMode="numeric" value={numeroDocumento}
                  onChange={(e) => {
                    const novoValor = formatarCPF(e.target.value);
                    setNumeroDocumento(novoValor);
                    setCpfEncontrado(false);
                    buscarPorCpf(novoValor);
                  }}
                  placeholder="000.000.000-00" />
                {buscandoCpf && <p className="fnrh-buscando">🔎 Buscando seus dados…</p>}
                {!buscandoCpf && cpfEncontrado && <p className="fnrh-doc-ok">✓ Dados encontrados e preenchidos abaixo!</p>}
                {!buscandoCpf && !cpfEncontrado && numeroDocumento.trim() && (
                  validarCPF(numeroDocumento)
                    ? <p className="fnrh-doc-ok">✓ CPF válido</p>
                    : <p className="fnrh-doc-erro">✗ CPF inválido</p>
                )}
              </div>
            )}
          </div>

          {ehPassaporte ? (
            <>
              {/* ===================== FORMULÁRIO DE PASSAPORTE ===================== */}
              <div className="fnrh-secao">Dados pessoais <span className="fnrh-tri">(Personal details) (Données personnelles)</span></div>

              <RotuloTri pt="Digite o seu nome completo" en="Enter your full name" fr="Entrez votre nom complet" obrigatorio />
              <input className="campo" type="text" value={nomeCompleto} onChange={(e) => setNomeCompleto(e.target.value)} placeholder="Full Name" />

              <div className="fnrh-duas">
                <div>
                  <RotuloTri pt="Gênero" en="Gender" fr="Genre" obrigatorio />
                  <select className="campo" value={genero} onChange={(e) => setGenero(e.target.value)}>
                    <option value="">Escolha / Choose an option…</option>
                    {GENEROS_TRI.map((g) => <option key={g.valor} value={g.valor}>{g.rotulo}</option>)}
                  </select>
                </div>
                <div>
                  <RotuloTri pt="Data de Nascimento" en="Birth date" fr="Date de naissance" obrigatorio />
                  <input className="campo" type="date" max={hoje()} value={dataNascimento} onChange={(e) => setDataNascimento(e.target.value)} />
                </div>
              </div>

              <RotuloTri pt="E-mail" obrigatorio />
              <input className="campo" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="E-mail" />

              <div className="fnrh-secao">Documento de viagem <span className="fnrh-tri">(Travel document) (Document de voyage)</span></div>

              <RotuloTri pt="Número do Documento de Viagem" en="Travel Document Number" fr="Le numéro de son document de voyage" obrigatorio />
              <input className="campo" type="text" value={numeroDocumento}
                onChange={(e) => setNumeroDocumento(e.target.value.toUpperCase().replace(/\s+/g, ''))}
                placeholder="Travel Document Number" autoCapitalize="characters" />

              <RotuloTri pt="País Expedidor do Documento de Viagem" en="Issuing Country of the Travel Document" fr="Pays de délivrance du document de voyage" obrigatorio />
              <SeletorPais valor={paisExpedidor} onChange={setPaisExpedidor} />

              <RotuloTri pt="Validade do documento de viagem" en="Travel document validity" fr="Validité du document de voyage" obrigatorio />
              <input className="campo" type="date" min={hoje()} value={validadeDocumento} onChange={(e) => setValidadeDocumento(e.target.value)} />

              <div className="fnrh-secao">Procedência e residência <span className="fnrh-tri">(Origin and residence) (Provenance et résidence)</span></div>

              <RotuloTri pt="País de Procedência" en="Country of origin" fr="Pays d'origine" obrigatorio />
              <SeletorPais valor={paisOrigem} onChange={setPaisOrigem} />

              <RotuloTri pt="Endereço Residencial do País de Procedência" en="Residential Address of the Country of Origin" fr="Adresse résidentielle du pays d'origine" obrigatorio />
              <input className="campo" type="text" value={enderecoOrigem} onChange={(e) => setEnderecoOrigem(e.target.value)} placeholder="Residential Address of the Country of Origin" />

              <div className="fnrh-duas">
                <div>
                  <RotuloTri pt="Data de Entrada no País" en="Date of Entry into the Country" fr="Date d'entrée dans le pays" obrigatorio />
                  <input className="campo" type="date" value={dataEntradaPais} onChange={(e) => setDataEntradaPais(e.target.value)} />
                </div>
                <div>
                  <RotuloTri pt="Local de residência no Brasil" en="Place of residence in Brazil" fr="Lieu de résidence au Brésil" obrigatorio />
                  <input className="campo" type="text" value={localResidenciaBR} onChange={(e) => setLocalResidenciaBR(e.target.value)} placeholder="Place of residence in Brazil" />
                </div>
              </div>

              <div className="fnrh-secao">Viagem e hospedagem <span className="fnrh-tri">(Trip and stay) (Voyage et séjour)</span></div>

              <RotuloTri pt="Tipo de viagem" en="Type of trip" fr="Type de voyage" obrigatorio />
              <div className="fnrh-radios">
                {TIPOS_VIAGEM_ESTRANGEIRO.map((t) => (
                  <label key={t.valor} className="fnrh-radio">
                    <input type="radio" name="tipoViagem" checked={tipoViagem === t.valor} onChange={() => setTipoViagem(t.valor)} />
                    <span>{t.pt} ({t.en})</span>
                  </label>
                ))}
              </div>

              <div className="fnrh-duas">
                <div>
                  <RotuloTri pt="Check-in" en="Arrival" fr="Enregistrement" obrigatorio />
                  <input className="campo" type="date" min={hoje()} value={dataCheckin} onChange={(e) => setDataCheckin(e.target.value)} />
                </div>
                <div>
                  <RotuloTri pt="Check-out" en="Departure" fr="Départ" obrigatorio />
                  <input className="campo" type="date" min={dataCheckin || hoje()} value={dataCheckout} onChange={(e) => setDataCheckout(e.target.value)} />
                </div>
              </div>

              <RotuloTri pt="Foto do Passaporte" en="Passport photo" fr="Photo de passeport" obrigatorio />
              <input className="campo" type="file" accept="image/*" onChange={escolherFoto} />
              {processandoFoto && <p className="fnrh-buscando">Processando a imagem… / Processing image…</p>}
              {erroFoto && <p className="fnrh-doc-erro">{erroFoto}</p>}
              {fotoPrevia && (
                <div>
                  <img src={fotoPrevia} alt="Prévia da foto do passaporte / Passport photo preview" className="fnrh-foto-previa" />
                  <p className="fnrh-doc-ok">✓ Foto pronta / Photo ready</p>
                </div>
              )}
              <p className="texto-suave" style={{ fontSize: 12, marginTop: 6 }}>
                A foto é usada somente para o registro de hospedagem e fica visível apenas para a administração do hotel.
                <span className="fnrh-tri">(The photo is used only for the hotel registration and is visible only to the hotel management.)</span>
              </p>
            </>
          ) : (
            <>
              {/* ===================== FORMULÁRIO DE CPF ===================== */}
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
                  <input className="campo" type="tel" inputMode="numeric" value={telefone}
                    onChange={(e) => setTelefone(formatarTelefoneBR(e.target.value))} placeholder="(00) 90000-0000" />
                </div>
              </div>
              <div className="fnrh-duas">
                <div>
                  <label className="rotulo">Data de nascimento *{cpfEncontrado && <span className="fnrh-travado"> 🔒</span>}</label>
                  <input className="campo" type="date" value={dataNascimento} onChange={(e) => setDataNascimento(e.target.value)} readOnly={cpfEncontrado} />
                </div>
                <div>
                  <label className="rotulo">Gênero *{cpfEncontrado && <span className="fnrh-travado"> 🔒</span>}</label>
                  <select className="campo" value={genero} onChange={(e) => setGenero(e.target.value)} disabled={cpfEncontrado}>
                    <option value="">Selecione…</option>
                    {GENEROS.map((g) => <option key={g} value={g}>{g}</option>)}
                  </select>
                </div>
              </div>
              <div className="fnrh-duas">
                <div>
                  <label className="rotulo">Nacionalidade *</label>
                  <input className="campo" type="text" value={nacionalidade} onChange={(e) => setNacionalidade(e.target.value)} />
                </div>
                <div>
                  <label className="rotulo">Profissão *</label>
                  <input className="campo" type="text" value={profissao} onChange={(e) => setProfissao(e.target.value)} />
                </div>
              </div>

              <div className="fnrh-secao">Residência permanente</div>
              <div className="fnrh-duas">
                <div>
                  <label className="rotulo">CEP *</label>
                  <input className="campo" type="text" inputMode="numeric" value={cep}
                    onChange={(e) => { const novoValor = formatarCEP(e.target.value); setCep(novoValor); buscarPorCep(novoValor); }} />
                  {buscandoCep && <p className="fnrh-buscando">🔎 Buscando endereço…</p>}
                  {!buscandoCep && cepEncontrado && <p className="fnrh-doc-ok">✓ Endereço encontrado!</p>}
                </div>
                <div>
                  <label className="rotulo">Endereço *{cepEncontrado && <span className="fnrh-travado"> 🔒</span>}</label>
                  <input className="campo" type="text" value={endereco} onChange={(e) => setEndereco(e.target.value)} readOnly={cepEncontrado} />
                </div>
              </div>
              <div className="fnrh-duas">
                <div>
                  <label className="rotulo">Número *</label>
                  <input className="campo" type="text" value={numeroEndereco} onChange={(e) => setNumeroEndereco(e.target.value)} />
                </div>
                <div>
                  <label className="rotulo">Complemento</label>
                  <input className="campo" type="text" value={complemento} onChange={(e) => setComplemento(e.target.value)} />
                </div>
              </div>
              <div className="fnrh-duas">
                <div>
                  <label className="rotulo">Bairro *{cepEncontrado && <span className="fnrh-travado"> 🔒</span>}</label>
                  <input className="campo" type="text" value={bairro} onChange={(e) => setBairro(e.target.value)} readOnly={cepEncontrado} />
                </div>
                <div>
                  <label className="rotulo">Cidade *{cepEncontrado && <span className="fnrh-travado"> 🔒</span>}</label>
                  <input className="campo" type="text" value={cidade} onChange={(e) => setCidade(e.target.value)} readOnly={cepEncontrado} />
                </div>
              </div>
              <div className="fnrh-duas">
                <div>
                  <label className="rotulo">Estado *{cepEncontrado && <span className="fnrh-travado"> 🔒</span>}</label>
                  <input className="campo" type="text" value={estado} onChange={(e) => setEstado(e.target.value)} readOnly={cepEncontrado} />
                </div>
                <div>
                  <label className="rotulo">País *{cepEncontrado && <span className="fnrh-travado"> 🔒</span>}</label>
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
              <p className="rotulo" style={{ marginTop: 10 }}>De onde você está vindo *</p>
              <div className="fnrh-tres">
                <input className="campo" type="text" value={procedenciaPais} onChange={(e) => setProcedenciaPais(e.target.value)} placeholder="País" />
                <input className="campo" type="text" value={procedenciaEstado} onChange={(e) => setProcedenciaEstado(e.target.value)} placeholder="Estado" />
                <input className="campo" type="text" value={procedenciaCidade} onChange={(e) => setProcedenciaCidade(e.target.value)} placeholder="Cidade" />
              </div>
              <p className="rotulo" style={{ marginTop: 10 }}>Para onde você vai depois *</p>
              <div className="fnrh-tres">
                <input className="campo" type="text" value={destinoPais} onChange={(e) => setDestinoPais(e.target.value)} placeholder="País" />
                <input className="campo" type="text" value={destinoEstado} onChange={(e) => setDestinoEstado(e.target.value)} placeholder="Estado" />
                <input className="campo" type="text" value={destinoCidade} onChange={(e) => setDestinoCidade(e.target.value)} placeholder="Cidade" />
              </div>

              <div className="fnrh-secao">Data da hospedagem</div>
              <div className="fnrh-duas">
                <div>
                  <label className="rotulo">Data de check-in *</label>
                  <input className="campo" type="date" min={hoje()} value={dataCheckin}
                    onChange={(e) => setDataCheckin(e.target.value)} />
                </div>
                <div>
                  <label className="rotulo">Data de check-out *</label>
                  <input className="campo" type="date" min={dataCheckin || hoje()} value={dataCheckout}
                    onChange={(e) => setDataCheckout(e.target.value)} />
                </div>
              </div>
            </>
          )}

          {erroForm && <div className="aviso-erro">{erroForm}</div>}
          <button type="submit" className="botao botao-principal" disabled={enviando || processandoFoto} style={{ marginTop: 16, width: '100%' }}>
            {enviando ? (ehPassaporte ? 'Enviando… / Sending…' : 'Enviando…') : (ehPassaporte ? 'Enviar Ficha / Submit form' : 'Enviar Ficha')}
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

      /* Texto em inglês/francês, logo abaixo do texto em português */
      .fnrh-tri { display: block; font-weight: 400; font-size: 12px; color: var(--texto-suave); line-height: 1.35; margin-top: 1px; }

      .fnrh-radios { display: flex; flex-direction: column; gap: 6px; margin: 4px 0 12px; }
      .fnrh-radio { display: flex; align-items: center; gap: 8px; font-size: 14px; cursor: pointer; min-height: 32px; }
      .fnrh-radio input { width: 18px; height: 18px; flex-shrink: 0; }
      .fnrh-foto-previa { display: block; max-width: 100%; max-height: 260px; border-radius: 10px; border: 1px solid var(--borda); margin-top: 8px; }

      @media (min-width: 640px) {
        .fnrh-duas { grid-template-columns: 1fr 1fr; }
        .fnrh-tres { grid-template-columns: 1fr 1fr 1fr; }
      }
    `}</style>
  );
}
