import axios from 'axios';
import { ConveyorConfiguration } from '../types/conveyor';
import { ConfigurationService } from './configurationService';

/**
 * How the client's exact CAD parts (804-125.stp) are arranged for a configuration.
 * Computed by the backend (the same layout is applied to the exported STEP), expressed in
 * reference-world millimetres: parts are moved, bars are lengthened by shifting every point beyond a cut
 * plane, and stands / guide posts are repeated.
 */
export interface CadCut {
  n: [number, number, number]; // plane normal (world)
  c: number;                   // points with n·p > c are shifted ...
  d: [number, number, number]; // ... by d
}

export interface CadLayout {
  params: { bends: string[]; straights: number[]; height: number; guideHeight?: number; guides?: boolean; supports?: boolean; driveAtStart?: boolean };
  /** reference world -> new world, 4x4 row-major (mm) */
  moves: { path: string[]; matrix: number[] }[];
  stretches: { path: string[]; cuts: CadCut[] }[];
  clones: { source: string; name: string; matrix: number[]; cuts?: CadCut[]; prism?: number }[];
  /** reference parts this layout does not use */
  hidden: string[][];
  legs: number;
  /** largest distance between neighbouring stands (mm) */
  maxSpan: number;
}

export interface CadLayoutResult {
  /** JSON of the configuration this result belongs to. */
  key: string;
  /** true when the client's real parts can express the configuration. */
  exact: boolean;
  /** options the client's CAD has no part for (the client's part is shown for them) or values that were limited. */
  reasons: string[];
  layout: CadLayout | null;
}

const API_BASE = import.meta.env.VITE_API_URL ?? (import.meta.env.DEV ? 'http://localhost:8000' : '');

/** The reference conveyor itself needs no edits (so it also works without the backend). */
export const REFERENCE_LAYOUT: CadLayout = {
  params: { bends: ['L'], straights: [400, 500], height: 1100 },
  moves: [],
  stretches: [],
  clones: [],
  hidden: [],
  legs: 2,
  maxSpan: 750
};

export function cadLayoutKey(config: ConveyorConfiguration): string {
  const { presetId, isClientReferencePreset, ...rest } = config;
  return JSON.stringify(rest);
}

export async function fetchCadLayout(config: ConveyorConfiguration): Promise<CadLayoutResult> {
  const key = cadLayoutKey(config);
  if (ConfigurationService.isReferencePreset(config)) {
    return { key, exact: true, reasons: [], layout: REFERENCE_LAYOUT };
  }
  try {
    const res = await axios.post(`${API_BASE}/api/v1/conveyor/layout`, config, { timeout: 15000 });
    return { key, exact: !!res.data.exact, reasons: res.data.reasons ?? [], layout: res.data.layout ?? null };
  } catch (err) {
    return {
      key,
      exact: false,
      reasons: ['CAD layout service unavailable (backend not reachable)'],
      layout: null
    };
  }
}
