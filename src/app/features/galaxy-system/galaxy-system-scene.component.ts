import { AfterViewInit, Component, effect, ElementRef, OnDestroy, signal, viewChild } from '@angular/core';
import { Router } from '@angular/router';
import * as THREE from 'three/webgpu';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

import { dateToJulianDate } from '../../shared/astro/constants';
import { galacticCentrePositionPc, galacticToEquatorial, MILKY_WAY_ARMS, SUN_GALACTOCENTRIC_RADIUS_PC } from '../../shared/astro/galaxy';
import { DataLoaderService } from '../../core/data/data-loader.service';
import { EngineService } from '../../core/engine/engine.service';
import { BodyRecord } from '../../shared/models/body.model';
import { DeepSkyRecord } from '../../shared/models/deepsky.model';
import { ExoplanetRecord } from '../../shared/models/exoplanet.model';
import { applyMilkyWaySkybox, createGlowSprite } from '../../shared/rendering/skybox';
import { loadCachedTexture, MILKY_WAY_SKYBOX_PATH, SUN_TEXTURE_PATH } from '../../shared/rendering/texture-catalog';
import { StarRecord } from '../../shared/models/star.model';
import { NavigationStore, ViewLevel } from '../../shared/state/navigation.store';
import { CameraRigController } from './camera-rig-controller';
import { DeepSkyRenderer } from './deep-sky-renderer';
import { galacticNormal, PolarGridPlane, TetherField } from './grid-plane';
import { MilkyWayRenderer } from './milky-way-renderer';
import { starMarkerRadiusAu, systemFramingDistanceAu, systemViewDirection } from './system-framing';
import { HudReadout, StarmapHudComponent } from './starmap-hud.component';
import { colorIndexToRgb, StarFieldRenderer } from './star-field-renderer';
import { LabeledPoint, StarLabelOverlay } from './star-label-overlay';
import { SystemOrbitsRenderer } from './system-orbits-renderer';

/** HYG catalog id for the Sun itself — the only star we have a real close-up photo of. */
const SOL_STAR_ID = 0;
const SUN_GLOW_SCALE = 3.2;

/** Stars closer than this to the camera get a name label (always includes the selection). */
const LABEL_MAX_DISTANCE_PC = 20;
/** Caps how many labels are shown at once, to keep the DOM light. */
const LABEL_MAX_COUNT = 15;
/**
 * Minimum on-screen separation between two labels, in NDC (roughly 6% of the viewport height).
 * Nearer stars win the space; see `spreadLabels`.
 */
const LABEL_MIN_SEPARATION_NDC = 0.12;
/**
 * How many deep-sky objects get a permanent label. These sit on a fixed backdrop shell rather
 * than near the camera, so proximity is meaningless for them — the brightest handful are simply
 * always named.
 */
const DEEP_SKY_LABEL_COUNT = 12;
/** How often (seconds) the visible label set is recomputed; doesn't need to be per-frame. */
const LABEL_UPDATE_INTERVAL_SECONDS = 0.2;
/** Pointer travel (px) above which a press counts as an orbit drag rather than a selection. */
const CLICK_DRAG_SLOP_PX = 5;

/**
 * Opening pose for the local view, expressed in the galactic frame rather than the equatorial
 * one: about 35 degrees above the galactic plane, looking down at the Sun. Picked so the grid
 * reads as a floor under the star field instead of slicing across it edge-on, which is what an
 * arbitrary equatorial direction gives — the plane is tilted 63 degrees to the equator.
 */
const GALAXY_OVERVIEW_POSITION = (() => {
  const view = galacticToEquatorial({ x: -21, y: -46, z: 35 });
  return new THREE.Vector3(view.x, view.y, view.z);
})();
const GALAXY_OVERVIEW_TARGET = new THREE.Vector3(0, 0, 0);
const GALAXY_NEAR_PC = 0.01;
const GALAXY_FAR_PC = 5000;
const GALAXY_MIN_DISTANCE_PC = 0.5;
/** Far enough out to hold the whole Galaxy in frame; the near/far planes swap to match. */
const GALAXY_MAX_DISTANCE_PC = 70000;
/** How close (pc) the camera dives toward a selected star before the unit-space swap. */
const GALAXY_APPROACH_DISTANCE_PC = 0.05;

/**
 * Depth range for the galactic scale. The local view needs a 1-centimetre-of-a-parsec near
 * plane to fly into a star; the galactic view needs a far plane a hundred thousand parsecs out.
 * Asking one projection to span both would leave the depth buffer with nothing left to
 * distinguish two arms with. They swap at the crossfade instead, which happens while the camera
 * is hundreds of parsecs from anything and so is invisible.
 */
const GALACTIC_NEAR_PC = 5;
const GALACTIC_FAR_PC = 250000;

/** Rings for the local grid (parsecs from the Sun), with the catalogue's edge called out. */
const LOCAL_GRID_RINGS_PC = [10, 20, 30, 40, 50];
const LOCAL_GRID_SPOKES = 12;
/** Rings for the galactic grid (parsecs from the centre), with the Sun's orbit called out. */
const GALACTIC_GRID_RINGS_PC = [2500, 5000, SUN_GALACTOCENTRIC_RADIUS_PC, 11000, 14000];
const GALACTIC_GRID_SPOKES = 24;
/** The local grid passes through the Sun, which is the origin, so tethers drop to height zero. */
const LOCAL_PLANE_HEIGHT_PC = 0;
/** How many of the Sun's nearest neighbours get a permanent drop line to the local grid. */
const TETHERED_STAR_COUNT = 28;

/** Camera pose for the whole-Galaxy overview: above the disc, out past the Sun, looking in. */
const GALACTIC_OVERVIEW_HEIGHT_PC = 26000;
const GALACTIC_OVERVIEW_BACK_PC = 11000;

/** Above this share of the Galaxy-model crossfade, the HUD calls the view galactic. */
const GALACTIC_LEVEL_THRESHOLD = 0.5;

const SYSTEM_NEAR_AU = 0.002;
const SYSTEM_FAR_AU = 20000;
const SYSTEM_MIN_DISTANCE_AU = 0.05;
const SYSTEM_MAX_DISTANCE_AU = 5000;
/** Where the camera lands (AU) immediately after swapping into system space, pre-settle. */
const SYSTEM_ENTRY_DISTANCE_AU = 200;
/** How far out (AU) the camera flies before swapping back to galaxy/parsec space. */
const SYSTEM_EXIT_DISTANCE_AU = 400;

const APPROACH_DURATION_SECONDS = 1.0;
const SETTLE_DURATION_SECONDS = 0.9;
const EXIT_DURATION_SECONDS = 0.9;
const RETURN_DURATION_SECONDS = 1.1;
const GALACTIC_FLIGHT_SECONDS = 2.4;

/** Camera range for the readout panel, in the unit that suits the distance. */
function formatParsecs(distancePc: number): string {
  return distancePc >= 1000 ? `${(distancePc / 1000).toFixed(1)} kpc` : `${distancePc.toFixed(distancePc < 10 ? 2 : 0)} pc`;
}

function formatAu(distanceAu: number): string {
  return distanceAu >= 100 ? `${distanceAu.toFixed(0)} AU` : `${distanceAu.toFixed(2)} AU`;
}

/**
 * Where the camera sits to hold the whole Galaxy: above the disc and back past the Sun, looking
 * at the centre — near enough to the angle the Galaxy is usually drawn from, and it keeps the
 * Sun between the camera and the centre so "you are here" stays legible.
 */
function galacticOverviewPose(): { position: THREE.Vector3; target: THREE.Vector3 } {
  const centre = galacticCentrePositionPc();
  const target = new THREE.Vector3(centre.x, centre.y, centre.z);
  const awayFromCentre = target.clone().negate().normalize();
  const position = target.clone().add(galacticNormal().multiplyScalar(GALACTIC_OVERVIEW_HEIGHT_PC)).add(awayFromCentre.multiplyScalar(GALACTIC_OVERVIEW_BACK_PC));
  return { position, target };
}

/**
 * Hosts the shared galaxy + system scene: pan/zoom/rotate camera controls, click-to-select
 * picking, proximity-based name labels, and — once a star is selected — a camera-flight
 * transition into that star's system (real solar-system bodies for the Sun, cross-referenced
 * exoplanets for other stars) with orbit ellipses and planet/moon markers. Owns its own
 * `EngineService` instance.
 */
@Component({
  selector: 'app-galaxy-system-scene',
  providers: [EngineService],
  imports: [StarmapHudComponent],
  template: `
    <div class="relative h-full w-full">
      <canvas #canvas data-testid="scene-canvas" class="block h-full w-full"></canvas>
      <div #labelHost class="absolute inset-0 overflow-hidden pointer-events-none"></div>
      <app-starmap-hud
        [level]="navigationStore.viewLevel()"
        [eyebrow]="hudEyebrow()"
        [title]="hudTitle()"
        [subtitle]="hudSubtitle()"
        [readouts]="hudReadouts()"
        [note]="hudNote()"
        [range]="hudRange()"
        (levelSelected)="goToLevel($event)"
      />
    </div>
  `
})
export class GalaxySystemSceneComponent implements AfterViewInit, OnDestroy {
  private readonly canvasRef = viewChild.required<ElementRef<HTMLCanvasElement>>('canvas');
  private readonly labelHostRef = viewChild.required<ElementRef<HTMLDivElement>>('labelHost');

  private readonly raycaster = new THREE.Raycaster();
  private readonly galaxyGroup = new THREE.Group();
  private readonly systemGroup = new THREE.Group();
  private readonly starMarkerMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff });
  /** Rebuilt per system, since the star's radius is derived from that system's innermost orbit. */
  private starMarkerGeometry?: THREE.SphereGeometry;

  /** Readout panel contents, refreshed on the same cadence as the labels rather than per frame. */
  readonly hudEyebrow = signal('');
  readonly hudTitle = signal('');
  readonly hudSubtitle = signal('');
  readonly hudReadouts = signal<readonly HudReadout[]>([]);
  readonly hudNote = signal('');
  readonly hudRange = signal('');

  private controls?: OrbitControls;
  private rig?: CameraRigController;
  private starField?: StarFieldRenderer;
  private deepSky?: DeepSkyRenderer;
  private deepSkyLabels: readonly LabeledPoint[] = [];
  private milkyWay?: MilkyWayRenderer;
  private galacticLabels: readonly LabeledPoint[] = [];
  private galacticGrid?: PolarGridPlane;
  private localGrid?: PolarGridPlane;
  private tethers?: TetherField;
  /** Strength of the Galaxy-model crossfade, 0 (local view) to 1 (galactic view). */
  private galacticStrength = 0;
  private labelOverlay?: StarLabelOverlay;
  private stars: readonly StarRecord[] = [];
  private starsById = new Map<number, StarRecord>();
  private bodies: readonly BodyRecord[] = [];
  private exoplanets: readonly ExoplanetRecord[] = [];
  private resizeObserver?: ResizeObserver;
  private unsubscribeTick?: () => void;
  private labelUpdateAccumulator = 0;
  private pointerDownAt: { x: number; y: number } | null = null;
  private ready = false;
  private busy = false;
  /** Scale the HUD asked for while a system transition was still unwinding. */
  private pendingLevel: ViewLevel | null = null;

  /** Id of the star whose system is currently shown (or being flown to/from); null = galaxy view. */
  private currentStarId: number | null = null;
  private systemRenderer?: SystemOrbitsRenderer;
  private starMarker?: THREE.Mesh;
  private starGlow?: THREE.Sprite;

  constructor(
    private readonly engine: EngineService,
    private readonly dataLoader: DataLoaderService,
    private readonly router: Router,
    readonly navigationStore: NavigationStore
  ) {
    effect(() => {
      const selectedStarId = this.navigationStore.selectedStarId();
      if (this.ready) {
        this.reconcileSelection(selectedStarId);
      }
    });
  }

  ngAfterViewInit(): void {
    void this.bootstrap();
  }

  ngOnDestroy(): void {
    this.unsubscribeTick?.();
    this.resizeObserver?.disconnect();
    this.canvasRef().nativeElement.removeEventListener('pointerdown', this.handlePointerDown);
    this.canvasRef().nativeElement.removeEventListener('click', this.handleClick);
    this.controls?.dispose();
    this.starField?.dispose();
    this.deepSky?.dispose();
    this.milkyWay?.dispose();
    this.galacticGrid?.dispose();
    this.localGrid?.dispose();
    this.tethers?.dispose();
    this.labelOverlay?.dispose();
    this.systemRenderer?.dispose();
    (this.starMarker?.material as THREE.Material | undefined)?.dispose();
    (this.starGlow?.material as THREE.SpriteMaterial | undefined)?.dispose();
    this.starMarkerGeometry?.dispose();
    this.starMarkerMaterial.dispose();
    this.engine.dispose();
  }

  /**
   * Moves the view to a wider scale, from the HUD's scale ladder.
   *
   * The two outer levels are one continuous space, so "go to the Milky Way" is a camera flight
   * rather than a scene change. Leaving a system is not: it has to unwind the unit-space swap
   * first, so a request made from inside a system is parked until the exit flight lands.
   */
  goToLevel(level: ViewLevel): void {
    if (level === 'system') {
      return;
    }

    if (this.currentStarId !== null || this.busy) {
      this.pendingLevel = level;
      this.navigationStore.selectStar(null);
      return;
    }

    this.flyToOverview(level);
  }

  private flyToOverview(level: ViewLevel): void {
    if (!this.rig) {
      return;
    }
    const pose = level === 'galactic' ? galacticOverviewPose() : { position: GALAXY_OVERVIEW_POSITION.clone(), target: GALAXY_OVERVIEW_TARGET.clone() };
    // The galactic flight covers four orders of magnitude, so it gets longer than a local hop.
    this.rig.flyTo(pose, level === 'galactic' ? GALACTIC_FLIGHT_SECONDS : RETURN_DURATION_SECONDS);
  }

  private async bootstrap(): Promise<void> {
    const canvas = this.canvasRef().nativeElement;

    try {
      await this.engine.init(canvas);
    } catch (error) {
      console.error('Failed to initialize the 3D engine.', error);
      return;
    }

    const scene = this.engine.getScene();
    const camera = this.engine.getCamera();
    camera.position.copy(GALAXY_OVERVIEW_POSITION);
    camera.near = GALAXY_NEAR_PC;
    camera.far = GALAXY_FAR_PC;
    camera.updateProjectionMatrix();

    this.controls = new OrbitControls(camera, canvas);
    this.controls.enableDamping = true;
    this.controls.minDistance = GALAXY_MIN_DISTANCE_PC;
    this.controls.maxDistance = GALAXY_MAX_DISTANCE_PC;
    this.controls.target.copy(GALAXY_OVERVIEW_TARGET);

    this.rig = new CameraRigController(camera, this.controls);

    scene.add(this.galaxyGroup, this.systemGroup);
    this.systemGroup.visible = false;
    applyMilkyWaySkybox(scene, MILKY_WAY_SKYBOX_PATH);

    const [{ stars, positions }, bodies, exoplanets, deepSky] = await Promise.all([
      this.dataLoader.loadStars(),
      this.dataLoader.loadBodies(),
      this.dataLoader.loadExoplanets(),
      // The backdrop is decorative — if its dataset is missing or malformed the star field
      // should still come up, so this one failure is swallowed rather than aborting bootstrap.
      this.dataLoader.loadDeepSky().catch((error) => {
        console.error('Failed to load the deep-sky backdrop; continuing without it.', error);
        return [] as DeepSkyRecord[];
      })
    ]);
    this.stars = stars;
    this.starsById = new Map(stars.map((star) => [star.id, star]));
    this.bodies = bodies;
    this.exoplanets = exoplanets;

    this.starField = new StarFieldRenderer(stars, positions);
    this.galaxyGroup.add(this.starField.object);

    this.milkyWay = new MilkyWayRenderer();
    this.galacticLabels = this.milkyWay.labelPoints();
    const centre = galacticCentrePositionPc();
    this.galacticGrid = new PolarGridPlane({
      ringRadii: GALACTIC_GRID_RINGS_PC,
      spokeCount: GALACTIC_GRID_SPOKES,
      centre: new THREE.Vector3(centre.x, centre.y, centre.z),
      emphasisRadii: [SUN_GALACTOCENTRIC_RADIUS_PC]
    });
    this.localGrid = new PolarGridPlane({
      ringRadii: LOCAL_GRID_RINGS_PC,
      spokeCount: LOCAL_GRID_SPOKES,
      emphasisRadii: [LOCAL_GRID_RINGS_PC[LOCAL_GRID_RINGS_PC.length - 1]]
    });
    // Drop lines for the Sun's nearest neighbours. A fixed set rather than whatever is currently
    // labelled: these are the stars the local view is about, they cluster where the grid is
    // densest, and a tether that appears and vanishes as the camera drifts reads as a glitch.
    this.tethers = new TetherField(TETHERED_STAR_COUNT);
    this.tethers.setTargets(
      [...stars]
        .sort((a, b) => Math.hypot(a.x, a.y, a.z) - Math.hypot(b.x, b.y, b.z))
        .slice(0, TETHERED_STAR_COUNT)
        .map((star) => new THREE.Vector3(star.x, star.y, star.z)),
      LOCAL_PLANE_HEIGHT_PC
    );
    this.galaxyGroup.add(this.milkyWay.object, this.galacticGrid.object, this.localGrid.object, this.tethers.object);

    if (deepSky.length > 0) {
      this.deepSky = new DeepSkyRenderer(deepSky);
      this.galaxyGroup.add(this.deepSky.object);
      this.deepSkyLabels = this.deepSky.labelPoints(DEEP_SKY_LABEL_COUNT);
    }

    this.labelOverlay = new StarLabelOverlay(scene);
    this.labelHostRef().nativeElement.appendChild(this.labelOverlay.domElement);
    const { width, height } = canvas.getBoundingClientRect();
    this.labelOverlay.setSize(width, height);

    canvas.addEventListener('pointerdown', this.handlePointerDown);
    canvas.addEventListener('click', this.handleClick);
    this.observeResize(canvas);

    this.unsubscribeTick = this.engine.onTick((deltaSeconds) => this.tick(camera, deltaSeconds));
    this.engine.start();

    this.ready = true;
    this.reconcileSelection(this.navigationStore.selectedStarId());
  }

  private tick(camera: THREE.PerspectiveCamera, deltaSeconds: number): void {
    this.rig?.update(deltaSeconds);
    this.controls?.update();

    // Gated on the galaxy group rather than on `currentStarId`, which is only assigned once the
    // arrival flight finishes. In between, the scene has already swapped to system space while
    // `currentStarId` is still null, so labels were being recomputed from galaxy-scale positions
    // and pinned over the system — the whole point of clearing them on the swap.
    if (this.galaxyGroup.visible) {
      // Per-frame, unlike the labels: this is a handful of uniform writes, and it is what keeps
      // the zoom continuous rather than stepping between two discrete scales.
      this.updateGalacticCrossfade(camera);
    }

    this.labelUpdateAccumulator += deltaSeconds;
    if (this.labelUpdateAccumulator >= LABEL_UPDATE_INTERVAL_SECONDS) {
      this.labelUpdateAccumulator = 0;
      if (this.galaxyGroup.visible) {
        this.updateLabels(camera);
      }
      this.updateHud(camera);
    }

    if (this.systemGroup.visible) {
      this.systemRenderer?.update(dateToJulianDate());
    }
    this.labelOverlay?.render(camera);
  }

  /**
   * Blends between the two things that share parsec space: the catalogued 50 pc star field with
   * its local grid, and the Milky Way model with its galactic one. Driven by how far the camera
   * has pulled back from the Sun, so the scale ladder reports where the view already is instead
   * of switching it.
   */
  private updateGalacticCrossfade(camera: THREE.PerspectiveCamera): void {
    if (!this.milkyWay) {
      return;
    }

    const distancePc = camera.position.length();
    this.galacticStrength = this.milkyWay.setViewerDistancePc(distancePc);

    this.galacticGrid?.setStrength(this.galacticStrength);
    this.localGrid?.setStrength(1 - this.galacticStrength);
    this.tethers?.setStrength(1 - this.galacticStrength);
    // The backdrop shell is the sky as seen from here; from outside it, it is a wall.
    this.deepSky?.setStrength(1 - this.galacticStrength);
    // Same argument for the skybox, and more sharply: it is a photograph of the Milky Way taken
    // from inside it, so it cannot also be the sky behind a view of the Galaxy from outside.
    this.engine.getScene().backgroundIntensity = 1 - this.galacticStrength;

    this.applyGalaxyDepthRange(camera, distancePc);
    const level: ViewLevel = this.galacticStrength >= GALACTIC_LEVEL_THRESHOLD ? 'galactic' : 'galaxy';
    if (this.navigationStore.viewLevel() !== level && !this.systemGroup.visible) {
      this.navigationStore.setViewLevel(level);
    }
  }

  /**
   * Keeps the depth range proportional to how far out the camera is. One fixed pair cannot serve
   * both ends of this view: flying into a star needs a near plane a hundredth of a parsec out,
   * and holding the Galaxy needs a far plane a hundred thousand parsecs out, and a projection
   * spanning both has no precision left to separate one spiral arm from the next.
   */
  private applyGalaxyDepthRange(camera: THREE.PerspectiveCamera, distancePc: number): void {
    const near = THREE.MathUtils.clamp(distancePc / 2000, GALAXY_NEAR_PC, GALACTIC_NEAR_PC);
    const far = THREE.MathUtils.clamp(distancePc * 8, GALAXY_FAR_PC, GALACTIC_FAR_PC);
    // Only when it has drifted enough to matter, so a slow zoom isn't rebuilding the projection
    // matrix on every frame of it.
    if (Math.abs(near - camera.near) > camera.near * 0.05 || Math.abs(far - camera.far) > camera.far * 0.05) {
      camera.near = near;
      camera.far = far;
      camera.updateProjectionMatrix();
    }
  }

  private updateLabels(camera: THREE.PerspectiveCamera): void {
    const selectedId = this.navigationStore.selectedStarId();
    // Measured from what the camera is looking at, not from where it is. Those differ by the
    // orbit distance, so a camera-relative rule names the stars closest to the near edge of the
    // view — a ring of labels around the outside of the thing the user is actually looking at.
    const { x: cx, y: cy, z: cz } = this.controls?.target ?? GALAXY_OVERVIEW_TARGET;
    const maxDistanceSq = LABEL_MAX_DISTANCE_PC * LABEL_MAX_DISTANCE_PC;

    const candidates: Array<{ star: StarRecord; distanceSq: number }> = [];
    for (const star of this.stars) {
      const dx = star.x - cx;
      const dy = star.y - cy;
      const dz = star.z - cz;
      const distanceSq = dx * dx + dy * dy + dz * dz;
      if (distanceSq <= maxDistanceSq || star.id === selectedId) {
        candidates.push({ star, distanceSq });
      }
    }

    candidates.sort((a, b) => a.distanceSq - b.distanceSq);
    // Individual star names mean nothing once the whole Galaxy is in frame — at that range the
    // entire catalogue is inside one pixel — so the labels hand over to the structural ones.
    const isGalactic = this.galacticStrength >= GALACTIC_LEVEL_THRESHOLD;
    const starLabels = isGalactic ? [] : this.spreadLabels(candidates, camera, selectedId);
    const backdropLabels = isGalactic ? this.galacticLabels : this.deepSkyLabels;
    this.labelOverlay?.update([...starLabels, ...backdropLabels]);
  }

  /**
   * Takes the nearest stars in order and keeps only those that land clear of the labels already
   * placed, dropping the rest.
   *
   * Nearest-first alone is not enough: the Sun's fifteen nearest neighbours are all inside four
   * parsecs, so from anything but point-blank range their names print on top of each other in a
   * single unreadable clump. Rejecting on screen separation instead of on distance means the set
   * naturally opens up as the camera closes in, and stays legible when it pulls back.
   */
  private spreadLabels(candidates: readonly { star: StarRecord }[], camera: THREE.PerspectiveCamera, selectedId: number | null): StarRecord[] {
    const placed: THREE.Vector2[] = [];
    const chosen: StarRecord[] = [];
    const projected = new THREE.Vector3();

    for (const { star } of candidates) {
      if (chosen.length >= LABEL_MAX_COUNT) {
        break;
      }

      projected.set(star.x, star.y, star.z).project(camera);
      const isSelected = star.id === selectedId;
      // Offscreen or behind the camera. The selection is exempt: it is about to be flown to, and
      // its label going missing mid-flight reads as the target having been lost.
      if (!isSelected && (projected.z < -1 || projected.z > 1 || Math.abs(projected.x) > 1 || Math.abs(projected.y) > 1)) {
        continue;
      }

      const point = new THREE.Vector2(projected.x * camera.aspect, projected.y);
      if (!isSelected && placed.some((other) => other.distanceTo(point) < LABEL_MIN_SEPARATION_NDC)) {
        continue;
      }

      placed.push(point);
      chosen.push(star);
    }

    return chosen;
  }

  /** Refreshes the readout panel for whichever scale the view is currently at. */
  private updateHud(camera: THREE.PerspectiveCamera): void {
    const star = this.currentStarId === null ? undefined : this.starsById.get(this.currentStarId);

    if (this.systemGroup.visible && star) {
      const planetCount = this.bodies.filter((body) => body.systemStarId === star.id && !body.parentBodyId).length + this.exoplanets.filter((exoplanet) => exoplanet.hostStarId === star.id).length;
      this.hudEyebrow.set('System');
      this.hudTitle.set(star.name);
      this.hudSubtitle.set(star.spectralType ? `Spectral type ${star.spectralType}` : '');
      this.hudReadouts.set([
        { label: 'Bodies', value: `${planetCount}` },
        { label: 'Distance', value: `${Math.hypot(star.x, star.y, star.z).toFixed(2)} pc` },
        { label: 'Magnitude', value: star.magnitude.toFixed(2) }
      ]);
      this.hudNote.set('Orbits propagated from published elements to the current date.');
      this.hudRange.set(formatAu(camera.position.distanceTo(this.controls?.target ?? GALAXY_OVERVIEW_TARGET)));
      return;
    }

    this.hudRange.set(formatParsecs(camera.position.length()));

    if (this.galacticStrength >= GALACTIC_LEVEL_THRESHOLD) {
      this.hudEyebrow.set('Galactic Scale');
      this.hudTitle.set('Milky Way');
      this.hudSubtitle.set('Barred spiral galaxy · our own');
      this.hudReadouts.set([
        { label: 'Sun to centre', value: `${(SUN_GALACTOCENTRIC_RADIUS_PC / 1000).toFixed(2)} kpc` },
        { label: 'Arms modelled', value: `${MILKY_WAY_ARMS.length}` },
        { label: 'Catalogued', value: `${this.stars.length} stars` }
      ]);
      this.hudNote.set('Galactic structure is an illustrative model built on measured arm geometry — no catalogue holds the Galaxy’s stars. Everything inside 50 pc is real.');
      return;
    }

    this.hudEyebrow.set('Solar Neighbourhood');
    this.hudTitle.set('Local Stars');
    this.hudSubtitle.set('Hipparcos · Yale Bright Star · Gliese');
    this.hudReadouts.set([
      { label: 'Stars', value: `${this.stars.length}` },
      { label: 'Radius', value: `${LOCAL_GRID_RINGS_PC[LOCAL_GRID_RINGS_PC.length - 1]} pc` },
      { label: 'Exoplanets', value: `${this.exoplanets.length}` }
    ]);
    this.hudNote.set('Positions from measured parallaxes. Grid marks the galactic plane through the Sun.');
  }

  /** Where the current press started, so a drag can be told apart from a click. */
  private readonly handlePointerDown = (event: PointerEvent): void => {
    this.pointerDownAt = { x: event.clientX, y: event.clientY };
  };

  private readonly handleClick = (event: MouseEvent): void => {
    if (this.rig?.isAnimating) {
      return;
    }

    // The browser fires `click` on release however far the pointer travelled, and OrbitControls
    // does not suppress it — so without this every drag-to-rotate that happens to finish over a
    // star would launch a camera flight into its system.
    const pressedAt = this.pointerDownAt;
    this.pointerDownAt = null;
    if (pressedAt && Math.hypot(event.clientX - pressedAt.x, event.clientY - pressedAt.y) > CLICK_DRAG_SLOP_PX) {
      return;
    }

    const canvas = this.canvasRef().nativeElement;
    const camera = this.engine.getCamera();
    const rect = canvas.getBoundingClientRect();
    const pointerNdc = new THREE.Vector2(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(pointerNdc, camera);

    if (this.currentStarId === null) {
      this.handleGalaxyClick(pointerNdc, camera);
    } else {
      this.handleSystemClick();
    }
  };

  private handleGalaxyClick(pointerNdc: THREE.Vector2, camera: THREE.PerspectiveCamera): void {
    if (!this.starField) {
      return;
    }
    // Screen-space rather than a raycast: the star field billboards in the vertex shader, so
    // its CPU-side geometry is a single quad at the origin. See `StarFieldRenderer.pickAt`.
    const starId = this.starField.pickAt(pointerNdc, camera);
    if (starId !== undefined) {
      this.navigationStore.selectStar(starId);
    }
  }

  private handleSystemClick(): void {
    if (!this.systemRenderer) {
      return;
    }
    const [hit] = this.raycaster.intersectObjects(this.systemRenderer.pickableObjects);
    const member = hit ? this.systemRenderer.memberForObject(hit.object) : undefined;
    if (member) {
      this.navigationStore.selectBody(member.id);
      void this.router.navigate(['/body', member.id]);
    }
  }

  /** Reacts to `NavigationStore.selectedStarId` changes coming from any source (click/search). */
  private reconcileSelection(selectedStarId: number | null): void {
    if (this.busy || selectedStarId === this.currentStarId) {
      return;
    }
    this.busy = true;

    if (selectedStarId === null) {
      this.exitToGalaxy(() => this.finishTransition());
    } else if (this.currentStarId === null) {
      this.enterSystem(selectedStarId, () => this.finishTransition());
    } else {
      // Star-to-star: exit the current system (short outward hop) then fly into the new one.
      this.exitToGalaxy(() => this.enterSystem(selectedStarId, () => this.finishTransition()), true);
    }
  }

  /** Re-checks the store in case the selection changed again while a transition was in flight. */
  private finishTransition(): void {
    this.busy = false;
    this.reconcileSelection(this.navigationStore.selectedStarId());

    // Only once the scene is settled back in parsec space can a scale request be honoured.
    const pending = this.pendingLevel;
    this.pendingLevel = null;
    if (pending && !this.busy && this.currentStarId === null) {
      this.flyToOverview(pending);
    }
  }

  private enterSystem(starId: number, onComplete: () => void): void {
    const star = this.starsById.get(starId);
    if (!star || !this.rig) {
      onComplete();
      return;
    }

    const camera = this.engine.getCamera();
    const starPc = new THREE.Vector3(star.x, star.y, star.z);
    const direction = camera.position.clone().sub(this.controls!.target).normalize();
    if (!Number.isFinite(direction.x) || direction.lengthSq() === 0) {
      direction.set(0, 0.3, 1).normalize();
    }

    const approachPosition = starPc.clone().add(direction.clone().multiplyScalar(GALAXY_APPROACH_DISTANCE_PC));
    this.rig.flyTo({ position: approachPosition, target: starPc }, APPROACH_DURATION_SECONDS, () => {
      this.swapToSystemSpace(star, direction, onComplete);
    });
  }

  private swapToSystemSpace(star: StarRecord, direction: THREE.Vector3, onComplete: () => void): void {
    const camera = this.engine.getCamera();

    this.systemRenderer?.dispose();
    if (this.starMarker) {
      this.systemGroup.remove(this.starMarker);
      (this.starMarker.material as THREE.Material).dispose();
    }
    if (this.starGlow) {
      this.systemGroup.remove(this.starGlow);
      (this.starGlow.material as THREE.SpriteMaterial).dispose();
      this.starGlow = undefined;
    }

    const systemBodies = this.bodies.filter((body) => body.systemStarId === star.id);
    const systemExoplanets = this.exoplanets.filter((exoplanet) => exoplanet.hostStarId === star.id);
    // The star's own position is the line of sight to it, which is the plane the archive
    // measures exoplanet inclinations against. The Sun sits at the origin and has no
    // exoplanets, so it has no meaningful direction and the renderer falls back.
    this.systemRenderer = new SystemOrbitsRenderer(systemBodies, systemExoplanets, { x: star.x, y: star.y, z: star.z });
    this.systemGroup.add(this.systemRenderer.object);

    // Sized against this system's innermost orbit, so the star never swallows its own planets.
    const starRadiusAu = starMarkerRadiusAu(this.systemRenderer.minTopLevelSemiMajorAxisAu);
    this.starMarkerGeometry?.dispose();
    this.starMarkerGeometry = new THREE.SphereGeometry(starRadiusAu, 24, 16);

    const starMarkerMaterial = this.starMarkerMaterial.clone();
    const starColor = colorIndexToRgb(star.colorIndex, star.spectralType);
    if (star.id === SOL_STAR_ID) {
      // The Sun is the only star we have (and could ever have) a real photograph of; every
      // other point in the galaxy view is far too distant to be resolved as a disk.
      starMarkerMaterial.map = loadCachedTexture(SUN_TEXTURE_PATH);
      starMarkerMaterial.color.set(0xffffff);
      this.starGlow = createGlowSprite(0xfff2c0, starRadiusAu, SUN_GLOW_SCALE);
    } else {
      starMarkerMaterial.color.copy(starColor);
      this.starGlow = createGlowSprite(starColor, starRadiusAu, SUN_GLOW_SCALE * 0.6);
    }
    this.starMarker = new THREE.Mesh(this.starMarkerGeometry, starMarkerMaterial);
    this.systemGroup.add(this.starMarker, this.starGlow);

    this.galaxyGroup.visible = false;
    this.systemGroup.visible = true;
    // Labels are CSS2D objects parented to the scene, not to galaxyGroup, so hiding the group
    // does not hide them: without this the galaxy-scale star names stay pinned on screen,
    // clumped over the system's star.
    this.labelOverlay?.update([]);

    camera.near = SYSTEM_NEAR_AU;
    camera.far = SYSTEM_FAR_AU;
    camera.updateProjectionMatrix();
    this.controls!.minDistance = SYSTEM_MIN_DISTANCE_AU;
    this.controls!.maxDistance = SYSTEM_MAX_DISTANCE_AU;

    this.rig!.setImmediate({ position: direction.clone().multiplyScalar(SYSTEM_ENTRY_DISTANCE_AU), target: new THREE.Vector3(0, 0, 0) });

    const framingDistance = systemFramingDistanceAu(this.systemRenderer.maxTopLevelSemiMajorAxisAu);
    // Arrives along whichever direction the approach came from, then swings round to look down
    // on this system's own orbital plane as it settles — so the swap stays continuous but the
    // system is not presented edge-on. See `systemViewDirection`.
    const viewDirection = systemViewDirection(this.systemRenderer.referenceFrame);

    this.rig!.flyTo({ position: viewDirection.multiplyScalar(framingDistance), target: new THREE.Vector3(0, 0, 0) }, SETTLE_DURATION_SECONDS, () => {
      this.currentStarId = star.id;
      this.navigationStore.setViewLevel('system');
      onComplete();
    });
  }

  private exitToGalaxy(onComplete: () => void, isSwitchingSystems = false): void {
    if (this.currentStarId === null || !this.rig) {
      onComplete();
      return;
    }

    const camera = this.engine.getCamera();
    const direction = camera.position.clone().sub(this.controls!.target).normalize();
    if (!Number.isFinite(direction.x) || direction.lengthSq() === 0) {
      direction.set(0, 0.3, 1).normalize();
    }
    const exitingStarId = this.currentStarId;

    this.rig.flyTo({ position: direction.clone().multiplyScalar(SYSTEM_EXIT_DISTANCE_AU), target: new THREE.Vector3(0, 0, 0) }, EXIT_DURATION_SECONDS, () => {
      this.swapToGalaxySpace(exitingStarId, direction, isSwitchingSystems, onComplete);
    });
  }

  private swapToGalaxySpace(exitingStarId: number, direction: THREE.Vector3, isSwitchingSystems: boolean, onComplete: () => void): void {
    const camera = this.engine.getCamera();
    const star = this.starsById.get(exitingStarId);
    const starPc = star ? new THREE.Vector3(star.x, star.y, star.z) : GALAXY_OVERVIEW_TARGET.clone();

    this.systemGroup.visible = false;
    this.galaxyGroup.visible = true;

    camera.near = GALAXY_NEAR_PC;
    camera.far = GALAXY_FAR_PC;
    camera.updateProjectionMatrix();
    this.controls!.minDistance = GALAXY_MIN_DISTANCE_PC;
    this.controls!.maxDistance = GALAXY_MAX_DISTANCE_PC;

    this.rig!.setImmediate({ position: starPc.clone().add(direction.clone().multiplyScalar(GALAXY_APPROACH_DISTANCE_PC)), target: starPc });

    if (isSwitchingSystems) {
      this.currentStarId = null;
      onComplete();
      return;
    }

    this.rig!.flyTo({ position: GALAXY_OVERVIEW_POSITION.clone(), target: GALAXY_OVERVIEW_TARGET.clone() }, RETURN_DURATION_SECONDS, () => {
      this.currentStarId = null;
      this.navigationStore.setViewLevel('galaxy');
      onComplete();
    });
  }

  private observeResize(canvas: HTMLCanvasElement): void {
    this.resizeObserver = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      this.engine.resize(width, height);
      this.labelOverlay?.setSize(width, height);
    });
    this.resizeObserver.observe(canvas);
  }
}
