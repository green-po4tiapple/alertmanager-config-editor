/**
 * Pins the locale for the test run.
 *
 * `src/core/` builds its user-visible messages through the shared dictionary, so
 * without this the wording of an assertion would depend on whichever language
 * happened to be active. English is chosen because the assertions live in an
 * English-speaking repository; tests that care about the exact text compare against
 * `dict()` rather than a literal, so they survive rewording.
 */

import { setLang } from './i18n/dict';

setLang('en');
