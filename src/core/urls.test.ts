import { describe, expect, it } from 'vitest';
import { dict } from '../i18n/dict';
import { endpointCandidates, endpointNote, isMixedContentBlocked, normalizeEndpoint, toHttps } from './urls';

describe('normalizeEndpoint', () => {
  it('fills in https when no scheme was given', () => {
    expect(normalizeEndpoint('prometheus.example')).toBe('https://prometheus.example');
    expect(normalizeEndpoint('prometheus.example:9090')).toBe('https://prometheus.example:9090');
  });

  it('leaves an explicit scheme alone and strips trailing slashes', () => {
    expect(normalizeEndpoint('http://prom.example/')).toBe('http://prom.example');
    expect(normalizeEndpoint('https://prom.example//')).toBe('https://prom.example');
    expect(normalizeEndpoint('  https://prom.example  ')).toBe('https://prom.example');
  });

  it('empty input stays empty', () => {
    expect(normalizeEndpoint('   ')).toBe('');
  });
});

describe('mixed content', () => {
  it('an http address from an https page is blocked by the browser', () => {
    // Measured in a browser: from an https page the request never leaves at all.
    expect(isMixedContentBlocked('http://prom.example', 'https:')).toBe(true);
    // From an http page the same address works: 301 → 200.
    expect(isMixedContentBlocked('http://prom.example', 'http:')).toBe(false);
    expect(isMixedContentBlocked('https://prom.example', 'https:')).toBe(false);
  });

  it('upgrading the scheme', () => {
    expect(toHttps('http://prom.example/api')).toBe('https://prom.example/api');
    expect(toHttps('https://prom.example')).toBe('https://prom.example');
  });
});

describe('endpointCandidates', () => {
  it('no scheme means straight to https', () => {
    expect(endpointCandidates('prom.example', 'http:')).toEqual(['https://prom.example']);
  });

  it('http from an http page: first as asked, then https', () => {
    expect(endpointCandidates('http://prom.example', 'http:')).toEqual([
      'http://prom.example',
      'https://prom.example',
    ]);
  });

  it('http from an https page: http is not tried at all — it is blocked', () => {
    expect(endpointCandidates('http://prom.example', 'https:')).toEqual(['https://prom.example']);
  });

  it('https is not duplicated, and empty input gives an empty list', () => {
    expect(endpointCandidates('https://prom.example', 'https:')).toEqual(['https://prom.example']);
    expect(endpointCandidates('  ', 'https:')).toEqual([]);
  });
});

describe('endpointNote', () => {
  it('reports when the address actually used differs from what was typed', () => {
    expect(endpointNote('prom.example', 'https://prom.example')).toBe(
      dict().endpoint.schemeAdded('https://prom.example'),
    );
    expect(endpointNote('http://prom.example', 'https://prom.example')).toBe(
      dict().endpoint.addressReplaced('https://prom.example'),
    );
  });

  it('stays silent when the address matched', () => {
    expect(endpointNote('https://prom.example', 'https://prom.example')).toBeNull();
    expect(endpointNote('https://prom.example/', 'https://prom.example')).toBeNull();
    expect(endpointNote('', 'https://prom.example')).toBeNull();
  });
});
