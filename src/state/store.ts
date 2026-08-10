/**
 * Application state and the undo/redo history.
 *
 * Invariants:
 *  1. `source.text` is the ORIGINAL text the user supplied. Nothing changes it
 *     except loading something new; every edit lives in `root`, the working copy.
 *  2. Every structural mutation (move / add / delete / re-parent) pushes the
 *     previous root onto `past`.
 *  3. Text-field mutations arrive with a `session` key, and a snapshot is taken
 *     once per editing session (on the first change) rather than per keystroke.
 *     Without this, one ⌘+Z would undo a single character.
 */

import type { ParseSuccess, RouteBlockRange } from '../core/parse';
import type { RouteNode } from '../core/types';

export type ViewMode = 'blocks' | 'graph' | 'batch';

export interface LoadedSource {
  /** The immutable original of what was supplied. */
  text: string;
  wholeFile: boolean;
  routeBlock: RouteBlockRange | null;
  /**
   * `api` means the config came from a running Alertmanager (`/api/v2/status`).
   * Its secrets read `<secret>`, so the whole-file export is forbidden for it.
   */
  origin: 'paste' | 'api';
  /** Where the config was fetched from — prefilled into the batch check. */
  originUrl?: string;
}

export interface LabelRow {
  id: string;
  name: string;
  value: string;
}

export type GraphLayoutMode = 'radial' | 'vertical';

export interface AppState {
  source: LoadedSource | null;
  root: RouteNode | null;
  /**
   * The tree's YAML right after loading — the baseline for "what changed".
   * Comparing against the source TEXT is useless: the diff would drown in
   * normalisation of key order and quoting.
   */
  baselineYaml: string;
  /**
   * The tree as of load time, for the "changed routes only" filter. The
   * comparison keys off node `id`s, so a copy of the tree is required, not YAML.
   */
  baselineRoot: RouteNode | null;
  /** Show only changed routes and their ancestors in the tree. */
  onlyChanged: boolean;
  /** Receiver names from the receivers: block — names only, never configs. */
  receiverNames: string[];
  warnings: string[];
  past: RouteNode[];
  future: RouteNode[];
  /** Key of the active text-editing session, e.g. "n17:receiver". */
  editSession: string | null;
  view: ViewMode;
  graphLayout: GraphLayoutMode;
  selectedId: string | null;
  search: string;
  labels: LabelRow[];
  /** The test panel has been run — show its result and the highlighting. */
  tested: boolean;
}

export type Action =
  | {
      type: 'load';
      parsed: ParseSuccess;
      sourceText: string;
      baselineYaml: string;
      origin?: 'paste' | 'api';
      originUrl?: string;
    }
  | { type: 'unload' }
  | { type: 'apply'; root: RouteNode; session?: string; select?: string }
  | { type: 'endSession' }
  | { type: 'undo' }
  | { type: 'redo' }
  | { type: 'select'; id: string | null }
  | { type: 'setView'; view: ViewMode }
  | { type: 'setGraphLayout'; layout: GraphLayoutMode }
  | { type: 'toggleOnlyChanged' }
  | { type: 'setSearch'; query: string }
  | { type: 'labelSet'; id: string; patch: Partial<Omit<LabelRow, 'id'>> }
  | { type: 'labelAdd'; name?: string }
  | { type: 'labelRemove'; id: string }
  | { type: 'labelsReset' }
  | { type: 'runTest' }
  | { type: 'clearTest' };

const HISTORY_LIMIT = 200;

let rowSeq = 0;
function newRow(name = '', value = ''): LabelRow {
  rowSeq += 1;
  return { id: `row${rowSeq}`, name, value };
}

/**
 * Suggested label names for the alert-test panel. Deliberately generic: these are
 * the labels almost every Alertmanager setup routes on. Labels actually used by
 * the loaded tree are collected separately (`labelNamesInTree`) and take priority.
 */
export const DEFAULT_LABEL_NAMES = [
  'alertname',
  'severity',
  'team',
  'service',
  'namespace',
  'cluster',
  'job',
  'instance',
];

export function initialState(): AppState {
  return {
    source: null,
    root: null,
    baselineYaml: '',
    baselineRoot: null,
    onlyChanged: false,
    receiverNames: [],
    warnings: [],
    past: [],
    future: [],
    editSession: null,
    view: 'blocks',
    graphLayout: 'radial',
    selectedId: null,
    search: '',
    labels: [newRow('alertname'), newRow('severity'), newRow('team')],
    tested: false,
  };
}

export function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'load': {
      return {
        ...initialState(),
        source: {
          text: action.sourceText,
          wholeFile: action.parsed.wholeFile,
          routeBlock: action.parsed.routeBlock,
          origin: action.origin ?? 'paste',
          ...(action.originUrl ? { originUrl: action.originUrl } : {}),
        },
        root: action.parsed.root,
        baselineYaml: action.baselineYaml,
        baselineRoot: structuredClone(action.parsed.root),
        receiverNames: action.parsed.receiverNames,
        warnings: action.parsed.warnings,
        view: state.view,
        graphLayout: state.graphLayout,
        selectedId: action.parsed.root.id,
      };
    }

    case 'unload':
      return {
        ...initialState(),
        view: state.view,
        graphLayout: state.graphLayout,
      };

    case 'apply': {
      if (!state.root) return state;
      const sameSession = action.session !== undefined && action.session === state.editSession;
      const base = {
        ...state,
        root: action.root,
        selectedId: action.select ?? state.selectedId,
      };
      if (sameSession) return base;
      return {
        ...base,
        past: [...state.past, state.root].slice(-HISTORY_LIMIT),
        future: [],
        editSession: action.session ?? null,
      };
    }

    case 'endSession':
      return state.editSession === null ? state : { ...state, editSession: null };

    case 'undo': {
      if (!state.root || state.past.length === 0) return state;
      const previous = state.past[state.past.length - 1];
      return {
        ...state,
        root: previous,
        past: state.past.slice(0, -1),
        future: [state.root, ...state.future].slice(0, HISTORY_LIMIT),
        editSession: null,
      };
    }

    case 'redo': {
      if (!state.root || state.future.length === 0) return state;
      const next = state.future[0];
      return {
        ...state,
        root: next,
        past: [...state.past, state.root].slice(-HISTORY_LIMIT),
        future: state.future.slice(1),
        editSession: null,
      };
    }

    case 'select':
      return { ...state, selectedId: action.id };

    case 'setView':
      return { ...state, view: action.view };

    case 'setGraphLayout':
      return { ...state, graphLayout: action.layout };

    case 'toggleOnlyChanged':
      return { ...state, onlyChanged: !state.onlyChanged };


    case 'setSearch':
      return { ...state, search: action.query };

    case 'labelSet':
      return {
        ...state,
        labels: state.labels.map((r) => (r.id === action.id ? { ...r, ...action.patch } : r)),
      };

    case 'labelAdd':
      return { ...state, labels: [...state.labels, newRow(action.name ?? '')] };

    case 'labelRemove': {
      const rest = state.labels.filter((r) => r.id !== action.id);
      return { ...state, labels: rest.length > 0 ? rest : [newRow()] };
    }

    case 'labelsReset':
      return { ...state, labels: [newRow()], tested: false };

    case 'runTest':
      return { ...state, tested: true };

    case 'clearTest':
      return { ...state, tested: false };

    default:
      return state;
  }
}

/** The alert's label set, built from the test panel's rows. */
export function labelsToObject(rows: LabelRow[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const r of rows) {
    const name = r.name.trim();
    if (name) out[name] = r.value;
  }
  return out;
}
