import { StarRecord } from './star.model';

/**
 * On-disk format for the star catalogue, shared by the ETL that writes it and the app that
 * reads it so the two cannot drift apart.
 *
 * The catalogue outgrew a plain array of JSON objects. At the 50 pc cutoff it held 8750 stars
 * and cost 157 bytes each — most of that the same eight key names repeated once per star. At
 * the distance Hipparcos parallaxes actually reach, that same encoding would have been about
 * 17 MB of JSON to parse before the first frame.
 *
 * So the numbers move to a binary column store and the strings stay in JSON, where the two
 * repetitive ones — spectral types, of which 68000 stars share about 2600 distinct values —
 * collapse into a dictionary. The result is roughly a quarter of the size for eight times the
 * stars, and the numeric columns arrive as typed arrays with no parsing at all.
 */

/**
 * Positions stay in their own file rather than joining the columns below.
 *
 * They are the one column handed to the GPU verbatim: `StarFieldRenderer` binds the buffer
 * straight from `stars.bin` as an instanced attribute, so keeping it a bare `Float32Array` of
 * xyz triples means the star field costs one fetch and no repacking.
 */
export const STAR_POSITION_COMPONENTS = 3;
export const BYTES_PER_STAR_POSITION = STAR_POSITION_COMPONENTS * Float32Array.BYTES_PER_ELEMENT;

/**
 * Columns in `stars-meta.bin`, in order: catalogue id, apparent magnitude, colour index, an
 * index into the spectral-type dictionary, what those were measured in (see {@link PHOTOMETRY}),
 * and the distance's relative error (see {@link DISTANCE_ERROR_STEPS}). Stored column by column
 * rather than record by record so each one is a single typed-array view over the buffer, with no
 * per-record stride or alignment padding.
 */
export const BYTES_PER_STAR_META =
  Int32Array.BYTES_PER_ELEMENT +
  Float32Array.BYTES_PER_ELEMENT +
  Float32Array.BYTES_PER_ELEMENT +
  Uint16Array.BYTES_PER_ELEMENT +
  Uint16Array.BYTES_PER_ELEMENT +
  Uint8Array.BYTES_PER_ELEMENT;

/**
 * Bits of the photometry column. The band takes two: none (a stand-in magnitude), V or G. None
 * of it follows from the source, which records where the *position* came from: 62 002 stars
 * Gaia places keep HYG's V and B−V, and the archive's stars in G have a B−V from their
 * temperature. The next bit says whose parallax the distance is, which for a HYG star Gaia did
 * not place can still be Gaia's, and the last whether the colour was read off a temperature.
 */
const PHOTOMETRY = { bandV: 1, bandG: 2, bandMask: 3, colorBpRp: 4, distanceFromGaia: 8, colorFromTemperature: 16 } as const;

/**
 * The distance error column holds the square root of the relative error, in 65 535ths, and 0 where
 * none was published. The errors span three orders of magnitude — Gaia's are a median 0.3 % and
 * at most 20 %, the cut its queries make, while a Hipparcos parallax the map keeps for a bright
 * star can be as large as itself — and the square root keeps a step small at each end. Anything
 * past 100 % is stored as that, where it no longer bounds the distance from above.
 *
 * In 255ths, one byte, a step was 0.35 % of the distance at a 20 % error, a few per cent of the
 * error itself, and the card printed another error than the published one for 2 822 of the 53 209
 * Gaia stars it prints one for; Rigel read ± 23 pc where van Leeuwen's 3.78 ± 0.34 mas gives 24.
 * In two bytes, placed before the photometry byte so the column stays aligned for its view, 12 do,
 * each on a rounding half.
 */
const DISTANCE_ERROR_STEPS = 65_535;

/** `stars-index.json`: everything that is a string, plus the count the columns are sized by. */
export interface StarCatalogIndex {
  count: number;
  /**
   * One per star, in catalogue order — but empty where the name is simply the star's catalogue
   * designation, which is regenerated on load from the source and the id.
   *
   * A survey-scale catalogue has no proper names to speak of. Gaia's designations are its
   * 19-digit source ids, so writing "Gaia DR3 4472832130942575872" once per star would cost
   * 25 MB per million stars — more than the whole rest of the catalogue — to store a string that
   * is already implied by two fields next to it. An empty entry costs three bytes.
   *
   * Dense with holes rather than a list of pairs, because which one is smaller depends entirely
   * on the catalogue: every HYG star has a designation worth keeping, and paying an index per
   * entry to say so would be 60% larger than just writing them in order.
   */
  names: string[];
  /** Distinct spectral classifications; the meta column holds indices into this. */
  spectralTypes: string[];
  /**
   * Distinct source ids, in the same dictionary form as the spectral types, plus the designation
   * prefix each one names its unnamed stars with.
   */
  sources: { id: string; designationPrefix: string }[];
  /**
   * One per star: an index into `sources`. Empty when every star came from the same place, which
   * would otherwise cost a couple of hundred kilobytes to say nothing.
   */
  sourceIndices: number[];
}

/**
 * How a source names a star that has no name of its own. `Gaia DR3 <id>` for Gaia; `HYG <id>`
 * for HYG, whose ETL reaches for that only after a proper name, Bayer, Flamsteed, HD, Gliese and
 * HIP have all come up empty (`tools/etl/fetchStars.ts`) — none in the current catalogue, but
 * the path is there, and a name made that way is no more a name than Gaia's.
 */
const DESIGNATION_PREFIXES: Readonly<Record<string, string>> = {
  gaia: 'Gaia DR3',
  hyg: 'HYG'
};

interface StarMetaColumns {
  ids: Int32Array;
  magnitudes: Float32Array;
  colorIndices: Float32Array;
  spectralTypeIndices: Uint16Array;
  photometry: Uint8Array;
  distanceErrors: Uint16Array;
}

/** Lays typed-array views over the meta buffer at the offsets the format defines. */
function metaColumns(buffer: ArrayBuffer, count: number): StarMetaColumns {
  let offset = 0;
  const ids = new Int32Array(buffer, offset, count);
  offset += count * Int32Array.BYTES_PER_ELEMENT;
  const magnitudes = new Float32Array(buffer, offset, count);
  offset += count * Float32Array.BYTES_PER_ELEMENT;
  const colorIndices = new Float32Array(buffer, offset, count);
  offset += count * Float32Array.BYTES_PER_ELEMENT;
  const spectralTypeIndices = new Uint16Array(buffer, offset, count);
  offset += count * Uint16Array.BYTES_PER_ELEMENT;
  const distanceErrors = new Uint16Array(buffer, offset, count);
  offset += count * Uint16Array.BYTES_PER_ELEMENT;
  const photometry = new Uint8Array(buffer, offset, count);

  return { ids, magnitudes, colorIndices, spectralTypeIndices, photometry, distanceErrors };
}

/**
 * Packs the string and numeric halves of a star list into the two files the app loads.
 *
 * `colorIndex` is genuinely nullable — about a tenth of the catalogue was never photometered —
 * and `NaN` carries that through the float column. It is the one value a float can hold that
 * means "no measurement" without colliding with a real one, and 0 emphatically does not: it is
 * a real colour index meaning a hot blue-white A-type star.
 */
export function encodeStarCatalog(stars: readonly StarRecord[]): {
  index: StarCatalogIndex;
  positions: Float32Array;
  meta: ArrayBuffer;
} {
  const count = stars.length;
  const positions = new Float32Array(count * STAR_POSITION_COMPONENTS);
  const meta = new ArrayBuffer(count * BYTES_PER_STAR_META);
  const columns = metaColumns(meta, count);

  const spectralTypes: string[] = [];
  const spectralTypeIds = new Map<string, number>();
  const names: string[] = [];
  const sources: { id: string; designationPrefix: string }[] = [];
  const sourceIds = new Map<string, number>();
  const sourceIndices: number[] = [];

  stars.forEach((star, index) => {
    positions[index * 3] = star.x;
    positions[index * 3 + 1] = star.y;
    positions[index * 3 + 2] = star.z;

    let sourceIndex = -1;
    if (star.source !== undefined) {
      const known = sourceIds.get(star.source);
      if (known === undefined) {
        sourceIndex = sources.push({ id: star.source, designationPrefix: DESIGNATION_PREFIXES[star.source] ?? star.source }) - 1;
        sourceIds.set(star.source, sourceIndex);
      } else {
        sourceIndex = known;
      }
    }
    sourceIndices.push(sourceIndex);

    // Left empty when it is simply the designation the source would generate anyway.
    names.push(star.name === designationFor(sources[sourceIndex]?.designationPrefix, star.id) ? '' : star.name);

    let spectralTypeId = spectralTypeIds.get(star.spectralType);
    if (spectralTypeId === undefined) {
      spectralTypeId = spectralTypes.push(star.spectralType) - 1;
      spectralTypeIds.set(star.spectralType, spectralTypeId);
    }

    columns.ids[index] = star.id;
    columns.magnitudes[index] = star.magnitude;
    columns.colorIndices[index] = star.colorIndex ?? Number.NaN;
    columns.spectralTypeIndices[index] = spectralTypeId;
    columns.photometry[index] =
      (star.magnitudeBand === 'V' ? PHOTOMETRY.bandV : star.magnitudeBand === 'G' ? PHOTOMETRY.bandG : 0) |
      (star.colorSystem === 'BP-RP' ? PHOTOMETRY.colorBpRp : 0) |
      (star.distanceFromGaia ? PHOTOMETRY.distanceFromGaia : 0) |
      (star.colorFromTemperature ? PHOTOMETRY.colorFromTemperature : 0);
    // At least one step, so an error too small to round to one is not read back as none published.
    columns.distanceErrors[index] =
      star.distanceError === undefined ? 0 : Math.max(1, Math.round(Math.sqrt(Math.min(1, star.distanceError)) * DISTANCE_ERROR_STEPS));
  });

  // A per-star column is only worth writing when the stars actually differ.
  const mixedSources = sources.length > 1;
  return { index: { count, names, spectralTypes, sources, sourceIndices: mixedSources ? sourceIndices : [] }, positions, meta };
}

/** The name a source gives a star it has no other name for. */
function designationFor(prefix: string | undefined, id: number): string | undefined {
  return prefix === undefined ? undefined : `${prefix} ${id}`;
}

/**
 * Whether a star's name is only the designation its source generates, rather than anything
 * somebody called it. Judged by the prefix alone: the number after it is the survey's own id —
 * nineteen digits for Gaia — which the 32-bit row id `designationFor` prints cannot hold, so a
 * round-trip through the id would call every one of those stars named.
 */
export function isDesignation(star: StarRecord): boolean {
  // No source at all is a single-catalogue build, whose fallback is HYG's — see `decodeStarCatalog`.
  const prefix = star.source === undefined ? DESIGNATION_PREFIXES['hyg'] : (DESIGNATION_PREFIXES[star.source] ?? star.source);
  return star.name.startsWith(`${prefix} `);
}

/** Rebuilds the star records the app works with from the three loaded assets. */
export function decodeStarCatalog(index: StarCatalogIndex, positions: Float32Array, meta: ArrayBuffer): StarRecord[] {
  const columns = metaColumns(meta, index.count);
  const stars: StarRecord[] = new Array(index.count);

  for (let i = 0; i < index.count; i++) {
    const colorIndex = columns.colorIndices[i];
    const id = columns.ids[i];
    const sourceIndex = index.sourceIndices.length > 0 ? index.sourceIndices[i] : index.sources.length === 1 ? 0 : -1;
    const source = index.sources[sourceIndex];
    const photometry = columns.photometry[i];
    const band = photometry & PHOTOMETRY.bandMask;
    const distanceError = columns.distanceErrors[i];

    stars[i] = {
      id,
      name: index.names[i] || designationFor(source?.designationPrefix, id) || `HYG ${id}`,
      x: positions[i * 3],
      y: positions[i * 3 + 1],
      z: positions[i * 3 + 2],
      magnitude: columns.magnitudes[i],
      spectralType: index.spectralTypes[columns.spectralTypeIndices[i]],
      colorIndex: Number.isNaN(colorIndex) ? null : colorIndex,
      // Set on every record, if only to undefined, so that all of them have the one shape.
      magnitudeBand: band === PHOTOMETRY.bandV ? 'V' : band === PHOTOMETRY.bandG ? 'G' : undefined,
      colorSystem: Number.isNaN(colorIndex) ? undefined : photometry & PHOTOMETRY.colorBpRp ? 'BP-RP' : 'B-V',
      distanceError: distanceError === 0 ? undefined : (distanceError / DISTANCE_ERROR_STEPS) ** 2,
      distanceFromGaia: (photometry & PHOTOMETRY.distanceFromGaia) !== 0,
      colorFromTemperature: (photometry & PHOTOMETRY.colorFromTemperature) !== 0,
      ...(source ? { source: source.id } : {})
    };
  }

  return stars;
}
