# Body textures

`bodies/` holds the surface maps `src/app/shared/rendering/texture-catalog.ts` wraps round the
bodies, keyed by their ids in `bodies.json`. Every map is simple cylindrical (equirectangular),
360 by 180 degrees, twice as wide as tall, with **longitude 0 in the middle and east to the right**,
which is the frame `MAP_TO_BODY` in `body-orientation.ts` puts onto the IAU body frame. The IAU
prime meridian (W) then turns longitude 0 to where it belongs at any date.

## Solar System Scope (CC BY 4.0)

`mercury`, `venus`, `earth`, `mars`, `saturn`, `uranus`, `neptune`, `moon`, `sun`, `saturn_ring`
and the skybox come from the Solar System Scope texture pack, and `jupiter` from its 8k pack, via
Wikimedia Commons. See each file's Commons page for the original credit line.

## Mission mosaics (public domain)

Each was downloaded from the URL below and processed the same way (script:
`build_maps.py`, kept with the measurements outside the repository):

1. Pixels the source leaves unmapped (value 0 in every band, its no-data value) are set to one
   flat grey: the mean of the mapped surface. They are never filled with invented terrain.
2. Downsampled by area averaging (PIL `BOX`) to 2 048 by 1 024 for bodies over 1 000 km in radius
   and 1 024 by 512 for the rest.
3. Rolled half a turn where the source is centred on longitude 180, so longitude 0 is in the
   middle. Every source already has east to the right. The centre was read from each file's
   GeoTIFF tags (central meridian plus the tie point of its left edge), not from its label: Rhea's
   and Enceladus's labels say `CENTER_LONGITUDE = 180` over an image centred on 0.
4. Saved as JPEG at quality 85 (Europa 82, to stay under 400 KB), greyscale where the source is.

Each was then checked by eye against the IAU Gazetteer: the named feature lies where its
coordinates put it on the processed map. "Black" is the share of pixels darker than 8 of 255 after
processing; the disc photographs dropped in PR #33 were 20-43% black sky.

| Map | Source | Mission, credit | Checked against | Unmapped (grey) | Black | Size |
| --- | --- | --- | --- | --- | --- | --- |
| `phobos.jpg` | [USGS](https://asc-pds-services.s3.us-west-2.amazonaws.com/mosaic/Phobos_Viking_Mosaic_40ppd_DLRcontrol.tif) Phobos Viking Mosaic 40ppd (DLR controlled) | Viking Orbiter, with Mars Express images; P. Stooke after Simonelli et al. 1993, PDS Stooke Small Bodies Maps | Stickney (1 N, 49 W) | 0.03% | 0.008% | 1024x512, 119 KB |
| `io.jpg` | [USGS](https://asc-pds-services.s3.us-west-2.amazonaws.com/mosaic/Io_GalileoSSI-Voyager_Global_Mosaic_ClrMerge_1km.tif) Io Galileo SSI-Voyager Global Mosaic, colour merge, 1 km | Galileo SSI and Voyager; USGS Astrogeology | Pele, Loki, Prometheus | 0.02% | 0% | 2048x1024, 283 KB |
| `europa.jpg` | [USGS](https://asc-pds-services.s3.us-west-2.amazonaws.com/mosaic/Europa_Voyager_GalileoSSI_global_mosaic_500m.tif) Europa Voyager-Galileo SSI Global Mosaic 500 m | Voyager and Galileo SSI; Archinal et al., USGS | Pwyll (25 S, 271 W) | 4.33% (polar gaps) | 0% | 2048x1024, 386 KB |
| `ganymede.jpg` | [USGS](https://asc-pds-services.s3.us-west-2.amazonaws.com/mosaic/Ganymede_Voyager_GalileoSSI_Global_ClrMosaic_1435m.tif) Ganymede Voyager-Galileo SSI Colour Global Mosaic 1.4 km | Voyager and Galileo SSI; USGS | Osiris, Tros, Galileo Regio | 3.63% (polar gaps) | 0% | 2048x1024, 363 KB |
| `callisto.jpg` | [USGS](https://asc-pds-services.s3.us-west-2.amazonaws.com/mosaic/Callisto_Voyager_GalileoSSI_global_mosaic_1km.tif) Callisto Voyager-Galileo SSI Global Mosaic 1 km | Voyager and Galileo SSI; USGS | Valhalla, Asgard | 3.90% (polar gaps) | 0% | 2048x1024, 344 KB |
| `mimas.jpg` | [PDS](https://planetarydata.jpl.nasa.gov/img/data/carto/coiss_3006/extras/full/images/SM_1M_0_0_SIMP.IMG.png) COISS_3006, Cassini ISS cartographic map of Mimas | Cassini ISS; DLR and FU Berlin (Roatsch et al.), NASA PDS | Herschel (1 N, 112 W) | 0.01% | 0.042% | 1024x512, 155 KB |
| `enceladus.jpg` | [USGS](https://asc-pds-services.s3.us-west-2.amazonaws.com/mosaic/Enceladus_Cassini_mosaic_global_110m.tif) Enceladus Cassini Global Mosaic 110 m | Cassini ISS; NASA/JPL/Space Science Institute | Ali Baba, Aladdin, Salih | 0.06% | 0.020% | 1024x512, 168 KB |
| `tethys.jpg` | [USGS](https://asc-pds-services.s3.us-west-2.amazonaws.com/mosaic/Tethys_Cassini_mosaic_global_293m.tif) Tethys Cassini Global Mosaic 293 m | Cassini ISS; NASA/JPL/Space Science Institute | Odysseus, Penelope | 0.04% | 0.009% | 1024x512, 182 KB |
| `dione.jpg` | [USGS](https://asc-pds-services.s3.us-west-2.amazonaws.com/mosaic/Dione_Cassini_Voyager_mosaic_global_154m.tif) Dione Cassini-Voyager Global Mosaic 154 m | Cassini ISS and Voyager; NASA/JPL/Space Science Institute | Creusa, Evander | 0.18% | 0.011% | 1024x512, 195 KB |
| `rhea.jpg` | [USGS](https://asc-pds-services.s3.us-west-2.amazonaws.com/mosaic/Rhea_Cassini_Voyager_mosaic_global_417m.tif) Rhea Cassini-Voyager Global Mosaic 417 m | Cassini ISS and Voyager; NASA/JPL/Space Science Institute | Inktomi, Tirawa | 0% | 0.003% | 1024x512, 128 KB |
| `titan.jpg` | [USGS](https://asc-pds-services.s3.us-west-2.amazonaws.com/mosaic/Titan_ISS_P19658_Mosaic_Global_4km.tif) Titan Cassini ISS Global Mosaic 4 km (938 nm, through the haze) | Cassini ISS; NASA/JPL-Caltech/SSI | Xanadu, Shangri-La, Belet | 0.02% | 0.078% | 2048x1024, 294 KB |
| `iapetus.jpg` | [USGS](https://asc-pds-services.s3.us-west-2.amazonaws.com/mosaic/Iapetus_Cassini_Voyager_mosaic_global_783m.tif) Iapetus Cassini-Voyager Global Mosaic 783 m | Cassini ISS and Voyager; NASA/JPL/Space Science Institute | Cassini Regio (leading side, 90 W), Engelier | 0% | 0.019% | 1024x512, 159 KB |
| `phoebe.jpg` | [PDS](https://planetarydata.jpl.nasa.gov/img/data/carto/coiss_3001/extras/full/images/SP_1M_0_0_SIMP.IMG.png) COISS_3001, Cassini ISS cartographic map of Phoebe | Cassini ISS; DLR and FU Berlin (Roatsch et al.), NASA PDS | Jason (16 N, 318 W) | 20.41% (the north) | 0.344% (shadows) | 1024x512, 78 KB |
| `triton.jpg` | [USGS](https://asc-pds-services.s3.us-west-2.amazonaws.com/mosaic/Triton_Voyager2_ClrMosaic_GlobalFill_600m.tif) Triton Voyager 2 Global Colour Mosaic 600 m (PIA18668) | Voyager 2; P. Schenk, NASA/JPL/LPI | Leviathan Patera; southern cap | 38.59% (the north Voyager 2 never saw) | 0% | 2048x1024, 205 KB |
| `ceres.jpg` | [USGS](https://asc-pds-services.s3.us-west-2.amazonaws.com/mosaic/Ceres_Dawn_FC_DLR_global_20ppd_Oct2015.tif) Ceres Dawn FC Global Mosaic, HAMO, Oct 2015 | Dawn Framing Camera; DLR, NASA/JPL | Occator (20 N, 239 E), Haulani (6 N, 11 E) | 3.60% (south pole) | 0.049% | 1024x512, 165 KB |
| `pluto.jpg` | [USGS](https://asc-pds-services.s3.us-west-2.amazonaws.com/mosaic/Pluto_NewHorizons_Global_Mosaic_300m_Jul2017_8bit.tif) Pluto New Horizons LORRI-MVIC Global Mosaic 300 m | New Horizons; NASA/JHUAPL/SwRI/LPI | Sputnik Planitia (175 E, across 180), Cthulhu, Burney | 31.92% (the south, in winter dark in 2015) | 0.501% (Cthulhu) | 2048x1024, 297 KB |
| `charon.jpg` | [USGS](https://asc-pds-services.s3.us-west-2.amazonaws.com/mosaic/Charon_NewHorizons_Global_Mosaic_300m_Jul2017_8bit.tif) Charon New Horizons LORRI-MVIC Global Mosaic 300 m | New Horizons; NASA/JHUAPL/SwRI/LPI | Mordor Macula (north pole), Organa | 34.02% (the south) | 0.549% (Mordor) | 1024x512, 72 KB |

Licence: every source above is NASA mission imagery, published by USGS Astrogeology or the NASA
PDS. The USGS metadata gives access constraints of "public domain" (Io, Triton, Enceladus,
Tethys, Dione, Rhea, Iapetus, Ganymede, Phobos) or "none" (the rest), with the use constraint
"please cite authors", which the credits column does. Io's colour is Galileo's violet, green and 756 nm
filters, which USGS says the eye would see "similar but much more muted"; Ganymede's is the
Galileo and Voyager colour mosaic; Triton's is orange, violet and ultraviolet shown as red, green
and blue (Smith et al. 1989). Phoebe is irregular (a 106.6 km sphere here), and its map keeps the
deep shadows of a single flyby. Phobos's source notes that where images lit
from opposite sides meet, the seam was blended for appearance, not geometry.

Longitudes follow each body's IAU prime meridian, which the checks above confirm on the maps. For
Pluto and Charon that is the right-hand-rule pole of the WGCCRE 2015 report, which New Horizons'
maps also use: the Charon-facing hemisphere is centred on longitude 0 and Sputnik Planitia sits on
the far side, near 180.

## Left out

- **Deimos.** `deimos.jpg` is a square disc photograph (32.6% black sky), not a map, and is not
  listed. The only cylindrical map found, `wms_basemaps/Deimos/deimoscyl4.jpg` (Stooke, Viking), has
  no label giving its longitude direction, and neither Voltaire nor Swift, the craters near its
  prime meridian, could be found on it to settle it.
- **Miranda, Ariel, Umbriel, Titania, Oberon.** Voyager 2 saw only their southern hemispheres,
  and no public-domain map of them exists at USGS or the PDS. The best maps (P. Schenk 2020, USRA
  repository, hdl.handle.net/20.500.11753/1687) carry no licence.
- **Hyperion, Nereid, Proteus, Eris, Haumea, Makemake.** No public-domain photographic map in
  simple cylindrical projection (Hyperion's USGS basemap is a relief rendering, not a mosaic).
