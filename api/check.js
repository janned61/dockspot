// api/check.js – Vercel-funktion som hämtar lediga platser från Dockspot natt för natt.
//
// GET /api/check?dock=107-fjallbacka-gasthamn&length=9&width=3&depth=1&from=2027-06-04&to=2027-06-08
//   from = ankomst, to = avresa (nätterna är from … to-1)
//
// Svar:
// { dock, nights:[...], compatible, berths:[{ id, name, number, available_dates:[...] }] }
//
// Så funkar Dockspot (november 2026):
//  1. GET  /en/docks/{dock}/spot_selections/new        → sessionscookie + csrf-token (meta csrf-token)
//  2. GET  /en/docks/{dock}/availability?length&width&depth
//       → { is_compatible, unavailable_from, unavailable_dates, first_available_date }
//  3. POST /en/docks/{dock}/spot_selections/refresh_map_widget
//       body: authenticity_token, length, width, depth, from, to
//       → HTML med <select name="booking[spot_id]"> där varje <option> är en LEDIG plats

const BASE = 'https://www.dockspot.com';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const MAX_NIGHTS = 31;
const CONCURRENCY = 4;
const DAY = 86400000;

const toUTC = s => Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10));
const iso = ms => new Date(ms).toISOString().slice(0, 10);
const isDate = s => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);

function nightsBetween(from, to) {
    const out = [];
    for (let t = toUTC(from); t < toUTC(to); t += DAY) out.push(iso(t));
    return out;
}

function decodeEntities(s) {
    return s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
        .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ');
}

// Plocka ut lediga platser ur refresh_map_widget-svaret
function parseSpots(html) {
    const select = html.match(/<select[^>]*name="booking\[spot_id\]"[^>]*>([\s\S]*?)<\/select>/i);
    if (!select) return [];
    const spots = [];
    const re = /<option[^>]*value="([^"]+)"[^>]*>([\s\S]*?)<\/option>/gi;
    let m;
    while ((m = re.exec(select[1])) !== null) {
        const id = m[1];
        if (!id) continue;
        const label = decodeEntities(m[2]).replace(/\s+/g, ' ').trim();
        const pm = label.match(/^(.*?)\s*\((.*)\)\s*$/);
        spots.push({ id, number: pm ? pm[1] : label, price: pm ? pm[2] : null });
    }
    return spots;
}

function parseCsrf(html) {
    const m = html.match(/<meta[^>]*name="csrf-token"[^>]*content="([^"]+)"/i)
        || html.match(/<meta[^>]*content="([^"]+)"[^>]*name="csrf-token"/i)
        || html.match(/name="authenticity_token"[^>]*value="([^"]+)"/i);
    return m ? decodeEntities(m[1]) : null;
}

function cookiesFrom(res) {
    const list = typeof res.headers.getSetCookie === 'function'
        ? res.headers.getSetCookie()
        : (res.headers.get('set-cookie') || '').split(/,(?=\s*[^;=\s]+=)/);
    return list.map(c => c.split(';')[0].trim()).filter(Boolean).join('; ');
}

async function openSession(dock, boat) {
    const url = `${BASE}/en/docks/${encodeURIComponent(dock)}/spot_selections/new`
        + `?length=${boat.length}&width=${boat.width}&depth=${boat.depth}`;
    const res = await fetch(url, { headers: { 'User-Agent': UA, 'Accept': 'text/html', 'Accept-Language': 'en' } });
    if (res.status === 404) throw new Error('Hamnen finns inte på Dockspot (kontrollera hamn-id)');
    if (!res.ok) throw new Error(`Dockspot svarade ${res.status} på platsvalssidan`);
    const html = await res.text();
    const token = parseCsrf(html);
    if (!token) throw new Error('Hittade ingen csrf-token på Dockspot-sidan');
    return { token, cookie: cookiesFrom(res), referer: url };
}

async function fetchCalendar(dock, boat) {
    const url = `${BASE}/en/docks/${encodeURIComponent(dock)}/availability`
        + `?length=${boat.length}&width=${boat.width}&depth=${boat.depth}`;
    try {
        const res = await fetch(url, { headers: { 'User-Agent': UA, 'Accept': 'application/json' } });
        return res.ok ? await res.json() : null;
    } catch {
        return null;
    }
}

async function fetchNight(dock, boat, session, from, to) {
    const body = new URLSearchParams({
        authenticity_token: session.token,
        length: String(boat.length),
        width: String(boat.width),
        depth: String(boat.depth),
        from,
        to
    });
    const res = await fetch(`${BASE}/en/docks/${encodeURIComponent(dock)}/spot_selections/refresh_map_widget`, {
        method: 'POST',
        headers: {
            'User-Agent': UA,
            'Accept': 'text/vnd.turbo-stream.html, text/html, */*',
            'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
            'X-CSRF-Token': session.token,
            'X-Requested-With': 'XMLHttpRequest',
            'Origin': BASE,
            'Referer': session.referer,
            'Cookie': session.cookie
        },
        body
    });
    if (!res.ok) throw new Error(`refresh_map_widget svarade ${res.status}`);
    return parseSpots(await res.text());
}

// Kör uppgifter med begränsad parallellitet
async function pool(items, limit, fn) {
    const results = new Array(items.length);
    let next = 0;
    async function worker() {
        while (next < items.length) {
            const i = next++;
            results[i] = await fn(items[i], i);
        }
    }
    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
    return results;
}

async function checkDock({ dock, boat, from, to }) {
    const nights = nightsBetween(from, to);
    const calendar = await fetchCalendar(dock, boat);

    if (calendar && calendar.is_compatible === false) {
        return { dock, nights, compatible: false, berths: [] };
    }

    // Nätter som Dockspot redan säger är fullbokade eller utanför säsong behöver inte frågas
    const closed = new Set(calendar?.unavailable_dates || []);
    const isOpen = d => !closed.has(d)
        && !(calendar?.first_available_date && d < calendar.first_available_date)
        && !(calendar?.unavailable_from && d >= calendar.unavailable_from);
    const toAsk = nights.filter(isOpen);

    const berths = new Map();
    if (toAsk.length) {
        const session = await openSession(dock, boat);
        await pool(toAsk, CONCURRENCY, async night => {
            const spots = await fetchNight(dock, boat, session, night, iso(toUTC(night) + DAY));
            spots.forEach(s => {
                if (!berths.has(s.id)) berths.set(s.id, { id: s.id, number: s.number, name: `Plats ${s.number}`, available_dates: [] });
                berths.get(s.id).available_dates.push(night);
            });
        });
    }

    const list = [...berths.values()]
        .map(b => ({ ...b, available_dates: b.available_dates.sort() }))
        .sort((a, b) => String(a.number).localeCompare(String(b.number), 'sv', { numeric: true }));

    return { dock, nights, compatible: true, season: calendar ? { first: calendar.first_available_date, until: calendar.unavailable_from } : null, berths: list };
}

module.exports = async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 's-maxage=120, stale-while-revalidate=300');

    const { dock, length, width, depth, from, to } = req.query;
    const boat = { length: parseFloat(length), width: parseFloat(width), depth: parseFloat(depth) };

    if (!dock || !/^[\w-]+$/.test(dock)) return res.status(400).json({ error: 'Ogiltig hamn (dock)' });
    if (![boat.length, boat.width, boat.depth].every(n => Number.isFinite(n) && n > 0)) return res.status(400).json({ error: 'Ogiltiga båtmått' });
    if (!isDate(from) || !isDate(to) || to <= from) return res.status(400).json({ error: 'Ogiltiga datum (from = ankomst, to = avresa)' });
    if (nightsBetween(from, to).length > MAX_NIGHTS) return res.status(400).json({ error: `Max ${MAX_NIGHTS} nätter per sökning` });

    try {
        res.status(200).json(await checkDock({ dock, boat, from, to }));
    } catch (err) {
        res.status(502).json({ error: err.message });
    }
};

module.exports.parseSpots = parseSpots;
module.exports.parseCsrf = parseCsrf;
module.exports.nightsBetween = nightsBetween;
