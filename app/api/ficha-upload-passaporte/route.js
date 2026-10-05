// ============================================================================
// ROTA DE SERVIDOR: /api/ficha-upload-passaporte
// ============================================================================
// Recebe a foto do passaporte enviada pelo hóspede estrangeiro na ficha
// pública (sem login) e guarda num espaço PRIVADO do Supabase
// ("fichas-passaportes"). Por ser uma rota aberta ao público, ela não
// confia em nada que vem do navegador: confere o hotel, o tamanho e o
// conteúdo REAL do arquivo (os primeiros bytes), não só o nome/tipo que ele
// diz ter. O caminho devolvido é aleatório (impossível de adivinhar).
// ============================================================================

import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'crypto';

const TAMANHO_MAXIMO = 3 * 1024 * 1024; // 3 MB (o navegador já comprime antes de enviar)

// Descobre o tipo verdadeiro da imagem pelos primeiros bytes do arquivo
function detectarTipoImagem(bytes) {
  if (bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return { mime: 'image/jpeg', extensao: 'jpg' };
  }
  if (bytes.length > 7 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return { mime: 'image/png', extensao: 'png' };
  }
  if (
    bytes.length > 12 &&
    bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
    bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
  ) {
    return { mime: 'image/webp', extensao: 'webp' };
  }
  return null;
}

export async function POST(request) {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const chaveMestra = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !chaveMestra) {
      return Response.json({ erro: 'O servidor não está configurado corretamente.' }, { status: 500 });
    }

    let dadosFormulario;
    try { dadosFormulario = await request.formData(); }
    catch (e) { return Response.json({ erro: 'Envio inválido.' }, { status: 400 }); }

    const arquivo = dadosFormulario.get('arquivo');
    const hotelId = Number(dadosFormulario.get('hotel_id'));

    if (!hotelId || !Number.isInteger(hotelId) || hotelId <= 0) {
      return Response.json({ erro: 'Link inválido — faltou identificar o hotel.' }, { status: 400 });
    }
    if (!arquivo || typeof arquivo === 'string' || typeof arquivo.arrayBuffer !== 'function') {
      return Response.json({ erro: 'Nenhuma foto foi enviada.' }, { status: 400 });
    }
    if (arquivo.size > TAMANHO_MAXIMO) {
      return Response.json({ erro: 'A foto é grande demais (máximo de 3 MB).' }, { status: 413 });
    }
    if (arquivo.size === 0) {
      return Response.json({ erro: 'A foto está vazia.' }, { status: 400 });
    }

    const bytes = new Uint8Array(await arquivo.arrayBuffer());
    const tipo = detectarTipoImagem(bytes);
    if (!tipo) {
      return Response.json({ erro: 'O arquivo não parece ser uma imagem válida (use JPG, PNG ou WebP).' }, { status: 400 });
    }

    const supabaseAdmin = createClient(supabaseUrl, chaveMestra);

    // O hotel do link precisa existir de verdade
    const { data: hotel } = await supabaseAdmin.from('hoteis').select('id').eq('id', hotelId).maybeSingle();
    if (!hotel) {
      return Response.json({ erro: 'Não foi possível identificar o hotel deste link.' }, { status: 400 });
    }

    const caminho = `${hotelId}/${randomUUID()}.${tipo.extensao}`;
    const { error: erroUpload } = await supabaseAdmin.storage
      .from('fichas-passaportes')
      .upload(caminho, bytes, { contentType: tipo.mime, upsert: false });
    if (erroUpload) {
      return Response.json({ erro: 'Não foi possível guardar a foto. Detalhe técnico: ' + erroUpload.message }, { status: 500 });
    }

    return Response.json({ caminho });
  } catch (erro) {
    return Response.json({ erro: 'Erro inesperado no servidor: ' + erro.message }, { status: 500 });
  }
}
