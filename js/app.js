// Familien-Kochbuch – Version 1 (Grundgeruest)
// Anmeldung, Rezeptliste, Rezeptansicht mit Portionsrechner, Rezept anlegen/bearbeiten/loeschen.

import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import {
  getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut, sendPasswordResetEmail
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import {
  getFirestore, collection, getDocs, getDoc, doc, addDoc, updateDoc, deleteDoc, serverTimestamp
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { firebaseConfig } from './firebase-config.js';

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const wurzel = document.getElementById('app');

const zustand = {
  nutzer: null,      // angemeldeter Firebase-Nutzer
  freigabe: null,    // null = noch unbekannt, sonst { rolle } oder false
  rezepte: null,     // Zwischenspeicher, wird einmal pro Sitzung geladen
  suche: '',
  kategorie: ''
};

// ---------- Hilfsfunktionen ----------

// Baut ein Element. Texte werden immer als reiner Text eingesetzt (kein HTML).
function el(tag, props = {}, ...kinder) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k === 'text') e.textContent = v;
    else if (k === 'value') e.value = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v === true ? '' : v);
  }
  for (const kind of kinder.flat()) {
    if (kind === null || kind === undefined || kind === false) continue;
    e.append(kind instanceof Node ? kind : document.createTextNode(String(kind)));
  }
  return e;
}

// Feste, eigene Symbole (keine Nutzerdaten).
const ICONS = {
  logo: '<svg width="38" height="38" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 3v8a2 2 0 0 0 4 0V3"/><path d="M9 11v10"/><path d="M16 21V3c2 1 3 4 3 7h-3"/></svg>',
  zurueck: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 6l-6 6 6 6"/></svg>',
  weiter: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>',
  plus: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
  minus: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M5 12h14"/></svg>',
  suche: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>',
  stift: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16v4z"/></svg>',
  x: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>'
};
function icon(name) {
  const t = document.createElement('template');
  t.innerHTML = ICONS[name];
  return t.content.firstChild;
}

function zeige(...inhalt) {
  wurzel.replaceChildren(...inhalt);
  window.scrollTo(0, 0);
}

// Zahl im deutschen Format, auf "schritt" gerundet: zahl(1.25, 0.5) -> "1,5"
function zahl(n, schritt) {
  const r = Math.round(n / schritt) * schritt;
  return String(Math.round(r * 100) / 100).replace('.', ',');
}
function schrittFuer(wert, einheit) {
  const e = (einheit || '').toLowerCase();
  if (e === 'g' || e === 'ml') return wert >= 100 ? 5 : 1;
  if (e === 'kg' || e === 'l') return 0.1;
  return 0.5;
}
function mengeText(menge, einheit) {
  if (menge === null || menge === undefined) return '';
  const e = (einheit || '').trim();
  if (e.toLowerCase() === 'ml' && menge >= 1000) return zahl(menge / 1000, 0.1) + ' l';
  if (e.toLowerCase() === 'g' && menge >= 1000) return zahl(menge / 1000, 0.1) + ' kg';
  return (zahl(menge, schrittFuer(menge, e)) + ' ' + e).trim();
}
function leseZahl(text) {
  const t = String(text ?? '').trim().replace(',', '.');
  if (t === '') return null;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? n : NaN;
}
function vergleich(a, b) { return a.localeCompare(b, 'de', { sensitivity: 'base' }); }

// ---------- Daten ----------

async function ladeRezepte() {
  if (zustand.rezepte) return zustand.rezepte;
  const snap = await getDocs(collection(db, 'rezepte'));
  zustand.rezepte = snap.docs.map(d => ({ id: d.id, ...d.data() }))
    .sort((a, b) => vergleich(a.titel || '', b.titel || ''));
  return zustand.rezepte;
}
function findeRezept(id) {
  return (zustand.rezepte || []).find(r => r.id === id) || null;
}
async function pruefeFreigabe(nutzer) {
  try {
    const snap = await getDoc(doc(db, 'erlaubteNutzer', (nutzer.email || '').toLowerCase()));
    return snap.exists() ? { rolle: snap.data().rolle || 'familie' } : false;
  } catch (fehler) {
    // Die Regeln verweigern das Lesen, wenn die Adresse nicht freigegeben ist.
    console.warn('Freigabe-Pruefung:', fehler.code || fehler);
    return false;
  }
}

// ---------- Ansichten ----------

function ansichtAnmeldung() {
  const meldung = el('p', { class: 'fehler', role: 'alert' });
  const mail = el('input', { id: 'mail', type: 'email', autocomplete: 'username', placeholder: 'name@beispiel.de', required: true });
  const pw = el('input', { id: 'pw', type: 'password', autocomplete: 'current-password', placeholder: 'Passwort', required: true });
  const senden = el('button', { class: 'knopf haupt', type: 'submit', text: 'Anmelden' });

  const form = el('form', {
    class: 'karte-form',
    onsubmit: async (ev) => {
      ev.preventDefault();
      meldung.textContent = '';
      senden.disabled = true;
      try {
        await signInWithEmailAndPassword(auth, mail.value.trim(), pw.value);
      } catch (fehler) {
        const code = fehler.code || '';
        meldung.textContent =
          code === 'auth/too-many-requests' ? 'Zu viele Versuche. Bitte später erneut versuchen.' :
          code === 'auth/network-request-failed' ? 'Keine Internetverbindung.' :
          'E-Mail oder Passwort ist falsch.';
      } finally {
        senden.disabled = false;
      }
    }
  },
    el('h2', { text: 'Anmelden' }),
    el('div', { class: 'feld' }, el('label', { for: 'mail', text: 'E-Mail' }), mail),
    el('div', { class: 'feld' }, el('label', { for: 'pw', text: 'Passwort' }), pw),
    meldung,
    senden,
    el('button', {
      class: 'textknopf', type: 'button', text: 'Passwort vergessen?',
      onclick: async () => {
        const adresse = mail.value.trim();
        if (!adresse) { meldung.textContent = 'Bitte zuerst die E-Mail-Adresse eingeben.'; return; }
        try { await sendPasswordResetEmail(auth, adresse); } catch (f) { console.warn(f.code || f); }
        meldung.textContent = 'Falls die Adresse bekannt ist, kommt gleich eine E-Mail zum Zurücksetzen.';
      }
    })
  );

  zeige(
    el('header', { class: 'kopf' },
      el('div', { class: 'logo' }, icon('logo')),
      el('h1', { text: 'Familien-Kochbuch' }),
      el('p', { text: 'Rezepte der Familie, an einem Ort.' })
    ),
    form,
    el('p', { class: 'fuss', text: 'Nur für freigegebene Familienmitglieder.' })
  );
}

function ansichtKeinZugang() {
  zeige(el('div', { class: 'seite' },
    el('h1', { text: 'Kein Zugang' }),
    el('p', { text: `Die Adresse ${zustand.nutzer?.email || ''} ist nicht freigegeben. Bitte bei Daniel melden.` }),
    el('button', { class: 'knopf', type: 'button', text: 'Abmelden', onclick: () => signOut(auth) })
  ));
}

function ansichtFehler(text) {
  zeige(el('div', { class: 'seite' },
    el('h1', { text: 'Das hat nicht geklappt' }),
    el('p', { text }),
    el('button', { class: 'knopf haupt', type: 'button', text: 'Neu laden', onclick: () => location.reload() })
  ));
}

async function ansichtListe() {
  zeige(el('p', { class: 'laden', text: 'Rezepte werden geladen …' }));
  let rezepte;
  try { rezepte = await ladeRezepte(); } catch (f) {
    console.error(f);
    return ansichtFehler('Die Rezepte konnten nicht geladen werden. Bitte Internetverbindung prüfen.');
  }

  const liste = el('div', { class: 'liste' });
  const anzahl = el('p', { class: 'hinweis' });
  const chips = el('div', { class: 'chips', role: 'group', 'aria-label': 'Kategorie' });
  const kategorien = [...new Set(rezepte.map(r => (r.kategorie || '').trim()).filter(Boolean))].sort(vergleich);
  if (zustand.kategorie && !kategorien.includes(zustand.kategorie)) zustand.kategorie = '';

  function baueChips() {
    chips.replaceChildren(...['', ...kategorien].map(k => el('button', {
      class: 'chip', type: 'button', text: k || 'Alle',
      'aria-pressed': String(zustand.kategorie === k),
      onclick: () => { zustand.kategorie = k; baueChips(); baueListe(); }
    })));
  }

  function baueListe() {
    const s = zustand.suche.trim().toLowerCase();
    const treffer = rezepte.filter(r => {
      if (zustand.kategorie && (r.kategorie || '').trim() !== zustand.kategorie) return false;
      if (!s) return true;
      const text = [r.titel, r.kategorie, ...(r.zutaten || []).map(z => z.name)].join(' ').toLowerCase();
      return text.includes(s);
    });
    anzahl.textContent = treffer.length === 1 ? '1 Rezept' : `${treffer.length} Rezepte`;
    if (rezepte.length === 0) {
      liste.replaceChildren(el('p', { class: 'nachricht', text: 'Noch keine Rezepte. Lege mit „Neues Rezept“ das erste an.' }));
      return;
    }
    liste.replaceChildren(...treffer.map(r => {
      const info = [r.kategorie, r.zeitMin ? `${r.zeitMin} Min` : '', r.portionen ? `${zahl(r.portionen, 0.5)} Portionen` : '']
        .filter(Boolean).join(' · ');
      return el('a', { class: 'karte', href: `#/rezept/${encodeURIComponent(r.id)}` },
        el('div', { class: 'karte-text' },
          el('span', { class: 'karte-titel', text: r.titel || 'Ohne Titel' }),
          info ? el('span', { class: 'karte-info', text: info }) : null
        ),
        icon('weiter')
      );
    }));
  }

  const suchfeld = el('input', {
    id: 'suche', type: 'search', placeholder: 'Titel oder Zutat suchen', value: zustand.suche,
    oninput: (ev) => { zustand.suche = ev.target.value; baueListe(); }
  });

  baueChips();
  baueListe();
  zeige(
    el('div', { class: 'seite' },
      el('div', { class: 'leiste' },
        el('h1', { text: 'Rezepte' }),
        el('button', { class: 'textknopf', type: 'button', text: 'Abmelden', onclick: () => signOut(auth) })
      ),
      el('label', { for: 'suche', class: 'label', style: 'position:absolute;left:-9999px', text: 'Suche' }),
      el('div', { class: 'suche' }, icon('suche'), suchfeld),
      chips,
      anzahl,
      liste
    ),
    el('a', { class: 'knopf haupt neu', href: '#/neu' }, icon('plus'), 'Neues Rezept')
  );
}

function ansichtRezept(id) {
  const r = findeRezept(id);
  if (!r) { location.hash = '#/'; return; }

  const basisPortionen = r.portionen > 0 ? r.portionen : 1;
  const zutaten = r.zutaten || [];
  const schritte = r.schritte || [];
  const s = { faktor: 1, basisText: '', auswahl: -1, eingabe: '', erledigt: new Set() };

  function neuZeichnen() {
    const f = s.faktor;
    const p = basisPortionen * f;

    const zutatenListe = el('div', { class: 'box zutaten' }, ...zutaten.map((z, i) => {
      const hatMenge = typeof z.menge === 'number' && z.menge > 0;
      const offen = s.auswahl === i;
      const zeile = el('div', { class: 'zutat-zeile' },
        hatMenge
          ? el('button', {
              class: 'menge', type: 'button', 'aria-expanded': String(offen),
              'aria-label': `Rezept nach ${z.name || 'dieser Zutat'} umrechnen, aktuell ${mengeText(z.menge * f, z.einheit)}`,
              text: mengeText(z.menge * f, z.einheit),
              onclick: () => {
                const v = z.menge * f;
                s.auswahl = offen ? -1 : i;
                s.eingabe = zahl(v, schrittFuer(v, z.einheit));
                neuZeichnen();
              }
            })
          : el('span', { class: 'menge-leer' }),
        el('span', { class: 'zutat-name', text: z.name || '' })
      );
      let umrechner = null;
      if (offen) {
        const feld = el('input', {
          id: 'basismenge', type: 'text', inputmode: 'decimal', value: s.eingabe,
          oninput: (ev) => { s.eingabe = ev.target.value; }
        });
        const umrechnen = () => {
          const wert = leseZahl(s.eingabe);
          if (!(wert > 0)) { feld.focus(); return; }
          s.faktor = wert / z.menge;
          s.basisText = `Umgerechnet auf ${String(wert).replace('.', ',')} ${z.einheit || ''} ${z.name || ''}`.replace(/\s+/g, ' ');
          s.auswahl = -1;
          neuZeichnen();
        };
        feld.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') umrechnen(); });
        umrechner = el('div', { class: 'umrechner' },
          el('label', { for: 'basismenge', class: 'label', text: 'Wie viel hast du davon?' }),
          el('div', { class: 'umrechner-zeile' },
            feld,
            el('span', { text: z.einheit || '' }),
            el('button', { class: 'knopf haupt', type: 'button', text: 'Umrechnen', onclick: umrechnen })
          ),
          el('button', { class: 'textknopf', type: 'button', style: 'align-self:flex-start', text: 'Abbrechen',
            onclick: () => { s.auswahl = -1; neuZeichnen(); } })
        );
        setTimeout(() => feld.focus(), 0);
      }
      return el('div', { class: 'zutat' }, zeile, umrechner);
    }));

    const schrittListe = el('div', { class: 'schritte' }, ...schritte.map((text, i) => el('button', {
      class: 'schritt' + (s.erledigt.has(i) ? ' erledigt' : ''), type: 'button',
      'aria-pressed': String(s.erledigt.has(i)),
      onclick: () => { s.erledigt.has(i) ? s.erledigt.delete(i) : s.erledigt.add(i); neuZeichnen(); }
    },
      el('span', { class: 'schritt-nr', text: String(i + 1) }),
      el('span', { class: 'schritt-text', text })
    )));

    const y = window.scrollY;
    wurzel.replaceChildren(el('div', { class: 'seite' },
      el('div', { class: 'leiste' },
        el('a', { class: 'zurueck', href: '#/' }, icon('zurueck'), 'Rezepte'),
        el('a', { class: 'zurueck', href: `#/bearbeiten/${encodeURIComponent(r.id)}` }, icon('stift'), 'Bearbeiten')
      ),
      el('div', { class: 'abschnitt' },
        r.kategorie ? el('div', { class: 'kategorie', text: r.kategorie }) : null,
        el('h1', { text: r.titel || 'Ohne Titel' }),
        el('div', { class: 'meta' },
          r.zeitMin ? el('span', { text: `${r.zeitMin} Min` }) : null,
          r.variantenName ? el('span', { text: r.variantenName }) : null
        )
      ),
      el('div', { class: 'box portionen' },
        el('div', {},
          el('div', { class: 'hinweis', text: 'Portionen' }),
          el('div', { class: 'portionen-zahl', text: zahl(p, 0.1) })
        ),
        el('div', { class: 'plusminus' },
          el('button', { type: 'button', 'aria-label': 'Eine Portion weniger',
            onclick: () => { s.faktor = Math.max(1, p - 1) / basisPortionen; s.basisText = ''; s.auswahl = -1; neuZeichnen(); } }, icon('minus')),
          el('button', { class: 'haupt', type: 'button', 'aria-label': 'Eine Portion mehr',
            onclick: () => { s.faktor = Math.min(100, p + 1) / basisPortionen; s.basisText = ''; s.auswahl = -1; neuZeichnen(); } }, icon('plus'))
        )
      ),
      s.basisText ? el('div', { class: 'basis' },
        el('span', { text: s.basisText }),
        el('button', { class: 'knopf', type: 'button', text: 'Zurücksetzen',
          onclick: () => { s.faktor = 1; s.basisText = ''; s.auswahl = -1; neuZeichnen(); } })
      ) : null,
      zutaten.length ? el('section', { class: 'abschnitt' },
        el('h2', { text: 'Zutaten' }),
        el('p', { class: 'hinweis', text: 'Tippe auf eine Menge, um das Rezept nach dieser Zutat umzurechnen.' }),
        zutatenListe
      ) : null,
      schritte.length ? el('section', { class: 'abschnitt' },
        el('h2', { text: 'Zubereitung' }),
        el('p', { class: 'hinweis', text: 'Tippe auf einen Schritt, wenn er erledigt ist.' }),
        schrittListe
      ) : null,
      r.notizen ? el('section', { class: 'abschnitt' },
        el('h2', { text: 'Notizen' }),
        el('div', { class: 'box notizen', text: r.notizen })
      ) : null
    ));
    window.scrollTo(0, y);
  }

  window.scrollTo(0, 0);
  neuZeichnen();
}

function ansichtBearbeiten(id) {
  const vorhanden = id ? findeRezept(id) : null;
  if (id && !vorhanden) { location.hash = '#/'; return; }

  // Entwurf = Kopie, damit Abbrechen nichts veraendert. Zusatzfelder (gramm, blsCode ...) bleiben erhalten.
  const e = {
    titel: vorhanden?.titel || '',
    kategorie: vorhanden?.kategorie || '',
    portionen: vorhanden?.portionen ? String(vorhanden.portionen).replace('.', ',') : '4',
    zeitMin: vorhanden?.zeitMin ? String(vorhanden.zeitMin) : '',
    zutaten: (vorhanden?.zutaten || []).map(z => ({ ...z, mengeText: z.menge === null || z.menge === undefined ? '' : String(z.menge).replace('.', ',') })),
    schritte: [...(vorhanden?.schritte || [])],
    notizen: vorhanden?.notizen || ''
  };
  if (e.zutaten.length === 0) e.zutaten.push({ mengeText: '', einheit: '', name: '' });
  if (e.schritte.length === 0) e.schritte.push('');

  const kategorien = [...new Set((zustand.rezepte || []).map(r => (r.kategorie || '').trim()).filter(Boolean))].sort(vergleich);
  const meldung = el('p', { class: 'fehler', role: 'alert' });

  function feld(idName, label, input) {
    return el('div', { class: 'feld' }, el('label', { for: idName, text: label }), input);
  }

  function neuZeichnen() {
    const zutatenForm = e.zutaten.map((z, i) => el('div', { class: 'zutat-form' },
      el('input', { type: 'text', inputmode: 'decimal', 'aria-label': `Menge Zutat ${i + 1}`, placeholder: 'Menge', value: z.mengeText,
        oninput: (ev) => { z.mengeText = ev.target.value; } }),
      el('input', { type: 'text', 'aria-label': `Einheit Zutat ${i + 1}`, placeholder: 'g', value: z.einheit || '',
        oninput: (ev) => { z.einheit = ev.target.value; } }),
      el('input', { type: 'text', 'aria-label': `Name Zutat ${i + 1}`, placeholder: 'Zutat', value: z.name || '',
        oninput: (ev) => { z.name = ev.target.value; } }),
      el('button', { class: 'iconknopf entfernen', type: 'button', 'aria-label': `Zutat ${i + 1} entfernen`,
        onclick: () => { e.zutaten.splice(i, 1); neuZeichnen(); } }, icon('x'))
    ));

    const schritteForm = e.schritte.map((text, i) => el('div', { class: 'schritt-form' },
      el('span', { class: 'schritt-nr', text: String(i + 1) }),
      el('textarea', { 'aria-label': `Schritt ${i + 1}`, rows: '3', value: text,
        oninput: (ev) => { e.schritte[i] = ev.target.value; } }),
      el('button', { class: 'iconknopf entfernen', type: 'button', 'aria-label': `Schritt ${i + 1} entfernen`,
        onclick: () => { e.schritte.splice(i, 1); neuZeichnen(); } }, icon('x'))
    ));

    const y = window.scrollY;
    wurzel.replaceChildren(el('form', { class: 'seite', onsubmit: (ev) => { ev.preventDefault(); speichern(); } },
      el('div', { class: 'leiste' },
        el('a', { class: 'zurueck', href: vorhanden ? `#/rezept/${encodeURIComponent(vorhanden.id)}` : '#/', text: 'Abbrechen' }),
        el('strong', { text: vorhanden ? 'Rezept bearbeiten' : 'Neues Rezept' })
      ),
      feld('titel', 'Titel', el('input', { id: 'titel', type: 'text', required: true, value: e.titel, oninput: (ev) => { e.titel = ev.target.value; } })),
      feld('kat', 'Kategorie', el('input', { id: 'kat', type: 'text', list: 'kategorien', value: e.kategorie, placeholder: 'z. B. Suppen', oninput: (ev) => { e.kategorie = ev.target.value; } })),
      el('datalist', { id: 'kategorien' }, ...kategorien.map(k => el('option', { value: k }))),
      el('div', { class: 'zwei' },
        feld('port', 'Portionen', el('input', { id: 'port', type: 'text', inputmode: 'decimal', value: e.portionen, oninput: (ev) => { e.portionen = ev.target.value; } })),
        feld('zeit', 'Zeit (Min)', el('input', { id: 'zeit', type: 'text', inputmode: 'numeric', value: e.zeitMin, oninput: (ev) => { e.zeitMin = ev.target.value; } }))
      ),
      el('section', { class: 'abschnitt' },
        el('h2', { text: 'Zutaten' }),
        el('p', { class: 'hinweis', text: 'Menge leer lassen bei „Salz nach Geschmack“. Komma oder Punkt sind erlaubt.' }),
        ...zutatenForm,
        el('button', { class: 'knopf gestrichelt', type: 'button', onclick: () => { e.zutaten.push({ mengeText: '', einheit: '', name: '' }); neuZeichnen(); } },
          icon('plus'), 'Zutat hinzufügen')
      ),
      el('section', { class: 'abschnitt' },
        el('h2', { text: 'Zubereitung' }),
        ...schritteForm,
        el('button', { class: 'knopf gestrichelt', type: 'button', onclick: () => { e.schritte.push(''); neuZeichnen(); } },
          icon('plus'), 'Schritt hinzufügen')
      ),
      feld('notiz', 'Notizen', el('textarea', { id: 'notiz', rows: '3', value: e.notizen, oninput: (ev) => { e.notizen = ev.target.value; } })),
      meldung,
      el('div', { class: 'aktionen' },
        el('button', { class: 'knopf haupt', type: 'submit', text: 'Speichern' }),
        vorhanden ? el('button', { class: 'knopf gefahr', type: 'button', text: 'Rezept löschen', onclick: loeschen }) : null
      )
    ));
    window.scrollTo(0, y);
  }

  async function speichern() {
    meldung.textContent = '';
    const titel = e.titel.trim();
    if (!titel) { meldung.textContent = 'Bitte einen Titel eingeben.'; return; }
    const portionen = leseZahl(e.portionen);
    if (!(portionen > 0)) { meldung.textContent = 'Bitte bei Portionen eine Zahl größer 0 eingeben.'; return; }
    const zeit = leseZahl(e.zeitMin);
    if (Number.isNaN(zeit)) { meldung.textContent = 'Bitte bei Zeit eine Zahl eingeben.'; return; }

    const zutaten = [];
    for (const [i, z] of e.zutaten.entries()) {
      const name = (z.name || '').trim();
      const menge = leseZahl(z.mengeText);
      if (!name && menge === null && !(z.einheit || '').trim()) continue; // leere Zeile
      if (!name) { meldung.textContent = `Zutat ${i + 1}: Bitte einen Namen eingeben.`; return; }
      if (Number.isNaN(menge)) { meldung.textContent = `Zutat ${i + 1}: Die Menge ist keine Zahl.`; return; }
      const { mengeText, ...rest } = z;
      zutaten.push({
        ...rest,
        menge,
        einheit: (z.einheit || '').trim(),
        name,
        gramm: rest.gramm ?? null,
        blsCode: rest.blsCode ?? null,
        werte100g: rest.werte100g ?? null
      });
    }

    const daten = {
      titel,
      kategorie: e.kategorie.trim(),
      portionen,
      zeitMin: zeit,
      zutaten,
      schritte: e.schritte.map(t => t.trim()).filter(Boolean),
      notizen: e.notizen.trim(),
      originalId: vorhanden?.originalId ?? null,
      variantenName: vorhanden?.variantenName ?? null,
      geaendertVon: zustand.nutzer.email,
      geaendertAm: serverTimestamp()
    };

    try {
      let neueId = vorhanden?.id;
      if (vorhanden) await updateDoc(doc(db, 'rezepte', vorhanden.id), daten);
      else neueId = (await addDoc(collection(db, 'rezepte'), daten)).id;

      const lokal = { id: neueId, ...daten, geaendertAm: new Date() };
      zustand.rezepte = [...(zustand.rezepte || []).filter(r => r.id !== neueId), lokal]
        .sort((a, b) => vergleich(a.titel || '', b.titel || ''));
      location.hash = `#/rezept/${encodeURIComponent(neueId)}`;
    } catch (f) {
      console.error(f);
      meldung.textContent = 'Speichern fehlgeschlagen. Bitte Internetverbindung prüfen.';
    }
  }

  async function loeschen() {
    if (!confirm(`„${vorhanden.titel}“ wirklich löschen? Das lässt sich nicht rückgängig machen.`)) return;
    try {
      await deleteDoc(doc(db, 'rezepte', vorhanden.id));
      zustand.rezepte = (zustand.rezepte || []).filter(r => r.id !== vorhanden.id);
      location.hash = '#/';
    } catch (f) {
      console.error(f);
      meldung.textContent = 'Löschen fehlgeschlagen. Bitte Internetverbindung prüfen.';
    }
  }

  window.scrollTo(0, 0);
  neuZeichnen();
}

// ---------- Navigation ----------

async function route() {
  if (!zustand.nutzer) return ansichtAnmeldung();
  if (zustand.freigabe === null) return zeige(el('p', { class: 'laden', text: 'Lädt …' }));
  if (zustand.freigabe === false) return ansichtKeinZugang();

  const teile = location.hash.replace(/^#\/?/, '').split('/');
  const id = teile[1] ? decodeURIComponent(teile[1]) : '';

  if (teile[0] === 'rezept' || teile[0] === 'bearbeiten') {
    try { await ladeRezepte(); } catch (f) {
      console.error(f);
      return ansichtFehler('Die Rezepte konnten nicht geladen werden. Bitte Internetverbindung prüfen.');
    }
    return teile[0] === 'rezept' ? ansichtRezept(id) : ansichtBearbeiten(id);
  }
  if (teile[0] === 'neu') {
    try { await ladeRezepte(); } catch (f) { console.error(f); }
    return ansichtBearbeiten('');
  }
  return ansichtListe();
}

window.addEventListener('hashchange', route);

onAuthStateChanged(auth, async (nutzer) => {
  zustand.nutzer = nutzer;
  zustand.freigabe = null;
  zustand.rezepte = null;
  if (nutzer) {
    route();
    zustand.freigabe = await pruefeFreigabe(nutzer);
  } else {
    if (location.hash) history.replaceState(null, '', location.pathname);
  }
  route();
});
