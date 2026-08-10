/**
 * TSDB and Alertmanager addresses typed in by the user.
 *
 * Measured in a browser against live services:
 *   - page served over http (local dev server): `http://prom…` works — the browser
 *     follows the 301 to https and gets a 200;
 *   - page served over https (a deployed instance): the same address does NOT work
 *     and the request never leaves the browser: "Mixed Content … blocked". The
 *     redirect is irrelevant here, it is never reached.
 *
 * Hence two jobs: fill in the scheme when it was omitted, and never pretend an
 * http address might work from an https page — otherwise everything works locally
 * and silently breaks once deployed.
 */

import { dict } from '../i18n/dict';

/** Adds `https://` when no scheme was given. Empty input is left alone. */
export function normalizeEndpoint(input: string): string {
  const trimmed = input.trim().replace(/\/+$/, '');
  if (trimmed === '') return '';
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

/**
 * The request will be blocked by the browser as mixed content: the page came over
 * https and the address is http. Checked before sending, so no redirect can help.
 */
export function isMixedContentBlocked(url: string, pageProtocol: string): boolean {
  return pageProtocol === 'https:' && /^http:\/\//i.test(url.trim());
}

/** Same address upgraded to https, so a fix can be offered in one step. */
export function toHttps(url: string): string {
  return url.trim().replace(/^http:\/\//i, 'https://');
}

/**
 * Which addresses to try, and in which order.
 *
 *  - no scheme → assume https;
 *  - http from an https page → go straight to https: the http attempt is blocked
 *    anyway, so making it would only waste a round trip and produce a confusing
 *    error;
 *  - http from an http page → first exactly what was asked for, then https in case
 *    the service only speaks https.
 */
export function endpointCandidates(raw: string, pageProtocol: string): string[] {
  const url = normalizeEndpoint(raw);
  if (url === '') return [];
  if (!/^http:\/\//i.test(url)) return [url];
  if (pageProtocol === 'https:') return [toHttps(url)];
  const upgraded = toHttps(url);
  return upgraded === url ? [url] : [url, upgraded];
}

/**
 * What to tell the user after a successful request when the address actually used
 * differs from what they typed. `null` means it matched — nothing to report.
 */
export function endpointNote(raw: string, used: string): string | null {
  const typed = raw.trim().replace(/\/+$/, '');
  if (typed === '' || typed === used) return null;
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(typed)) return dict().endpoint.schemeAdded(used);
  return dict().endpoint.addressReplaced(used);
}
