// AI dohledání akcí: Claude s web searchem najde to, co pevné zdroje neznají
// (konference s vlastním webem, akce na LinkedInu, firemní summity).

import Anthropic from '@anthropic-ai/sdk';

const MODEL = process.env.RADAR_MODEL || 'claude-opus-5-5';
const MAX_SEARCHES = Number(process.env.RADAR_MAX_SEARCHES || 15);

const prompt = (today, known) => `Dnes je ${today}. Najdi nadcházející akce o umělé inteligenci (AI) na příštích 6 měsíců:

1. Česká republika, prezenčně: meetupy, konference, summity, workshopy, hackathony. Praha, Brno, Ostrava, Plzeň, Olomouc i další města.
2. Online akce (webináře, virtuální konference), které stojí za pozornost českému manažerovi nebo vývojáři. Jen kvalitní, žádný prodejní balast.

Hledej přes web search česky i anglicky. Zaměř se na akce, které NEJSOU v seznamu níže (ty už máme z Meetup.com, Luma a Eventbrite): konference s vlastním webem, akce oborových asociací, univerzit, firem a médií.

Už známe:
${known.map((t) => `- ${t}`).join('\n') || '- (nic)'}

Pravidla:
- Uveď jen akce, u kterých jsi na webu ověřil datum a odkaz. Nic nedomýšlej. Když si datem nejsi jistý, akci vynech.
- Jen akce, které začínají ${today} nebo později.
- url = oficiální stránka akce nebo registrace.

Odpověď ukonči jediným blokem \`\`\`json s polem objektů:
{"title": string, "start": "YYYY-MM-DD" nebo "YYYY-MM-DDTHH:MM" (pražský čas), "end": totéž nebo null, "city": string nebo null, "venue": string nebo null, "online": boolean, "type": "meetup"|"konference"|"summit"|"workshop"|"hackathon"|"webinář"|"akce", "url": string, "organizer": string nebo null, "description": string (1–2 věty česky), "free": boolean nebo null, "price": string nebo null (např. "4 900 Kč"), "deadline": "YYYY-MM-DD" nebo null (konec registrace nebo early bird, jen pokud je na webu uveden)}`;

export async function discover({ today, known }) {
  const client = new Anthropic();
  const user = { role: 'user', content: prompt(today, known) };
  const assistant = [];
  let message;

  // Server tool může turn pozastavit (pause_turn); pokračuje se opětovným odesláním dosavadní odpovědi.
  for (let i = 0; i < 6; i++) {
    const stream = client.beta.messages.stream({
      model: MODEL,
      max_tokens: 32000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'medium' },
      tools: [
        {
          type: 'web_search_20260209',
          name: 'web_search',
          max_uses: MAX_SEARCHES,
          user_location: { type: 'approximate', city: 'Prague', country: 'CZ', timezone: 'Europe/Prague' },
        },
      ],
      messages: assistant.length ? [user, { role: 'assistant', content: assistant }] : [user],
    });
    message = await stream.finalMessage();
    assistant.push(...message.content);
    if (message.stop_reason !== 'pause_turn') break;
  }

  if (message.stop_reason === 'refusal') throw new Error('model požadavek odmítl');
  if (message.stop_reason === 'pause_turn') throw new Error('hledání se nestihlo dokončit');

  const text = assistant
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('');
  const blocks = [...text.matchAll(/```json\s*([\s\S]*?)```/g)];
  if (!blocks.length) throw new Error('odpověď neobsahuje JSON blok');
  const items = JSON.parse(blocks.at(-1)[1]);
  if (!Array.isArray(items)) throw new Error('JSON není pole');
  return items;
}
