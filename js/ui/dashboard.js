// =============================================================================
// ui/dashboard.js — the start page.
//
// The app used to drop you straight into a mode. This is what it opens on instead:
// what you have collected, and three ways in.
//
// IT MAKES NO NETWORK REQUEST OF ITS OWN. Everything it counts is already in
// localStorage by the time this module is imported, and the only file it reads is the
// committed data/sets.json — through the snapshot provider's session memo, so when
// Master Set has already loaded (or later does) there is no second fetch. That is what
// makes it safe to render on every boot: it costs nothing, works offline, and is
// correct before any card has been fetched.
//
// Everything countable lives in dashboard-model.js so `node --test` can cover it,
// including the JP id special case — see the comment on parseCardId.
//
// Built with createElement/textContent throughout. Set names come from a remote API via
// the snapshot, and the Pokémon list can come from a shared "#s=" link, so nothing here
// may go anywhere near innerHTML.
// =============================================================================

import { state, saveSetTarget } from '../state.js';
import { POKEMON_CATALOG } from '../config.js';
import { getSetMeta } from '../api/providers/snapshot.js';
import { summarise, languageBars, plural, formatSetDate, expansionRows } from './dashboard-model.js';
import { langColor } from './masterset.js';

// Session-lifetime, and deliberately not invalidated: sets.json is a build artefact, so
// within one document it cannot change. A failure is remembered as `null` rather than
// retried on every render — the dashboard degrades to bare set ids, which is a cosmetic
// loss, not a reason to hammer a file that is not there.
let setMeta;

async function loadSetMeta() {
  if (setMeta !== undefined) return setMeta;
  try {
    // [] asks for no specific set, so getSetMeta's date-coverage check has nothing to
    // fail on and this reads the snapshot for its names/dates alone.
    setMeta = await getSetMeta([]);
  } catch {
    setMeta = null;   // placeholder snapshot, or the file is missing
  }
  return setMeta;
}

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

/** A titled box. The top row is two of these side by side. */
function panel(title) {
  const p = el('section', 'dash-panel');
  p.appendChild(el('h2', 'dash-panel-title', title));
  return p;
}

/** One label-over-value pair inside the summary panel. */
function stat(label, value, hint) {
  const box = el('div', 'dash-stat');
  box.append(el('div', 'dash-stat-label', label), el('div', 'dash-stat-value', String(value)));
  if (hint) box.appendChild(el('div', 'dash-stat-hint', hint));
  return box;
}

/**
 * One of the three ways in.
 *
 * `mode` null renders the card inert — that is single-set mode, which does not exist
 * yet. It is shown rather than hidden so the row does not reflow when it lands.
 */
function modeCard({ mode, icon, title, count, blurb, accent }) {
  const card = el(mode ? 'button' : 'div', 'dash-card' + (accent ? ' accent' : '') + (mode ? '' : ' disabled'));
  if (mode) {
    card.type = 'button';
    // An event, not an import of setMode: main.js imports this module, so calling back
    // into it directly would close a cycle. Same decoupling as 'tcg:collapse-changed'
    // and 'tcg:tms-changed' — and unlike window.setMode it does not depend on the
    // inline-handler bridge, which exists for the MARKUP, not for other modules.
    card.addEventListener('click', () => {
      document.dispatchEvent(new CustomEvent('tcg:set-mode', { detail: { mode } }));
    });
  } else {
    card.setAttribute('aria-disabled', 'true');
  }
  const head = el('div', 'dash-card-head');
  head.append(el('span', 'dash-card-icon', icon), el('span', 'dash-card-title', title));
  card.append(head, el('div', 'dash-card-count', count), el('div', 'dash-card-blurb', blurb));
  // Purely decorative: the whole card is the control, and it already has an accessible
  // name from its text.
  const chev = el('span', 'dash-card-chevron', '›');
  chev.setAttribute('aria-hidden', 'true');
  card.appendChild(chev);
  return card;
}

/**
 * Distribution by language, as a column chart.
 *
 * Columns rather than the horizontal bars this used to draw: with up to twelve
 * languages the horizontal form is a tall stack of near-empty rows, while the vertical
 * one reads as a single shape — you see "overwhelmingly English with a JP tail" without
 * reading any number.
 *
 * Heights are relative to the TALLEST language, not to the total (see languageBars), so
 * the true proportion goes in the tooltip where it cannot be misread off the bar.
 */
function distributionPanel(sum) {
  const p = panel('Distribution by language');
  const bars = languageBars(sum.languages);
  if (!bars.length) {
    p.appendChild(el('p', 'dash-note', 'Nothing collected yet.'));
    return p;
  }
  const chart = el('div', 'dash-chart');
  for (const b of bars) {
    const col = el('div', 'dash-col');
    col.title = `${b.key}: ${plural(b.count, 'card')} — ${b.share}% of your master set`;
    col.append(el('span', 'dash-col-value', String(b.count)));
    const track = el('span', 'dash-col-track');
    const fill = el('span', 'dash-col-fill');
    fill.style.height = `${Math.max(b.pct, 2)}%`;   // 2% floor so a count of 1 is still a bar
    fill.style.background = langColor(b.key);
    track.appendChild(fill);
    const badge = el('span', 'dash-col-badge', b.key);
    badge.style.background = langColor(b.key);
    col.append(track, badge);
    chart.appendChild(col);
  }
  p.appendChild(chart);
  return p;
}

/**
 * "Expansions": one card per set you hold, with its symbol, release date and progress
 * against the set's official size.
 *
 * The denominator is `counts` from data/sets.json — the field threaded through the
 * provider chain for single-set mode. A snapshot built before it existed carries no
 * counts, and those sets show a card total with no bar rather than a fake 0%.
 */
/**
 * One expansion card: art, name, date, progress, "N of M".
 *
 * EXPORTED because the single-set picker renders the same card for all 200+ sets — the
 * two views differ only in which rows they are given and what a click does, so cloning
 * this markup there would be two copies of the logo→symbol→id fallback chain to keep in
 * step.
 *
 * Always a <button>: on the dashboard it opens the set, in the picker it chooses one.
 * `onPick` receives the row's set id.
 */
export function expansionCard(r, { onPick, inert = false } = {}) {
  const card = el('button', 'dash-exp' + (inert ? ' inert' : ''));
  card.type = 'button';
  if (inert) card.disabled = true;
  else if (onPick) card.addEventListener('click', () => onPick(r.id));

  // Logo first — it is the wordmark art, which is what makes a set recognisable at a
  // glance. The symbol is the mono glyph and works as a fallback; some sets have neither,
  // so the art box has to look deliberate when empty.
  const art = el('div', 'dash-exp-art');
  const artSrc = r.logo || r.symbol;
  if (artSrc) {
    const img = el('img', r.logo ? 'dash-exp-logo' : 'dash-exp-sym');
    img.src = artSrc; img.alt = ''; img.loading = 'lazy';
    // Text fallback rather than an empty box, and it has to be installed on ERROR too:
    // a url that 404s leaves exactly the same hole as no url at all.
    img.onerror = () => { img.remove(); art.appendChild(el('span', 'dash-exp-artid', r.id)); };
    art.appendChild(img);
  } else {
    art.appendChild(el('span', 'dash-exp-artid', r.id));
  }
  card.appendChild(art);

  const body = el('div', 'dash-exp-body');
  body.append(
    el('div', 'dash-exp-name', r.name),
    el('div', 'dash-exp-date', formatSetDate(r.date) || r.id),
  );
  const track = el('div', 'dash-exp-track');
  const fill = el('div', 'dash-exp-fill');
  fill.style.width = `${r.pct ?? 0}%`;
  track.appendChild(fill);
  // No count in sets.json ⇒ no bar at all, rather than an empty one that reads as 0%.
  if (r.pct === null) track.classList.add('unknown');
  body.appendChild(track);

  const foot = el('div', 'dash-exp-foot');
  foot.appendChild(el('span', 'dash-exp-count',
    r.total ? `${r.owned} of ${r.total}` : plural(r.owned, 'card')));
  // The symbol goes here rather than in the art box when the logo already occupies it —
  // the two are different marks and the set is identified by both.
  if (r.symbol && r.logo) {
    const sym = el('img', 'dash-exp-foot-sym');
    sym.src = r.symbol; sym.alt = ''; sym.loading = 'lazy';
    sym.onerror = () => sym.remove();
    foot.appendChild(sym);
  } else if (r.pct !== null) {
    foot.appendChild(el('span', 'dash-exp-pct', `${r.pct}%`));
  }
  body.appendChild(foot);
  card.appendChild(body);
  // Distinct cards is what the denominator counts; printings only differ once you
  // collect the same card in more than one language, so it is a footnote, not a column.
  card.title = r.printings != null && r.printings !== r.owned
    ? `${r.name} — ${plural(r.owned, 'card')} across ${plural(r.printings, 'printing')}`
    : `${r.name} — ${plural(r.owned, 'card')}`;
  return card;
}

/**
 * Open a set in single-set mode.
 *
 * Sets the target itself and then asks for the mode switch through the same event the
 * three mode cards use — main.js owns setMode, and importing it here would close a cycle
 * (main.js imports this module).
 */
function openSet(setId) {
  state.ssTarget = setId;
  saveSetTarget();
  document.dispatchEvent(new CustomEvent('tcg:set-mode', { detail: { mode: 'set' } }));
}

function expansionsSection(sum, meta) {
  const wrap = el('section', 'dash-section');
  const head = el('div', 'dash-section-head');
  head.appendChild(el('h2', 'dash-section-title', 'Expansions'));
  head.appendChild(el('span', 'dash-section-count',
    `${sum.setsTouched} ${sum.setsTouched === 1 ? 'set' : 'sets'}`));
  wrap.appendChild(head);

  if (!sum.sets.length) {
    wrap.appendChild(el('p', 'dash-note', 'No sets yet — tick a card in Master set mode.'));
    return wrap;
  }

  const grid = el('div', 'dash-exp-grid');
  for (const r of expansionRows(sum.setsByDate, meta, 6)) {
    grid.appendChild(expansionCard(r, { onPick: openSet }));
  }
  wrap.appendChild(grid);
  return wrap;
}

/**
 * Render the start page into #dash.
 *
 * Synchronous as far as the caller is concerned: the metrics and the three cards are
 * painted immediately from localStorage, and the set NAMES are filled in when
 * data/sets.json resolves. That ordering is the point — nothing the user reads first
 * has to wait on a file read.
 */
/**
 * Home's context bar — the one every mode has, so the sticky chrome is a constant
 * height. Real content rather than a reserved blank: a live one-line summary.
 */
function renderDashBar(sum) {
  const bar = document.getElementById('dash-bar');
  if (!bar) return;
  bar.textContent = '';
  const line = el('div', 'dash-bar-text');
  if (sum.empty) {
    line.textContent = 'Nothing collected yet — pick a mode below to start.';
  } else {
    const bits = [
      [sum.cards, 'master set card'],
      [sum.setsTouched, 'set'],
      [sum.tmsCards, 'true master set card'],
      [sum.setCards, 'single-set card'],
    ].filter(([n]) => n > 0);
    for (const [i, [n, word]] of bits.entries()) {
      if (i) line.appendChild(document.createTextNode(' · '));
      const b = document.createElement('strong');
      b.textContent = String(n);
      line.append(b, document.createTextNode(` ${n === 1 ? word : `${word}s`}`));
    }
  }
  bar.appendChild(line);
}

export function renderDashboard() {
  const root = document.getElementById('dash');
  if (!root) return;

  const sum = summarise({
    msIds: [...state.checked],
    tmsIds: [...state.tmsIncluded],
    setIds: [...state.ssChecked],
    pokemon: state.pokemonList,
  });

  root.textContent = '';
  renderDashBar(sum);

  if (sum.empty) {
    const intro = el('section', 'dash-empty');
    intro.append(
      el('h2', 'dash-empty-title', 'Nothing collected yet'),
      el('p', 'dash-empty-body',
        'Pick a mode below to start. Master set tracks every printing of your chosen ' +
        'Pokémon in every language; true master set is a hand-picked list.'),
    );
    root.appendChild(intro);
  } else {
    // Top row: the summary panel beside the distribution chart.
    const top = el('section', 'dash-top');

    const summary = panel('Your collection');
    summary.append(
      // 'of N' where N is the catalogue this app can actually track. A bare "3" says
      // nothing; the pair says how much room is left.
      stat('Pokémon tracked', `${sum.pokemon} of ${POKEMON_CATALOG.length}`),
      // 'Master set cards', not 'Cards owned': with three independent checklists a single
      // unqualified total would read as the whole collection while counting one third of
      // it. Each checklist's own number is on its own card below.
      // (No 'mostly EN' hint — the distribution chart beside this says it better.)
      stat('Master set cards', sum.cards),
      stat('Sets touched', sum.setsTouched),
    );
    top.appendChild(summary);
    top.appendChild(distributionPanel(sum));
    root.appendChild(top);
  }

  // The three ways in. Master set is accented when there is something to go back to,
  // otherwise it is still the obvious first move — it is the mode that fetches cards.
  const cards = el('section', 'dash-modes');
  cards.append(
    modeCard({
      mode: 'master', icon: '🌿', title: 'Master set',
      count: plural(sum.cards, 'card'),
      blurb: 'Every printing of your Pokémon, in every language.',
      accent: true,
    }),
    modeCard({
      mode: 'tms', icon: '⭐', title: 'True master set',
      count: plural(sum.tmsCards, 'card'),
      blurb: 'Only the printings you hand-pick.',
    }),
    modeCard({
      mode: 'set', icon: '📘', title: 'Single set',
      count: plural(sum.setCards, 'card'),
      blurb: state.ssTarget
        ? `Continue ${state.ssTarget}.`
        : 'Complete one expansion, start to finish.',
    }),
  );
  root.appendChild(cards);

  if (sum.empty) return;

  // Set names and DATES arrive late and only ever ADD a section, so a slow or missing
  // data/sets.json cannot hold up or break anything above.
  loadSetMeta().then(meta => {
    // Guard against a mode switch (or another render) landing while this was in flight.
    if (state.appMode !== 'dash' || !root.isConnected) return;
    // Re-summarised WITH the dates: setsByDate cannot be ordered until they exist, and
    // the first pass above deliberately runs before any file read. Cheap — it is one
    // walk of the checklist — and it keeps "newest set first" true rather than
    // silently degrading to alphabetical-by-set-id whenever the dates load late.
    const dated = summarise({
      msIds: [...state.checked],
      tmsIds: [...state.tmsIncluded],
      setIds: [...state.ssChecked],
      pokemon: state.pokemonList,
      setDates: meta?.dates || {},
    });
    const existing = root.querySelector('.dash-sets-section');
    if (existing) existing.remove();
    const section = expansionsSection(dated, meta);
    section.classList.add('dash-sets-section');
    root.insertBefore(section, cards);
  });
}
