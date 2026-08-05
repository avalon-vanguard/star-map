import { StarRecord } from '../../../src/app/shared/models/star.model';

/**
 * The catalogues this map can draw on, and what each of them can actually contribute.
 *
 * The distinction that matters is not size. It is whether a catalogue knows how *far away* its
 * objects are, because a 3D map cannot place a star it only has a direction for. That splits the
 * available surveys into three roles which are not interchangeable, and a survey being enormous
 * says nothing about which role it fills — DECaPS2 has fifty times Gaia's object count and
 * cannot place a single one of them in depth.
 */
export type StarSourceRole =
  /** Has a direction *and* a distance, usually from parallax. Can put a star in the scene. */
  | 'positional'
  /** Has stellar parameters keyed to an identifier. Adds knowledge about stars already placed. */
  | 'enrichment'
  /** Has directions but no usable distance. Can only be painted on the backdrop shell. */
  | 'backdrop';

export interface StarSource {
  readonly id: string;
  readonly name: string;
  readonly role: StarSourceRole;
  /** Where the data comes from, for the credits and for anyone re-running the pipeline. */
  readonly endpoint: string;
  /** What this source adds that the others do not. */
  readonly contributes: string;
  /**
   * Why it is not yet wired in, or `null` when it is. Kept as data rather than as a comment so
   * the ETL can print an honest summary of what actually ran.
   */
  readonly unimplementedBecause: string | null;
  /** Fetches this source's stars. Absent for sources that are declared but not implemented. */
  readonly fetch?: () => Promise<StarRecord[]>;
}

/**
 * Precision of the parallax each positional source measures with, in milliarcseconds — which is
 * what decides how far out its distances stay meaningful, and which of two catalogues to believe
 * when both contain the same star.
 */
export const PARALLAX_PRECISION_MAS: Readonly<Record<string, number>> = {
  hyg: 1,
  gaia: 0.02
};
