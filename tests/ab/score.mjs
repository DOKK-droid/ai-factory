// Puntuacion automatica del A/B (aproximada: revisa tambien los textos crudos en out/).
export const FLAWS = {
  rate_limit: />=\s*5|off[- ]by[- ]one|un intento (de m[aá]s|extra|adicional)|a la 6|sexto intento|comparaci[oó]n (estricta|incorrecta)|`?>`? en lugar de|límite (exacto|inclusivo)/i,
  sql_injection: /sql[\s-]*inject|inyecci[oó]n( de)? sql|inyecci[oó]n|par[aá]metriz|prepared|concatenaci[oó]n/i,
  tautology_test: /tautol|compara (el valor )?consigo|mismo (valor|resultado|llamado)|siempre (es )?(verdader|pasa)|no valida|aserci[oó]n (vac[ií]a|trivial|in[uú]til)|test(s)? (d[eé]bil|debilitad)|se elimin[oó] (la )?(aserci[oó]n|validaci[oó]n)|par[aá]metros/i,
};

/** Devuelve APPROVE | CHANGES | ESCALATE | PASS | UNKNOWN segun la primera linea con contenido. */
export function parseVerdict(text) {
  const first = String(text).split('\n').map((l) => l.trim()).find((l) => l && !/^```/.test(l)) || '';
  const m = first.replace(/^[*#>\s-]*/, '').replace(/^VERDICT:\s*/i, '').match(/^(APPROVE|CHANGES|ESCALATE|PASS)/i);
  return m ? m[1].toUpperCase() : 'UNKNOWN';
}
export function detectedFlaws(text) {
  return Object.entries(FLAWS).filter(([, re]) => re.test(text)).map(([k]) => k);
}
/** Para la rama defectuosa lo correcto es NO aprobar; para la limpia, aprobar. */
export function isCorrect(caseName, verdict) {
  const approves = verdict === 'APPROVE' || verdict === 'PASS';
  return caseName === 'cand-clean' ? approves : (verdict === 'CHANGES' || verdict === 'ESCALATE');
}
export function summarize(rows) {
  const by = {};
  for (const r of rows) {
    const k = `${r.model} | ${r.mode}`;
    const o = (by[k] ??= { flawedRuns: 0, flawedOk: 0, flawsFound: 0, cleanRuns: 0, cleanOk: 0, unknown: 0 });
    if (r.verdict === 'UNKNOWN') o.unknown++;
    if (r.case === 'cand-flawed') { o.flawedRuns++; o.flawedOk += r.correct ? 1 : 0; o.flawsFound += r.flaws.length; }
    else { o.cleanRuns++; o.cleanOk += r.correct ? 1 : 0; }
  }
  return by;
}
