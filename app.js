// app.js – Dockspot Skanner v3
// Bevakar flera hamnar och datumspann, och visar per plats vilka nätter som är lediga
// så att man ser om samma plats är ledig flera nätter i följd.

// Bara Fjällbacka är verifierat. Övriga id är gissade – lägg hellre till hamnar via
// deras Dockspot-länk i appen (de sparas i webbläsaren).
const BUILTIN_HARBORS = [
    { name: "Fjällbacka Gästhamn", id: "107-fjallbacka-gasthamn" },
    { name: "Åstols Gästhamn", id: "142-astol-gasthamn" },
    { name: "Marstrand Gästhamn", id: "122-marstrand" },
    { name: "Smögen Gästhamn", id: "105-smogen" },
    { name: "Hunnebostrand", id: "98-hunnebostrand" },
    { name: "Fiskebäckskil", id: "115-fiskebackskil" },
    { name: "Lysekil Gästhamn", id: "110-lysekil" },
    { name: "Grebbestad Gästhamn", id: "85-grebbestad" },
    { name: "Strömstad Gästhamn", id: "72-stromstad" },
    { name: "Utö Gästhamn", id: "210-uto" },
    { name: "Sandhamn", id: "205-sandhamn" }
];

const KEYS = {
    boat: 'dockspot_boat_specs',
    watches: 'dockspot_watches_v3',
    results: 'dockspot_results_v3',
    settings: 'dockspot_settings_v4',
    harbors: 'dockspot_custom_harbors'
};

let customHarbors = load(KEYS.harbors, []);
let DOCKSPOT_HARBORS = mergeHarbors();
let watches = load(KEYS.watches, []);
let results = load(KEYS.results, {});
let settings = Object.assign({ demo: false, autoMinutes: 0, notify: false }, load(KEYS.settings, {}));

function mergeHarbors() {
    const byId = new Map();
    [...customHarbors, ...BUILTIN_HARBORS].forEach(h => { if (!byId.has(h.id)) byId.set(h.id, h); });
    return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name, 'sv'));
}

// Lägg till hamn från en Dockspot-länk, t.ex.
// https://www.dockspot.com/en/docks/107-fjallbacka-gasthamn/spot_selections/new
function addHarborFromLink() {
    const input = $('harborLink');
    const m = input.value.match(/\/docks\/([\w-]+)/) || input.value.trim().match(/^(\d+-[\w-]+)$/);
    if (!m) { alert('Klistra in en länk till en hamn på dockspot.com (den innehåller /docks/…).'); return; }
    const id = m[1];
    if (DOCKSPOT_HARBORS.some(h => h.id === id)) { alert('Hamnen finns redan i listan.'); input.value = ''; return; }
    const guess = id.replace(/^\d+-/, '').split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
    const name = (prompt('Namn på hamnen:', guess) || guess).trim();
    customHarbors.push({ id, name });
    save(KEYS.harbors, customHarbors);
    DOCKSPOT_HARBORS = mergeHarbors();
    selectedHarbors.add(id);
    input.value = '';
    renderHarborPicker();
}
const selectedHarbors = new Set();
let autoTimer = null;
let scanning = false;

const $ = id => document.getElementById(id);

// ---------- Lagring ----------
function load(key, fallback) {
    try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; }
    catch { return fallback; }
}
function save(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { console.warn('Kunde inte spara', e); }
}
function esc(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Flytta över bevakningar från v2 (en hamn per bevakning)
function migrateOldWatches() {
    if (watches.length) return;
    const old = load('dockspot_watches', []);
    old.forEach(w => {
        if (w.harborId && w.startDate && w.endDate) {
            watches.push({ id: w.id, all: false, harborIds: [w.harborId], startDate: w.startDate, endDate: w.endDate, minNights: null });
        }
    });
    if (watches.length) save(KEYS.watches, watches);
}

// ---------- Datum ----------
const DAY = 86400000;
const WEEKDAYS = ['sön', 'mån', 'tis', 'ons', 'tor', 'fre', 'lör'];
const toUTC = s => Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10));
const iso = ms => new Date(ms).toISOString().slice(0, 10);

function dateRange(start, end) {
    const out = [];
    for (let t = toUTC(start); t <= toUTC(end); t += DAY) out.push(iso(t));
    return out;
}
// Nätter = ankomstdatum t.o.m. dagen före avresa
function nightsOf(w) { return dateRange(w.startDate, iso(toUTC(w.endDate) - DAY)); }

function localDate(offsetDays = 0) {
    const d = new Date();
    d.setDate(d.getDate() + offsetDays);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function fmtDate(s) {
    const d = new Date(toUTC(s));
    return `${d.getUTCDate()}/${d.getUTCMonth() + 1}`;
}

// ---------- Start ----------
document.addEventListener('DOMContentLoaded', () => {
    migrateOldWatches();
    loadBoatSpecs();
    ['length', 'width', 'depth'].forEach(id => $(id).addEventListener('input', saveBoatSpecs));

    $('startDate').value = localDate(0);
    $('endDate').value = localDate(3);

    $('harborFilter').addEventListener('input', renderHarborPicker);
    $('harborLink').addEventListener('keydown', e => { if (e.key === 'Enter') addHarborFromLink(); });
    $('allHarbors').addEventListener('change', renderHarborPicker);
    $('harborList').addEventListener('change', e => {
        const id = e.target.dataset.id;
        if (!id) return;
        e.target.checked ? selectedHarbors.add(id) : selectedHarbors.delete(id);
        updateHarborCount();
    });
    renderHarborPicker();

    $('demoToggle').checked = settings.demo;
    $('notificationToggle').checked = settings.notify && 'Notification' in window && Notification.permission === 'granted';
    $('autoScan').value = String(settings.autoMinutes);
    $('autoScan').addEventListener('change', () => {
        settings.autoMinutes = +$('autoScan').value;
        save(KEYS.settings, settings);
        startAutoScan();
    });
    updateDemoBanner();
    startAutoScan();
    renderWatches();

    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('sw.js').catch(err => console.warn('SW-fel:', err));
    }
});

// ---------- Båtmått ----------
function getBoat() {
    return {
        length: parseFloat($('length').value) || 0,
        width: parseFloat($('width').value) || 0,
        depth: parseFloat($('depth').value) || 0
    };
}
function saveBoatSpecs() {
    save(KEYS.boat, { length: $('length').value, width: $('width').value, depth: $('depth').value });
    const badge = $('savedBadge');
    badge.style.display = 'inline';
    clearTimeout(saveBoatSpecs.t);
    saveBoatSpecs.t = setTimeout(() => { badge.style.display = 'none'; }, 1500);
}
function loadBoatSpecs() {
    const s = load(KEYS.boat, null);
    if (s) {
        $('length').value = s.length || 9.0;
        $('width').value = s.width || 3.0;
        $('depth').value = s.depth || 1.0;
    }
}

// ---------- Hamnväljare ----------
function renderHarborPicker() {
    const q = $('harborFilter').value.toLowerCase().trim();
    const all = $('allHarbors').checked;
    $('harborFilter').disabled = all;
    const list = DOCKSPOT_HARBORS.filter(h => h.name.toLowerCase().includes(q));
    $('harborList').innerHTML = list.length
        ? list.map(h => `
            <label class="check-row ${all ? 'disabled' : ''}">
                <input type="checkbox" data-id="${esc(h.id)}" ${all || selectedHarbors.has(h.id) ? 'checked' : ''} ${all ? 'disabled' : ''}>
                ${esc(h.name)}
            </label>`).join('')
        : '<div class="check-row disabled">Ingen hamn matchar</div>';
    updateHarborCount();
}
function updateHarborCount() {
    const all = $('allHarbors').checked;
    const n = all ? DOCKSPOT_HARBORS.length : selectedHarbors.size;
    $('harborCount').textContent = all
        ? `Alla ${n} hamnar bevakas`
        : n ? `${n} hamn${n > 1 ? 'ar' : ''} vald${n > 1 ? 'a' : ''}` : 'Inga hamnar valda';
}
function harborsOf(w) {
    return w.all ? DOCKSPOT_HARBORS : DOCKSPOT_HARBORS.filter(h => w.harborIds.includes(h.id));
}

// ---------- Bevakningar ----------
function addWatch() {
    const all = $('allHarbors').checked;
    const startDate = $('startDate').value;
    const endDate = $('endDate').value;

    if (!all && selectedHarbors.size === 0) { alert('Välj minst en hamn, eller "Alla hamnar".'); return; }
    if (!startDate || !endDate || endDate <= startDate) { alert('Avresa måste vara efter ankomst.'); return; }

    const nightCount = dateRange(startDate, endDate).length - 1;
    let minNights = parseInt($('minNights').value, 10);
    minNights = Number.isFinite(minNights) && minNights > 0 && minNights < nightCount ? minNights : null;

    watches.push({
        id: Date.now(),
        all,
        harborIds: all ? [] : [...selectedHarbors],
        startDate,
        endDate,
        minNights
    });
    save(KEYS.watches, watches);

    selectedHarbors.clear();
    $('allHarbors').checked = false;
    $('harborFilter').value = '';
    $('minNights').value = '';
    renderHarborPicker();
    renderWatches();
}

function removeWatch(id) {
    watches = watches.filter(w => w.id !== id);
    delete results[id];
    save(KEYS.watches, watches);
    save(KEYS.results, results);
    renderWatches();
}

// ---------- Analys ----------
// Sammanhängande lediga sträckor: [startindex, längd]
function runsOf(freeArr) {
    const runs = [];
    let s = -1;
    freeArr.forEach((f, i) => {
        if (f && s < 0) s = i;
        if (!f && s >= 0) { runs.push([s, i - s]); s = -1; }
    });
    if (s >= 0) runs.push([s, freeArr.length - s]);
    return runs;
}

function analyseHarbor(hr, nights, need) {
    return hr.berths.map(b => {
        const freeSet = new Set(hr.free[b.id] || []);
        const free = nights.map(d => freeSet.has(d));
        const runs = runsOf(free);
        const best = runs.reduce((m, r) => Math.max(m, r[1]), 0);
        return { b, free, runs, best, ok: best >= need };
    });
}

function qualifyingIds(hr, nights, need) {
    if (!hr || !hr.ok) return [];
    return analyseHarbor(hr, nights, need).filter(x => x.ok).map(x => x.b.id);
}

// ---------- Datakällor ----------
function hash(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
}

// Demo: stabil simulerad data per hamn/plats/datum
function demoFetch(harbor, nights, boat) {
    const piers = ['A', 'B', 'C'];
    const count = 8 + hash(harbor.id) % 7;
    const berths = Array.from({ length: count }, (_, i) => {
        const h = hash(harbor.id + '#' + i);
        return {
            id: `${harbor.id}-${i}`,
            name: `Brygga ${piers[i % 3]} – plats ${10 + i}`,
            maxLength: 8 + (h % 70) / 10,
            maxWidth: 2.6 + (h % 15) / 10,
            maxDepth: 1.2 + (h % 25) / 10
        };
    }).filter(b => b.maxLength >= boat.length && b.maxWidth >= boat.width && b.maxDepth >= boat.depth);

    const free = {};
    berths.forEach(b => {
        const block = 2 + hash(b.id) % 3;
        const rate = 30 + hash(b.id + 'r') % 45;
        free[b.id] = nights.filter(d => {
            const day = Math.floor(toUTC(d) / DAY);
            return hash(b.id + '|' + Math.floor(day / block)) % 100 < rate;
        });
    });
    return new Promise(res => setTimeout(() => res({ berths: berths.map(b => ({ id: b.id, name: b.name })), free }), 200));
}

// Riktig hämtning via vår egen serverfunktion (api/check.js på Vercel),
// som i sin tur frågar Dockspot natt för natt.
async function realFetch(harbor, nights, boat) {
    const from = nights[0];
    const to = iso(toUTC(nights[nights.length - 1]) + DAY);
    const url = `/api/check?dock=${encodeURIComponent(harbor.id)}`
        + `&length=${boat.length}&width=${boat.width}&depth=${boat.depth}&from=${from}&to=${to}`;
    let res;
    try { res = await fetch(url); }
    catch { throw new Error('Kunde inte nå /api/check – är appen publicerad på Vercel?'); }
    let data;
    try { data = await res.json(); }
    catch { throw new Error('Servern svarade inte med JSON – körs appen på Vercel?'); }
    if (!res.ok || data.error) throw new Error(data.error || `HTTP ${res.status}`);
    if (data.compatible === false) throw new Error('Din båt passar inte i den här hamnen');
    return normalize(data, nights);
}

// Gör om svaret till { berths:[{id,name}], free:{ berthId:[datum…] } }
function normalize(data, nights) {
    const inRange = new Set(nights);

    // Format A: { berths: [{ id, name, available_dates: [...] }] }
    if (data && Array.isArray(data.berths)) {
        const free = {};
        const berths = data.berths.map(b => {
            const id = String(b.id);
            free[id] = (b.available_dates || b.availableDates || []).filter(d => inRange.has(d));
            return { id, name: b.name || `Plats ${id}` };
        });
        return { berths, free };
    }

    // Format B: { "YYYY-MM-DD": [berth | berthId, ...] }
    if (data && typeof data === 'object') {
        const keys = Object.keys(data).filter(k => /^\d{4}-\d{2}-\d{2}$/.test(k));
        if (keys.length) {
            const names = {}, free = {};
            keys.forEach(d => {
                if (!inRange.has(d) || !Array.isArray(data[d])) return;
                data[d].forEach(x => {
                    const id = String(typeof x === 'object' ? x.id : x);
                    names[id] = (typeof x === 'object' && x.name) || names[id] || `Plats ${id}`;
                    (free[id] = free[id] || []).push(d);
                });
            });
            return { berths: Object.keys(names).map(id => ({ id, name: names[id] })), free };
        }
    }
    throw new Error('Okänt svarsformat från Dockspot');
}

// ---------- Skanning ----------
async function scanAll(trigger = 'manual') {
    if (scanning) return;
    if (!watches.length) {
        if (trigger === 'manual') alert('Lägg till minst en bevakning först!');
        return;
    }
    scanning = true;
    $('scanBtn').disabled = true;
    const status = $('scanStatus');
    const boat = getBoat();
    const newHits = [];

    try {
        for (const w of watches) {
            const nights = nightsOf(w);
            const need = w.minNights || nights.length;
            const harbors = harborsOf(w);
            const prev = results[w.id];
            const next = { scannedAt: new Date().toISOString(), harbors: {} };

            for (let i = 0; i < harbors.length; i++) {
                const h = harbors[i];
                status.textContent = `Skannar ${h.name} (${i + 1}/${harbors.length})…`;
                try {
                    const data = settings.demo ? await demoFetch(h, nights, boat) : await realFetch(h, nights, boat);
                    next.harbors[h.id] = { ok: true, ...data };
                    if (prev) {
                        const before = new Set(qualifyingIds(prev.harbors[h.id], nights, need));
                        qualifyingIds(next.harbors[h.id], nights, need)
                            .filter(id => !before.has(id))
                            .forEach(id => newHits.push({ harbor: h.name, berth: data.berths.find(b => b.id === id).name, need, w }));
                    }
                } catch (e) {
                    next.harbors[h.id] = { ok: false, error: e.message };
                }
            }
            results[w.id] = next;
        }
        save(KEYS.results, results);
        status.textContent = `Senast skannat ${new Date().toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' })}`;
    } finally {
        scanning = false;
        $('scanBtn').disabled = false;
    }

    renderWatches();
    notifyHits(newHits);
}

function notifyHits(hits) {
    if (!hits.length) return;
    const byHarbor = {};
    hits.forEach(h => (byHarbor[h.harbor] = byHarbor[h.harbor] || []).push(h));
    Object.entries(byHarbor).forEach(([harbor, list]) => {
        const w = list[0].w;
        const body = `${list.map(x => x.berth).join(', ')} – minst ${list[0].need} nätter i följd (${fmtDate(w.startDate)}–${fmtDate(w.endDate)})`;
        sendNotification(`🎉 Ny ledig plats i ${harbor}`, body);
    });
}

function startAutoScan() {
    clearInterval(autoTimer);
    if (settings.autoMinutes > 0) {
        autoTimer = setInterval(() => scanAll('auto'), settings.autoMinutes * 60000);
    }
}

// ---------- Rendering ----------
function renderWatches() {
    const c = $('watchList');
    const badge = $('watchStatus');
    if (!watches.length) {
        c.innerHTML = '<div class="empty-state">Inga bevakningar tillagda ännu.</div>';
        badge.textContent = 'Inga';
        badge.className = 'status-badge status-inactive';
        return;
    }
    badge.textContent = `${watches.length} aktiv${watches.length > 1 ? 'a' : ''}`;
    badge.className = 'status-badge status-active';
    c.innerHTML = watches.map(renderWatch).join('');
}

function renderWatch(w) {
    const nights = nightsOf(w);
    const need = w.minNights || nights.length;
    const harbors = harborsOf(w);
    const res = results[w.id];
    const title = w.all ? `Alla hamnar (${harbors.length})` : harbors.map(h => h.name).join(', ');
    const req = w.minNights ? `minst ${need} nätter i följd` : `hela perioden, ${nights.length} nätter`;

    let body;
    if (!res) {
        body = '<div class="hint" style="margin-top:10px">Inte skannad ännu – tryck "Skanna alla nu".</div>';
    } else {
        const sections = harbors
            .filter(h => res.harbors[h.id])
            .map(h => {
                const hr = res.harbors[h.id];
                const rows = hr.ok ? analyseHarbor(hr, nights, need) : [];
                return { h, hr, rows, okCount: rows.filter(r => r.ok).length };
            })
            .sort((a, b) => b.okCount - a.okCount || a.h.name.localeCompare(b.h.name, 'sv'));

        const totalOk = sections.reduce((s, x) => s + x.okCount, 0);
        const harborsOk = sections.filter(x => x.okCount > 0).length;
        const overview = totalOk
            ? `<div class="overview">✓ ${totalOk} plats${totalOk > 1 ? 'er' : ''} i ${harborsOk} hamn${harborsOk > 1 ? 'ar' : ''} är lediga ${req}</div>`
            : `<div class="overview none">Ingen plats är ledig ${req} just nu</div>`;

        body = overview + sections.map(s => renderHarbor(s, nights, need)).join('')
            + `<div class="hint" style="margin-top:10px">Skannad ${new Date(res.scannedAt).toLocaleString('sv-SE', { dateStyle: 'short', timeStyle: 'short' })}</div>`;
    }

    return `
        <div class="watch-item">
            <div class="watch-head">
                <div class="watch-info">
                    <h4>⚓ ${esc(title)}</h4>
                    <p>📅 ${fmtDate(w.startDate)} ➔ ${fmtDate(w.endDate)} · ${req}</p>
                </div>
                <button class="btn-delete" title="Ta bort" onclick="removeWatch(${w.id})">🗑️</button>
            </div>
            ${body}
        </div>`;
}

function renderHarbor({ h, hr, rows, okCount }, nights, need) {
    if (!hr.ok) {
        return `<div class="harbor-res"><div class="harbor-head"><strong>${esc(h.name)}</strong><span class="err">Kunde inte hämtas: ${esc(hr.error)}</span></div></div>`;
    }
    const withFree = rows.filter(r => r.best > 0)
        .sort((a, b) => b.best - a.best || a.b.name.localeCompare(b.b.name, 'sv'));
    if (!withFree.length) {
        return `<div class="harbor-res"><div class="harbor-head"><strong>${esc(h.name)}</strong><span class="sum">Inga lediga platser för din båt</span></div></div>`;
    }
    const good = withFree.filter(r => r.ok);
    const rest = withFree.filter(r => !r.ok);
    const full = withFree.filter(r => r.best === nights.length).length;

    let sum = okCount ? `${okCount} plats${okCount > 1 ? 'er' : ''} uppfyller kravet` : 'Ingen plats uppfyller kravet';
    if (full && need < nights.length) sum += ` · ${full} hela perioden`;

    return `
        <div class="harbor-res">
            <div class="harbor-head"><strong>${esc(h.name)}</strong><span class="sum">${sum}</span></div>
            ${good.length ? renderTable(good, nights, need) : ''}
            ${rest.length ? `<details class="rest"${good.length ? '' : ' open'}>
                <summary>${rest.length} plats${rest.length > 1 ? 'er' : ''} med kortare lediga perioder</summary>
                ${renderTable(rest, nights, need)}
            </details>` : ''}
        </div>`;
}

function renderTable(rows, nights, need) {
    const head = nights.map(d => {
        const dt = new Date(toUTC(d));
        const wd = dt.getUTCDay();
        return `<th class="day ${wd === 0 || wd === 6 ? 'weekend' : ''}">${WEEKDAYS[wd]}<br>${fmtDate(d)}</th>`;
    }).join('');

    const body = rows.map(r => {
        const inRun = new Array(nights.length).fill(false);
        r.runs.filter(([, len]) => len >= need).forEach(([s, len]) => { for (let i = s; i < s + len; i++) inRun[i] = true; });
        const cells = r.free.map((f, i) => {
            const cls = !f ? 'c-busy' : inRun[i] ? 'c-run' : 'c-free';
            return `<td class="c ${cls}" title="${nights[i]}: ${f ? 'ledig' : 'upptagen'}"></td>`;
        }).join('');
        const label = r.best === nights.length
            ? '<div class="brun full">Hela perioden ✓</div>'
            : `<div class="brun">Max ${r.best} natt${r.best > 1 ? 'er' : ''} i följd</div>`;
        return `<tr><td class="berth-col"><div class="bname" title="${esc(r.b.name)}">${esc(r.b.name)}</div>${label}</td>${cells}</tr>`;
    }).join('');

    return `<div class="grid-wrap"><table class="avail"><thead><tr><th class="berth-col">Plats</th>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
}

// ---------- Inställningar ----------
function toggleDemo() {
    settings.demo = $('demoToggle').checked;
    save(KEYS.settings, settings);
    // Blanda inte simulerad och riktig data
    results = {};
    save(KEYS.results, results);
    updateDemoBanner();
    renderWatches();
}
function updateDemoBanner() {
    $('demoBanner').style.display = settings.demo ? 'block' : 'none';
}

// ---------- Notiser ----------
async function toggleNotifications() {
    const toggle = $('notificationToggle');
    if (toggle.checked) {
        if (!('Notification' in window)) {
            alert('Din webbläsare stöder inte notiser.');
            toggle.checked = false;
            return;
        }
        const permission = await Notification.requestPermission();
        if (permission === 'granted') {
            settings.notify = true;
            sendNotification('⚓ Dockspot Skanner', 'Notiser är aktiverade för dina bevakningar!');
        } else {
            alert('Notiser nekades i webbläsaren.');
            toggle.checked = false;
            settings.notify = false;
        }
    } else {
        settings.notify = false;
    }
    save(KEYS.settings, settings);
}

function sendNotification(title, body) {
    if (!settings.notify || !('Notification' in window) || Notification.permission !== 'granted') return;
    const opts = { body, icon: 'https://img.icons8.com/color/512/anchor.png' };
    // På mobil kräver notiser ofta service worker
    if (navigator.serviceWorker && navigator.serviceWorker.controller) {
        navigator.serviceWorker.ready.then(reg => reg.showNotification(title, opts)).catch(() => new Notification(title, opts));
    } else {
        try { new Notification(title, opts); } catch (e) { console.warn('Notis misslyckades', e); }
    }
}
