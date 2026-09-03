/** @type {import('next').NextConfig} */

// Cabeçalhos de segurança — resolve os problemas apontados pelo Security
// Headers (snyk) e pelo Mozilla HTTP Observatory. A lista de domínios
// permitidos foi levantada direto no código (não é um modelo genérico):
// fontes do Google, a biblioteca pdf.js (usada em Financeiro), o ViaCEP
// (usado na Ficha de Hóspede) e o Supabase (dados + tempo real). Tudo que
// é chamado só pelo servidor (Cloudbeds, Resend, DirectD, Receita
// Federal) fica de fora — CSP só controla o que o NAVEGADOR carrega.
const politicaSeguranca = [
  "default-src 'self'",
  // 'unsafe-inline'/'unsafe-eval' seguem necessários pro próprio Next.js
  // funcionar (scripts injetados por ele, styled-jsx nas páginas) — um CSP
  // 100% "estrito" exigiria um esquema de nonce por requisição, uma
  // mudança bem maior e mais arriscada de fazer num site já no ar.
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cdnjs.cloudflare.com",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data: blob: https:",
  "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://viacep.com.br",
  "worker-src 'self' blob: https://cdnjs.cloudflare.com",
  "frame-ancestors 'self'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ');

const nextConfig = {
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'Content-Security-Policy', value: politicaSeguranca },
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          // Câmera liberada (achados/perdidos, atestados e governança usam
          // foto tirada na hora) — microfone e geolocalização não são
          // usados em lugar nenhum do site, por isso ficam bloqueados.
          { key: 'Permissions-Policy', value: 'camera=(self), microphone=(), geolocation=(), interest-cohort=()' },
        ],
      },
    ];
  },
};

module.exports = nextConfig;
