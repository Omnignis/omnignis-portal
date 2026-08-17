// Normalised, validated base URL for this deployment.
//
// PORTAL_URL was once set to "portal.omnignis.com" with no scheme. Because the
// OAuth redirect_uri is built by string concatenation, that produced
// "portal.omnignis.com/api/facebook/callback", which Facebook rejected with a
// generic "the domain of this URL isn't included in the app's domains" error
// that pointed at the wrong system entirely. Validate it once, here.
export function portalBaseUrl() {
  const raw = (process.env.PORTAL_URL || '').trim();
  if (!raw) return { url: null, problem: 'PORTAL_URL is not set.' };

  let parsed;
  try {
    parsed = new URL(raw);
  } catch (e) {
    return {
      url: null,
      problem: `PORTAL_URL ("${raw}") is not an absolute URL. It needs the scheme, e.g. https://portal.omnignis.com`,
    };
  }
  if (parsed.protocol !== 'https:' && parsed.hostname !== 'localhost') {
    return { url: null, problem: `PORTAL_URL must use https (got "${parsed.protocol}").` };
  }
  // Trailing slashes would produce a double slash in every derived path.
  return { url: raw.replace(/\/+$/, ''), problem: null };
}
