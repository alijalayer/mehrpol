// Trust page content: defaults from config/trust.json, overridden by what the admin saves in the panel.
import { getSetting } from './db.js';

const FILE_PATH = /^\/files\/[0-9a-f-]{36}$/;
const ORG_KEYS = ['name', 'registrationNo', 'address', 'phone', 'email'];
const CHARITY_KEYS = ['name', 'licenseNo', 'licenseIssuer'];
const CREATOR_KEYS = ['name', 'role', 'link', 'about'];

const text = (v, max = 300) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

/** Accepts http(s) links and files uploaded through the panel (/files/<id>); anything else becomes ''. */
export function safeUrl(v) {
  if (typeof v !== 'string') return '';
  if (FILE_PATH.test(v)) return v;
  try {
    return ['https:', 'http:'].includes(new URL(v).protocol) ? v : '';
  } catch {
    return '';
  }
}

const pick = (obj, keys) => Object.fromEntries(keys.map((k) => [k, text(obj?.[k], k === 'about' ? 500 : 300)]));

/** Normalizes trust content from any source into the stored/public shape. */
export function cleanTrust(t) {
  return {
    organization: pick(t.organization, ORG_KEYS),
    partnerCharity: pick(t.partnerCharity, CHARITY_KEYS),
    creator: { ...pick(t.creator, CREATOR_KEYS), link: safeUrl(t.creator?.link) },
    badges: (Array.isArray(t.badges) ? t.badges : []).slice(0, 12).map((b) => ({
      id: text(b.id, 40),
      title: text(b.title, 80),
      description: text(b.description),
      image: safeUrl(b.image),
      link: safeUrl(b.link),
    })),
    documents: (Array.isArray(t.documents) ? t.documents : []).slice(0, 20).map((d) => ({
      title: text(d.title, 120),
      number: text(d.number, 80),
      issuer: text(d.issuer, 120),
      link: safeUrl(d.link),
    })),
    sourceCodeUrl: safeUrl(t.sourceCodeUrl),
  };
}

/** Everything the admin can edit, with saved values taking precedence over the file defaults. */
export function currentTrust(ctx) {
  return cleanTrust({ ...ctx.trust, ...getSetting(ctx.db, 'trust', {}) });
}

/** What visitors see: empty placeholders are kept only in demo mode, to show where things go. */
export function publicTrust(ctx) {
  const t = currentTrust(ctx);
  const demo = ctx.config.demoMode;
  return {
    ...t,
    badges: t.badges.filter((b) => demo || b.image),
    documents: t.documents.filter((d) => demo || d.number || d.link),
  };
}
