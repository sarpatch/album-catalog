// Kenttäeditori: lisää, nimeä, järjestä, piilota ja poista kenttiä sovelluksessa.
// Tallentaa saman kentat.json-määrittelyn, jota voi muokata myös tekstieditorilla.

import { h, icon, openDialog, toast } from './ui.js';
import { TYPES, CORE_FIELDS, normalizeSchema, uniqueKey } from './schema.js';

const CORE = new Set(CORE_FIELDS.map((f) => f.key));

/**
 * @param {object} p
 * @param {object} p.schema
 * @param {string} p.locationText  missä kentat.json sijaitsee
 * @param {(schema: object, warnings: string[]) => Promise<void>} p.onSave
 * @param {() => void} p.onExport
 * @param {() => void} p.onImport
 * @param {() => Promise<boolean>} p.onReset
 */
export function openFieldEditor({ schema, locationText, onSave, onExport, onImport, onReset }) {
  const draft = structuredClone(schema.fields);
  const list = h('div', { class: 'fe-list' });
  const groupList = h('datalist', { id: 'fe-groups' });
  let dirty = false;
  const touch = () => { dirty = true; };

  const flag = (text, checked, onchange, disabled = false) => h('label', { class: 'fe-flag' },
    h('input', { type: 'checkbox', checked: !!checked, disabled, onchange: (e) => { onchange(e.target.checked); touch(); } }),
    h('span', {}, text));

  function move(i, d) {
    const j = i + d;
    if (j < 0 || j >= draft.length) return;
    [draft[i], draft[j]] = [draft[j], draft[i]];
    touch();
    draw(j, d < 0 ? 'up' : 'down');
  }

  function remove(i) {
    const [f] = draft.splice(i, 1);
    touch();
    draw();
    toast(`Kenttä ”${f.label}” poistetaan tallennettaessa. Tallennetut arvot säilyvät CSV-tiedostossa.`, {
      action: 'Peru', timeout: 7000, onAction: () => { draft.splice(i, 0, f); draw(); },
    });
  }

  function row(f, i) {
    const core = CORE.has(f.key);
    const card = h('div', { class: `fe-row${f.hidden ? ' is-hidden' : ''}`, dataset: { i } });
    const set = (patch) => { Object.assign(f, patch); touch(); };
    const typeSel = h('select', {
      disabled: core,
      onchange: (e) => {
        set({ type: e.target.value });
        if (f.type === 'select' && !f.options?.length) f.options = ['Vaihtoehto 1', 'Vaihtoehto 2'];
        draw(i);
      },
    }, Object.entries(TYPES).map(([k, n]) => h('option', { value: k, selected: f.type === k }, n)));

    card.append(
      h('div', { class: 'fe-move' },
        h('button', { type: 'button', class: 'icon-btn', 'aria-label': `Siirrä ylös: ${f.label}`, disabled: i === 0, dataset: { act: 'up' }, onclick: () => move(i, -1) }, icon('up', 18)),
        h('button', { type: 'button', class: 'icon-btn', 'aria-label': `Siirrä alas: ${f.label}`, disabled: i === draft.length - 1, dataset: { act: 'down' }, onclick: () => move(i, 1) }, icon('down', 18))),
      h('div', { class: 'fe-main' },
        h('div', { class: 'fe-line' },
          h('label', { class: 'field fe-name' }, h('span', {}, 'Nimi'),
            h('input', { value: f.label, autocomplete: 'off', 'data-role': 'label', oninput: (e) => set({ label: e.target.value }) })),
          h('label', { class: 'field' }, h('span', {}, 'Tyyppi'), typeSel),
          h('label', { class: 'field' }, h('span', {}, 'Ryhmä lomakkeella'),
            h('input', { value: f.group || '', list: 'fe-groups', autocomplete: 'off', oninput: (e) => set({ group: e.target.value }) }))),
        f.type === 'select' && h('label', { class: 'field' }, h('span', {}, 'Vaihtoehdot – yksi per rivi'),
          (() => { const t = h('textarea', { rows: Math.min(6, Math.max(3, f.options.length)), oninput: (e) => set({ options: e.target.value.split('\n').map((x) => x.trim()).filter(Boolean) }) }); t.value = f.options.join('\n'); return t; })()),
        h('div', { class: 'fe-flags' },
          flag('Pakollinen', f.required || core, (v) => { f.required = v || undefined; }, core),
          flag('Näkyy taulukossa', f.table !== false, (v) => { f.table = v ? undefined : false; }),
          flag('Piilotettu', f.hidden, (v) => { f.hidden = v || undefined; card.classList.toggle('is-hidden', v); }, core),
          h('label', { class: 'fe-default' }, h('span', {}, 'Oletusarvo'),
            h('input', { value: f.default ?? '', autocomplete: 'off', oninput: (e) => set({ default: e.target.value }) })),
          h('span', { class: 'fe-key', title: 'Sarakkeen nimi CSV-tiedostossa' }, f._new ? 'uusi kenttä' : f.key))),
      h('button', { type: 'button', class: 'icon-btn fe-del', 'aria-label': `Poista kenttä: ${f.label}`, title: core ? 'Perustietoa ei voi poistaa' : 'Poista kenttä', disabled: core, onclick: () => remove(i) }, icon('trash', 18)));
    return card;
  }

  function draw(focusIndex, focusAct) {
    groupList.replaceChildren(...[...new Set(draft.map((f) => f.group).filter(Boolean))].map((g) => h('option', { value: g })));
    list.replaceChildren(...draft.map(row));
    if (focusIndex != null) {
      const card = list.children[focusIndex];
      (card?.querySelector(`[data-act="${focusAct}"]:not(:disabled)`) || card?.querySelector('input'))?.focus({ preventScroll: false });
    }
  }
  draw();

  const addBtn = h('button', {
    type: 'button', class: 'btn',
    onclick: () => {
      draft.push({ _new: true, key: '', label: 'Uusi kenttä', type: 'text', group: 'Omat kentät' });
      touch();
      draw();
      const input = list.lastElementChild.querySelector('[data-role="label"]');
      input.scrollIntoView({ block: 'center' });
      input.focus();
      input.select();
    },
  }, icon('plus'), 'Lisää kenttä');

  async function save() {
    if (draft.some((f) => !String(f.label).trim())) { toast('Jokaisella kentällä pitää olla nimi', { kind: 'error' }); return; }
    const taken = new Set(draft.filter((f) => !f._new).map((f) => f.key));
    const fields = draft.map(({ _new, ...f }) => {
      const out = { ...f };
      if (_new) { out.key = uniqueKey(taken, f.label); taken.add(out.key); }
      if (out.default === '') delete out.default;
      for (const k of Object.keys(out)) if (out[k] === undefined) delete out[k];
      return out;
    });
    const { schema: next, warnings } = normalizeSchema({ fields });
    next.updated_at = new Date().toISOString();
    await onSave(next, warnings);
    dirty = false;
    d.close();
  }

  const d = openDialog({
    title: 'Kentät',
    wide: true,
    className: 'fields-dialog',
    body: h('div', { class: 'fe' },
      h('p', { class: 'hint' }, `Kentät näkyvät lomakkeella, levyn tiedoissa ja taulukossa. Määrittely tallentuu tiedostoon kentat.json (${locationText}), jota voi muokata myös tekstieditorilla – muutos tulee käyttöön ilman sovelluspäivitystä. Poistetun kentän arvot säilyvät CSV-tiedostossa ja palaavat näkyviin, jos lisäät samannimisen kentän uudelleen.`),
      h('div', { class: 'btn-row' },
        h('button', { type: 'button', class: 'btn btn-small', onclick: onExport }, icon('download', 16), 'Lataa kentat.json'),
        h('button', { type: 'button', class: 'btn btn-small', onclick: () => { d.close(); onImport(); } }, icon('upload', 16), 'Tuo kentat.json'),
        h('button', { type: 'button', class: 'btn btn-small btn-text', onclick: async () => { if (await onReset()) d.close(); } }, 'Palauta oletuskentät')),
      list, groupList, h('div', { class: 'fe-add' }, addBtn)),
    actions: [
      h('button', { type: 'button', class: 'btn', onclick: () => d.close() }, 'Peruuta'),
      h('button', { type: 'button', class: 'btn btn-primary', onclick: save }, icon('check'), 'Tallenna kentät'),
    ],
    onClose: () => { if (dirty) toast('Kenttiin tehtyjä muutoksia ei tallennettu'); },
  });
  return d;
}
