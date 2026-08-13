// ============================================================================
// lib/cloudbedsCrypto.js
// ============================================================================
// Criptografia da chave da API da Cloudbeds. Usado SÓ dentro de rotas de
// servidor (app/api/...) — nunca é importado por nenhuma tela do navegador.
// A senha secreta vem de uma variável de ambiente (CLOUDBEDS_CRYPTO_SECRET),
// do mesmo jeito que a chave mestra do Supabase: só existe no servidor.
// ============================================================================

import crypto from 'crypto';

export function criptografar(texto, chaveSecreta) {
  const chave = crypto.createHash('sha256').update(chaveSecreta).digest();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', chave, iv);
  const encrypted = Buffer.concat([cipher.update(texto, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, encrypted]).toString('base64');
}

export function descriptografar(textoCifrado, chaveSecreta) {
  const chave = crypto.createHash('sha256').update(chaveSecreta).digest();
  const dados = Buffer.from(textoCifrado, 'base64');
  const iv = dados.subarray(0, 12);
  const authTag = dados.subarray(12, 28);
  const encrypted = dados.subarray(28);
  const decipher = crypto.createDecipheriv('aes-256-gcm', chave, iv);
  decipher.setAuthTag(authTag);
  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
  return decrypted.toString('utf8');
}
