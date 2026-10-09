// Minimal, dependency-free readers for the two XBRL files we need from a filing:
// the instance document (facts + contexts) and the label linkbase (human names).

const attrs = (s) => {
  const out = {};
  for (const m of s.matchAll(/([\w:-]+)\s*=\s*"([^"]*)"/g)) out[m[1]] = m[2];
  return out;
};

const decode = (s) =>
  s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
    .replace(/&amp;/g, '&');

/**
 * Parse an XBRL instance document.
 * Returns { contexts: { id: { start, end, instant, dims: [{axis, member}], typed } },
 *           facts: [{ prefix, name, contextRef, value }], entityName }
 * Only numeric facts are kept.
 */
export function parseInstance(xml) {
  const contexts = {};
  const ctxRe = /<(?:[\w-]+:)?context\b([^>]*)>([\s\S]*?)<\/(?:[\w-]+:)?context>/g;
  for (const m of xml.matchAll(ctxRe)) {
    const { id } = attrs(m[1]);
    const body = m[2];
    const dims = [];
    for (const d of body.matchAll(/<(?:[\w-]+:)?explicitMember\b([^>]*)>\s*([^<\s]+)\s*</g)) {
      dims.push({ axis: attrs(d[1]).dimension, member: d[2] });
    }
    contexts[id] = {
      start: body.match(/startDate>\s*([^<\s]+)/)?.[1] ?? null,
      end: body.match(/endDate>\s*([^<\s]+)/)?.[1] ?? null,
      instant: body.match(/instant>\s*([^<\s]+)/)?.[1] ?? null,
      dims,
      typed: /typedMember/.test(body),
    };
  }

  const facts = [];
  const factRe = /<([\w-]+):(\w+)\b([^>]*\bcontextRef="[^"]+"[^>]*)>([^<]*)<\/\1:\2>/g;
  for (const m of xml.matchAll(factRe)) {
    const raw = m[4].trim();
    if (raw === '' || !/^-?\d+(\.\d+)?([eE][-+]?\d+)?$/.test(raw)) continue;
    facts.push({ prefix: m[1], name: m[2], contextRef: attrs(m[3]).contextRef, value: Number(raw) });
  }

  const entityName = xml.match(/<dei:EntityRegistrantName\b[^>]*>([^<]+)</)?.[1];
  return { contexts, facts, entityName: entityName ? decode(entityName.trim()) : null };
}

/**
 * Parse a label linkbase into a map of QName ("aapl:IPhoneMember") -> label.
 * Prefers terse labels ("iPhone") over standard ones ("iPhone [Member]").
 */
export function parseLabels(xml) {
  const locs = {}; // loc xlink:label -> qname
  for (const m of xml.matchAll(/<(?:[\w-]+:)?loc\b([^>]*)\/?>/g)) {
    const a = attrs(m[1]);
    const frag = a['xlink:href']?.split('#')[1];
    if (!frag) continue;
    const i = frag.indexOf('_');
    locs[a['xlink:label']] = i > 0 ? `${frag.slice(0, i)}:${frag.slice(i + 1)}` : frag;
  }

  const resources = {}; // resource xlink:label -> { role: text }
  for (const m of xml.matchAll(/<(?:[\w-]+:)?label\b([^>]*)>([\s\S]*?)<\/(?:[\w-]+:)?label>/g)) {
    const a = attrs(m[1]);
    const role = (a['xlink:role'] || '').split('/').pop();
    (resources[a['xlink:label']] ??= {})[role] = decode(m[2].trim());
  }

  const labels = {};
  const rank = { terseLabel: 2, label: 1 };
  const best = {};
  for (const m of xml.matchAll(/<(?:[\w-]+:)?labelArc\b([^>]*)\/?>/g)) {
    const a = attrs(m[1]);
    const qname = locs[a['xlink:from']];
    const res = resources[a['xlink:to']];
    if (!qname || !res) continue;
    for (const [role, text] of Object.entries(res)) {
      const r = rank[role] ?? 0;
      if (r && r > (best[qname] ?? 0)) {
        best[qname] = r;
        labels[qname] = cleanLabel(text);
      }
    }
  }
  return labels;
}

export function cleanLabel(s) {
  return s.replace(/\s*\[(Member|Domain|Axis)\]\s*$/i, '').trim();
}

const regionNames = new Intl.DisplayNames(['en'], { type: 'region' });

/** Fallback label when the filing doesn't provide one: "aapl:WearablesMember" -> "Wearables". */
export function humanize(qname) {
  const [prefix, local = prefix] = qname.split(':');
  if (prefix === 'country') {
    try {
      return regionNames.of(local) ?? local;
    } catch {
      return local;
    }
  }
  return local
    .replace(/(Segment)?Member$/, '')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .trim();
}
