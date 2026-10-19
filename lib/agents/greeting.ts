import { normalizeCountry } from "../upwork/mcp/jobs";

/*
 * Proposal greeting in the client's own language (David, 2026-10-15): "Γεια σας," for a client in Cyprus
 * instead of "Hi there,". Only the greeting is localised - the letter stays in English. Polite, gender-neutral
 * forms; right-to-left scripts are transliterated so the line reads cleanly in an English letter.
 * Countries not listed (English-speaking or mixed-language) keep "Hi".
 */
const HELLO: Record<string, string> = {
  Greece: "Γεια σας", Cyprus: "Γεια σας",
  Germany: "Hallo", Austria: "Hallo", Liechtenstein: "Hallo",
  Netherlands: "Hallo",
  France: "Bonjour", Monaco: "Bonjour", Luxembourg: "Bonjour",
  Italy: "Salve", "San Marino": "Salve",
  Spain: "Hola", Mexico: "Hola", Argentina: "Hola", Colombia: "Hola", Chile: "Hola", Peru: "Hola", Uruguay: "Hola",
  Paraguay: "Hola", Bolivia: "Hola", Ecuador: "Hola", Venezuela: "Hola", "Costa Rica": "Hola", Panama: "Hola",
  Guatemala: "Hola", "Dominican Republic": "Hola", "El Salvador": "Hola", Honduras: "Hola", Nicaragua: "Hola", Cuba: "Hola",
  Portugal: "Olá", Brazil: "Olá",
  Poland: "Dzień dobry", Czechia: "Dobrý den", "Czech Republic": "Dobrý den", Slovakia: "Dobrý deň",
  Hungary: "Jó napot", Romania: "Bună ziua", Moldova: "Bună ziua", Bulgaria: "Здравейте", Serbia: "Zdravo",
  Croatia: "Dobar dan", Slovenia: "Pozdravljeni", "Bosnia and Herzegovina": "Zdravo", Montenegro: "Zdravo",
  Ukraine: "Вітаю", Russia: "Здравствуйте", Belarus: "Здравствуйте",
  Sweden: "Hej", Denmark: "Hej", Norway: "Hei", Finland: "Hei", Iceland: "Halló",
  Estonia: "Tere", Latvia: "Sveiki", Lithuania: "Sveiki",
  Armenia: "Բարև Ձեզ", Georgia: "გამარჯობა",
  Israel: "Shalom",
  "United Arab Emirates": "Marhaba", "Saudi Arabia": "Marhaba", Qatar: "Marhaba", Kuwait: "Marhaba", Bahrain: "Marhaba",
  Oman: "Marhaba", Jordan: "Marhaba", Egypt: "Marhaba", Lebanon: "Marhaba", Morocco: "Marhaba",
  Japan: "こんにちは", China: "您好", Taiwan: "您好", "Hong Kong": "您好", "South Korea": "안녕하세요", Korea: "안녕하세요",
  Vietnam: "Xin chào", Thailand: "สวัสดี", Indonesia: "Halo", Malaysia: "Helo",
};

/** "Hello" for a client location; Quebec gets French. Unknown or English-speaking: "Hi". */
export function nativeHello(country: string | null | undefined, state?: string | null): string {
  if (!country) return "Hi";
  const c = normalizeCountry(country);
  if (c === "Canada" && /qu[ée]bec/i.test(state ?? "")) return "Bonjour";
  return HELLO[c] ?? "Hi";
}

/** The greeting line: native hello + first name when known ("Γεια σας Jay,"), else the hello alone ("Γεια σας,", "Hi,").
 *  Never "Hi there," (David, 2026-10-15). */
export function greetingLine(country: string | null | undefined, state: string | null | undefined, name: string | null | undefined): string {
  const hello = nativeHello(country, state);
  const first = name?.trim().split(/\s+/)[0];
  if (first) return `${hello} ${first},`;
  return `${hello},`;
}

/**
 * Replace the draft's opening greeting with the localised one. The greeting is the first line when it is short
 * and ends with a comma - "Hi there,", "Hello Jay,", or one the model wrote in another language ("Dia duit,").
 * A draft that opens straight with the opener gets the greeting added above it.
 */
export function localiseGreeting(cover: string, line: string): string {
  const body = cover.trimStart();
  const first = body.split("\n", 1)[0];
  const isGreeting = /^\s*(hi|hello|hey|dear)\b/i.test(first) || (first.trim().length <= 40 && /,\s*$/.test(first) && !/[.!?]/.test(first));
  if (isGreeting) return `${line}${body.slice(first.length)}`;
  // Greeting run into the opener on one line ("Dia duit, At a stadium…"): a short phrase, a comma, then a capital.
  const inline = body.match(/^([^\n,.!?]{1,25}),\s+(?=\p{Lu})/u);
  if (inline) return `${line}\n\n${body.slice(inline[0].length)}`;
  return `${line}\n\n${body}`;
}
