// Kolmisuuntainen yhdistäminen laitteen ja pilven välillä.
// base = edellisen onnistuneen synkronoinnin tila { id: updated_at }.
// Säännöt:
//  - Molemmissa → uudempi updated_at voittaa.
//  - Vain paikallisesti: jos oli synkronoitu eikä muuttunut sen jälkeen → poistettu
//    toisella laitteella → poistetaan. Muuten (uusi tai muokattu) säilytetään.
//  - Vain pilvessä: vastaavasti peilikuvana.

function sameContent(a, b) {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) if ((a[k] ?? '') !== (b[k] ?? '')) return false;
  return true;
}

export function threeWayMerge(localList, remoteList, base = {}, now = () => new Date().toISOString()) {
  const local = new Map(localList.map((r) => [r.id, r]));
  const remote = new Map(remoteList.map((r) => [r.id, r]));
  const ids = new Set([...local.keys(), ...remote.keys()]);

  const merged = [];
  const localUpserts = [];
  const localDeletes = [];
  let remoteChanged = false;

  for (const id of ids) {
    const L = local.get(id);
    const R = remote.get(id);
    const B = base[id];

    if (L && R) {
      if (R.updated_at === L.updated_at && !sameContent(L, R)) {
        // Sama aikaleima mutta eri sisältö → CSV:tä on muokattu käsin (esim. Excelissä).
        // Sovellus päivittää aina aikaleiman, joten käsin tehty muutos voittaa.
        const edited = { ...R, updated_at: now() };
        merged.push(edited); localUpserts.push(edited); remoteChanged = true;
      } else if (R.updated_at > L.updated_at) {
        merged.push(R); localUpserts.push(R);
      } else {
        merged.push(L);
        if (L.updated_at > R.updated_at) remoteChanged = true;
      }
    } else if (L) {
      if (B && L.updated_at <= B) {
        localDeletes.push(id);
      } else {
        merged.push(L); remoteChanged = true;
      }
    } else if (R) {
      if (B && R.updated_at <= B) {
        remoteChanged = true; // poistettu tällä laitteella
      } else {
        merged.push(R); localUpserts.push(R);
      }
    }
  }

  const newBase = Object.fromEntries(merged.map((r) => [r.id, r.updated_at]));
  return { merged, localUpserts, localDeletes, remoteChanged, newBase };
}
