// ============================================================================
// IDIOMA DO CLIENTE (M7): português, inglês ou espanhol — tela e servidor
// ============================================================================
// O robô responde no idioma em que o cliente escreve (instrução da IA). Aqui
// ficam: o palpite do idioma pelas mensagens (para gravar na conversa e
// escolher o modelo traduzido das automações), o idioma pelo país da reserva
// e os textos da cotação em inglês e espanhol.
// Decisão do dono (06/11/2026): robô e cotação no idioma do cliente; as
// automações usam o modelo em inglês/espanhol quando ele existir.
// ============================================================================

export const IDIOMAS = { pt: 'Português', en: 'Inglês', es: 'Espanhol' };
export const CODIGO_META = { pt: 'pt_BR', en: 'en', es: 'es' }; // idioma do modelo na Meta (sugestão)

const normal = (t) => ` ${String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9?!\s]/g, ' ').replace(/\s+/g, ' ')} `;

// Palavras que quase só aparecem em cada idioma (com espaço em volta)
const MARCAS = {
  pt: ['voce', 'nao', 'obrigado', 'obrigada', 'quarto', 'quartos', 'diaria', 'diarias', 'gostaria', 'ola', 'oi', 'bom dia', 'boa tarde', 'boa noite', 'noite', 'noites', 'quanto custa', 'tem vaga', 'pra', 'estou', 'tudo bem', 'vcs', 'voces', 'pessoas', 'criancas', 'cafe da manha'],
  en: ['hello', 'hi', 'room', 'rooms', 'price', 'please', 'thanks', 'thank you', 'would', 'book', 'booking', 'night', 'nights', 'available', 'how much', 'the', 'is there', 'do you', 'i am', 'we are', 'what', 'breakfast', 'people', 'adults', 'kids', 'check in', 'want', 'need'],
  es: ['hola', 'habitacion', 'habitaciones', 'precio', 'gracias', 'noche', 'noches', 'quisiera', 'cuanto', 'disponible', 'tienen', 'buenas', 'buenos dias', 'estoy', 'personas', 'ninos', 'desayuno', 'usted', 'ustedes', 'quiero', 'necesito', 'hay', 'senor', 'muchas'],
};

// textos: lista de mensagens do cliente (as mais recentes no fim) → 'pt' | 'en' | 'es' | null
export function detectarIdioma(textos) {
  const t = normal((Array.isArray(textos) ? textos : [textos]).slice(-6).join(' '));
  if (t.trim().length < 2) return null;
  const pontos = Object.fromEntries(Object.entries(MARCAS).map(([k, lista]) => [k, lista.reduce((s, w) => s + (t.split(` ${w} `).length - 1), 0)]));
  const ordem = Object.entries(pontos).sort((a, b) => b[1] - a[1]);
  const [primeiro, segundo] = ordem;
  if (primeiro[1] < 1 || primeiro[1] === segundo[1]) return null;
  // Inglês e espanhol precisam de um pouco mais de certeza (o padrão é português)
  if (primeiro[0] !== 'pt' && primeiro[1] < 2 && segundo[1] > 0) return null;
  return primeiro[0];
}

// País do hóspede na Cloudbeds (BR, US, AR…) → idioma
const PAISES_ES = ['AR', 'BO', 'CL', 'CO', 'CR', 'CU', 'DO', 'EC', 'ES', 'GT', 'HN', 'MX', 'NI', 'PA', 'PE', 'PR', 'PY', 'SV', 'UY', 'VE'];
export function idiomaDoPais(pais) {
  const p = String(pais || '').trim().toUpperCase();
  if (!p) return null;
  if (['BR', 'PT', 'AO', 'MZ', 'CV'].includes(p)) return 'pt';
  if (PAISES_ES.includes(p)) return 'es';
  return /^[A-Z]{2}$/.test(p) ? 'en' : null;
}

// ---------------------------------------------------------------- cotação
export const TEXTOS_COTACAO = {
  en: {
    abertura: 'Hello, {nome}! Here is the quote for {checkin} to {checkout} ({noites}), {hospedes}:',
    final: 'Rates for the whole stay, subject to availability at the time of booking. Just tap "Book now" to secure your room. Any questions, I am here to help!',
    aberturaOutroRobo: 'Hello, {nome}! For {checkin} to {checkout} ({noites}), {hospedes}, we have no rooms left at {origem}, but *{hotel}*, from the same group{descricao}, has these options:',
    aberturaOutro: 'Hello, {nome}! Here is the quote from *{hotel}*, from the same group{descricao}, for {checkin} to {checkout} ({noites}), {hospedes}:',
    reservar: 'Book now', porNoite: 'per night',
    noite: ['night', 'nights'], adulto: ['adult', 'adults'], crianca: ['child', 'children'], quarto: ['room', 'rooms'], nossoHotel: 'our hotel',
  },
  es: {
    abertura: '¡Hola, {nome}! Aquí está la cotización del {checkin} al {checkout} ({noites}), {hospedes}:',
    final: 'Valores para toda la estadía, sujetos a disponibilidad al momento de reservar. Solo toque "Reservar ahora" para asegurar su habitación. ¡Cualquier duda, estoy a su disposición!',
    aberturaOutroRobo: '¡Hola, {nome}! Del {checkin} al {checkout} ({noites}), {hospedes}, ya no tenemos habitaciones en {origem}, pero *{hotel}*, del mismo grupo{descricao}, tiene estas opciones:',
    aberturaOutro: '¡Hola, {nome}! Aquí está la cotización de *{hotel}*, del mismo grupo{descricao}, del {checkin} al {checkout} ({noites}), {hospedes}:',
    reservar: 'Reservar ahora', porNoite: 'por noche',
    noite: ['noche', 'noches'], adulto: ['adulto', 'adultos'], crianca: ['niño', 'niños'], quarto: ['habitación', 'habitaciones'], nossoHotel: 'nuestro hotel',
  },
};

export const idiomaValido = (i) => (['pt', 'en', 'es'].includes(i) ? i : 'pt');
