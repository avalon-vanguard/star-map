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
import { starGlowExtentAu, starMarkerRadiusAu, systemFrameRadiusAu, systemFramingDistanceAu, systemViewDirection } from './system-framing';
import { formatAu, formatLuminosity, formatParsecs } from '../../shared/format/quantity';
import { BodyDetailViewModel } from '../body-detail/body-detail.model';
import { buildBodyViewModel, luminosityOf } from '../body-detail/body-view-model';
import { DEFAULT_HUD_DISPLAY, HudDisplay, HudDockComponent, HudReadout } from '../hud/hud-dock.component';
import { StarmapHudComponent } from './starmap-hud.component';
import { SystemObjectCardComponent } from './system-object-card.component';
import { colorIndexToRgb, StarFieldRenderer, starRenderBudgetFromUrl } from './star-field-renderer';
import { LabeledPoint, StarLabelOverlay } from './star-label-overlay';
import { SystemOrbitsRenderer } from './system-orbits-renderer';

/** HYG catalog id for the Sun itself — the only star we have a real close-up photo of. */
const SOL_STAR_ID = 0;
/** Stars drawn from a colour rather than a photograph get a more restrained halo. */
const DIM_STAR_GLOW_SCALE = 0.6;

/**
 * How far from what the camera is looking at a star can be and still be named, as a fraction of
 * how far back the camera is — so the net widens as the view pulls out and closes as it dives
 * in, instead of naming the same handful of stars at every scale. Bounded at both ends.
 */
const LABEL_RADIUS_TO_ORBIT_DISTANCE = 0.35;
const MIN_LABEL_RADIUS_PC = 4;
const MAX_LABEL_RADIUS_PC = 400;
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
  const view = galacticToEquatorial({ x: -105, y: -230, z: 175 });
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
const LOCAL_GRID_RINGS_PC = [50, 100, 150, 200, 250];
const LOCAL_GRID_SPOKES = 12;
/** Rings for the galactic grid (parsecs from the centre), with the Sun's orbit called out. */
const GALACTIC_GRID_RINGS_PC = [2500, 5000, SUN_GALACTOCENTRIC_RADIUS_PC, 11000, 14000];
const GALACTIC_GRID_SPOKES = 24;
/** The local grid passes through the Sun, which is the origin, so tethers drop to height zero. */
const LOCAL_PLANE_HEIGHT_PC = 0;
/**
 * How many stars get a permanent drop line to the local grid, and which ones: the brightest in
 * the catalogue rather than the Sun's nearest neighbours.
 *
 * Nearest-to-the-Sun was the right set when the catalogue stopped at 50 pc and the camera sat
 * just outside it. Across 250 pc those same stars are a speck at the centre, while the brightest
 * are spread through the whole volume — and are the ones the eye is already on.
 */
const TETHERED_STAR_COUNT = 60;

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
  imports: [HudDockComponent, StarmapHudComponent, SystemObjectCardComponent],
  template: `
    <div class="relative h-full w-full">
      <canvas #canvas data-testid="scene-canvas" class="block h-full w-full"></canvas>
      <!-- isolate: CSS2DRenderer gives every label its own z-index for depth ordering; without a
           stacking context here those indices escape and the labels paint over the HUD. -->
      <div #labelHost class="pointer-events-none absolute inset-0 isolate overflow-hidden"></div>
      <app-starmap-hud [level]="navigationStore.viewLevel()" [title]="hudTitle()" (levelSelected)="goToLevel($event)" />
      @if (objectCard(); as card) {
        <app-system-object-card [body]="card" (dismissed)="dismissObjectCard()" (openRequested)="openObjectDetail(card.id)" />
      }
      <app-hud-dock
        [eyebrow]="hudEyebrow()"
        [title]="hudTitle()"
        [subtitle]="hudSubtitle()"
        [readouts]="hudReadouts()"
        [note]="hudNote()"
        [range]="hudRange()"
        [display]="display()"
        defaultTab="readout"
        (displayChange)="display.set($event)"
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
  /** Which layers are drawn, as toggled from the dock. Applied by `applyDisplay`. */
  readonly display = signal<HudDisplay>(DEFAULT_HUD_DISPLAY);

  /**
   * The body whose card is showing: whichever is pinned by a click, else whatever the pointer is
   * over. Undefined outside the system view, and cleared when the view leaves one.
   */
  readonly objectCard = signal<BodyDetailViewModel | undefined>(undefined);
  private enterableSystems = 0;
  private pinnedBodyId: string | null = null;
  private hoveredBodyId: string | null = null;

  private controls?: OrbitControls;
  private rig?: CameraRigController;
  private starField?: StarFieldRenderer;
  private deepSky?: DeepSkyRenderer;
  private deepSkyLabels: readonly LabeledPoint[] = [];
  /** Stars with at least one catalogued body, which are the ones the map can be flown into. */
  private starIdsWithBodies = new Set<number>();
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
    effect(() => this.applyDisplay(this.display()));
  }

  ngAfterViewInit(): void {
    void this.bootstrap();
  }

  ngOnDestroy(): void {
    this.unsubscribeTick?.();
    this.resizeObserver?.disconnect();
    this.canvasRef().nativeElement.removeEventListener('pointerdown', this.handlePointerDown);
    this.canvasRef().nativeElement.removeEventListener('click', this.handleClick);
    this.canvasRef().nativeElement.removeEventListener('pointermove', this.handlePointerMove);
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
    // Which stars can be flown into: those with catalogued bodies of their own, plus the Sun.
    this.enterableSystems = new Set<number>([...bodies.map((body) => body.systemStarId), ...exoplanets.map((exoplanet) => exoplanet.hostStarId)].filter((id) => id !== null)).size;
    // Built once rather than per label refresh: it is a scan of every body and exoplanet, and the
    // labels are recomputed whenever the camera moves.
    this.starIdsWithBodies = new Set([...bodies.map((body) => body.systemStarId), ...exoplanets.map((exoplanet) => exoplanet.hostStarId)].filter(
      (id): id is number => id !== null && id !== undefined
    ));

    this.starField = new StarFieldRenderer(stars, positions, starRenderBudgetFromUrl(window.location.search));
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
    // A fixed set rather than whatever is currently labelled: a tether that appears and vanishes
    // as the camera drifts reads as a glitch.
    this.tethers = new TetherField(TETHERED_STAR_COUNT);
    this.tethers.setTargets(
      [...stars]
        .sort((a, b) => a.magnitude - b.magnitude)
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
    this.applyDisplay(this.display());
    const { width, height } = canvas.getBoundingClientRect();
    this.labelOverlay.setSize(width, height);

    canvas.addEventListener('pointerdown', this.handlePointerDown);
    canvas.addEventListener('click', this.handleClick);
    canvas.addEventListener('pointermove', this.handlePointerMove);
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
      } else if (this.systemGroup.visible) {
        this.updateSystemLabels(camera);
      }
      this.updateHud(camera);
    }

    if (this.systemGroup.visible) {
      this.systemRenderer?.update(dateToJulianDate());
    }
    this.labelOverlay?.render(camera);
  }

  /**
   * Blends between the two things that share parsec space: the catalogued star field with its
   * local grid, and the Milky Way model with its galactic one. Driven by how far the camera
   * has pulled back from the Sun, so the scale ladder reports where the view already is instead
   * of switching it.
   */
  private updateGalacticCrossfade(camera: THREE.PerspectiveCamera): void {
    if (!this.milkyWay) {
      return;
    }

    const distancePc = camera.position.length();
    this.galacticStrength = this.milkyWay.setViewerDistancePc(distancePc);

    // Layer toggles from the dock fold in here rather than as a one-off `visible = false`:
    // `setStrength` rewrites visibility every frame from the strength it is given, so a hidden
    // layer has to be told a strength of zero every frame too.
    const display = this.display();
    this.galacticGrid?.setStrength(display.grid ? this.galacticStrength : 0);
    this.localGrid?.setStrength(display.grid ? 1 - this.galacticStrength : 0);
    this.tethers?.setStrength(display.grid ? 1 - this.galacticStrength : 0);
    // The backdrop shell is the sky as seen from here; from outside it, it is a wall.
    this.deepSky?.setStrength(display.deepSky ? 1 - this.galacticStrength : 0);
    // Same argument for the skybox, and more sharply: it is a photograph of the Milky Way taken
    // from inside it, so it cannot also be the sky behind a view of the Galaxy from outside.
    this.engine.getScene().backgroundIntensity = display.sky ? 1 - this.galacticStrength : 0;

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
    const target = this.controls?.target ?? GALAXY_OVERVIEW_TARGET;
    const { x: cx, y: cy, z: cz } = target;
    const orbitDistance = (this.controls ? camera.position.distanceTo(target) : GALAXY_OVERVIEW_POSITION.length()) * LABEL_RADIUS_TO_ORBIT_DISTANCE;
    const labelRadius = THREE.MathUtils.clamp(orbitDistance, MIN_LABEL_RADIUS_PC, MAX_LABEL_RADIUS_PC);
    const maxDistanceSq = labelRadius * labelRadius;

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

    // Brightest first, not nearest first. Proximity was the right ranking when the catalogue was
    // a 50 pc bubble and everything in it was equally worth naming; across 250 pc it labels a
    // clump of whatever happens to be closest to the middle of the screen and never names the
    // stars that are actually prominent. Brightness is what makes a star worth a name.
    candidates.sort((a, b) => a.star.magnitude - b.star.magnitude);
    // Individual star names mean nothing once the whole Galaxy is in frame — at that range the
    // entire catalogue is inside one pixel — so the labels hand over to the structural ones.
    const isGalactic = this.galacticStrength >= GALACTIC_LEVEL_THRESHOLD;
    // "System" rather than "Star" for anything with catalogued bodies: it is the one distinction
    // the second line can draw that the map cannot otherwise show, since it says which of these
    // points is somewhere you can actually go.
    const starLabels: LabeledPoint[] = isGalactic
      ? []
      : this.spreadLabels(
          candidates.map(({ star }) => ({
            id: star.id,
            name: star.name,
            kind: this.starIdsWithBodies.has(star.id) ? 'System' : 'Star',
            x: star.x,
            y: star.y,
            z: star.z
          })),
          camera,
          selectedId
        );
    const backdropLabels = isGalactic ? this.galacticLabels : this.deepSkyLabels;
    this.labelOverlay?.update([...starLabels, ...backdropLabels]);
  }

  /**
   * Takes candidate labels in priority order and keeps only those that land clear of the labels
   * already placed, dropping the rest.
   *
   * Priority alone is not enough at either scale. The Sun's fifteen nearest neighbours are all
   * inside four parsecs, so from anything but point-blank range their names print on top of each
   * other in a single unreadable clump; the inner four planets do exactly the same thing when a
   * system is framed out to Pluto. Rejecting on screen separation rather than on distance means
   * the set naturally opens up as the camera closes in, and stays legible when it pulls back.
   *
   * `keepId` is exempt from both tests — it is the selection, which is about to be flown to, and
   * its label going missing mid-flight reads as the target having been lost.
   */
  private spreadLabels(candidates: readonly LabeledPoint[], camera: THREE.PerspectiveCamera, keepId: number | string | null): LabeledPoint[] {
    const placed: THREE.Vector2[] = [];
    const chosen: LabeledPoint[] = [];
    const projected = new THREE.Vector3();

    for (const candidate of candidates) {
      if (chosen.length >= LABEL_MAX_COUNT) {
        break;
      }

      projected.set(candidate.x, candidate.y, candidate.z).project(camera);
      const isKept = candidate.id === keepId;
      // Offscreen or behind the camera.
      if (!isKept && (projected.z < -1 || projected.z > 1 || Math.abs(projected.x) > 1 || Math.abs(projected.y) > 1)) {
        continue;
      }

      const point = new THREE.Vector2(projected.x * camera.aspect, projected.y);
      if (!isKept && placed.some((other) => other.distanceTo(point) < LABEL_MIN_SEPARATION_NDC)) {
        continue;
      }

      placed.push(point);
      chosen.push(candidate);
    }

    return chosen;
  }

  /**
   * Names the bodies of the system the view is inside.
   *
   * Outermost first, because that is the order that survives the separation test usefully: with
   * the whole system in frame the outer planets are the ones far enough apart to label, and the
   * inner four are a single clump around the star. Closing in reverses it on its own — the outer
   * orbits leave the frame and their labels drop out, freeing the space for the inner planets.
   *
   * Moons are left out entirely: they sit within a marker's width of their planet at system
   * framing, so their labels could only ever print on top of it.
   */
  private updateSystemLabels(camera: THREE.PerspectiveCamera): void {
    const renderer = this.systemRenderer;
    if (!renderer) {
      this.labelOverlay?.update([]);
      return;
    }

    const records = new Map<string, { name: string; semiMajorAxisAu: number }>([
      ...this.bodies.map((body): [string, { name: string; semiMajorAxisAu: number }] => [
        body.id,
        { name: body.name, semiMajorAxisAu: body.orbit.semiMajorAxisAu }
      ]),
      ...this.exoplanets.map((exoplanet): [string, { name: string; semiMajorAxisAu: number }] => [
        exoplanet.id,
        { name: exoplanet.name, semiMajorAxisAu: exoplanet.orbit?.semiMajorAxisAu ?? 0 }
      ])
    ]);
    const position = new THREE.Vector3();

    const points: Array<LabeledPoint & { semiMajorAxisAu: number }> = [];
    for (const member of renderer.members) {
      if (member.kind === 'moon') {
        continue;
      }
      const record = records.get(member.id);
      member.marker.getWorldPosition(position);
      points.push({
        id: member.id,
        name: record?.name ?? member.id,
        kind: member.kind === 'exoplanet' ? 'Exoplanet' : member.kind === 'dwarf' ? 'Dwarf Planet' : 'Planet',
        semiMajorAxisAu: record?.semiMajorAxisAu ?? 0,
        x: position.x,
        y: position.y,
        z: position.z
      });
    }

    points.sort((a, b) => b.semiMajorAxisAu - a.semiMajorAxisAu);
    this.labelOverlay?.update(this.spreadLabels(points, camera, null));
  }

  /** Refreshes the readout panel for whichever scale the view is currently at. */
  /**
   * Shows or hides the layers that hold still between frames: the label layer and the system
   * view's orbits and grid. The galaxy grids and deep-sky shell are crossfaded every frame
   * instead, so their toggles live in `updateGalacticCrossfade`. The skybox is both: the
   * crossfade rewrites its intensity while the galaxy is up, but the crossfade is parked in
   * system view, where the sky is still on screen — so it is also set here, once, on toggle.
   */
  private applyDisplay(display: HudDisplay): void {
    if (this.labelOverlay) {
      this.labelOverlay.domElement.style.display = display.labels ? '' : 'none';
    }
    this.systemRenderer?.setLayerVisibility({ orbits: display.orbits, grid: display.grid });
    // The effect that calls this fires once at construction, before the engine has a scene.
    if (this.engine.isInitialized) {
      this.engine.getScene().backgroundIntensity = display.sky ? 1 - this.galacticStrength : 0;
    }
  }

  private updateHud(camera: THREE.PerspectiveCamera): void {
    const star = this.currentStarId === null ? undefined : this.starsById.get(this.currentStarId);

    if (this.systemGroup.visible && star) {
      const planetCount = this.bodies.filter((body) => body.systemStarId === star.id && !body.parentBodyId).length + this.exoplanets.filter((exoplanet) => exoplanet.hostStarId === star.id).length;
      const moonCount = this.bodies.filter((body) => body.systemStarId === star.id && body.parentBodyId).length;
      const distancePc = Math.hypot(star.x, star.y, star.z);
      const luminosity = luminosityOf(star);
      this.hudEyebrow.set('System');
      this.hudTitle.set(star.name);
      this.hudSubtitle.set(star.spectralType ? `Spectral type ${star.spectralType}` : '');
      this.hudReadouts.set([
        { label: 'Bodies', value: moonCount > 0 ? `${planetCount} + ${moonCount} moons` : `${planetCount}` },
        // Suppressed for the Sun rather than printed as `0.00 pc`, which is arithmetically right
        // and reads as a bug: the distance from here to here is not a measurement.
        ...(distancePc > 0 ? [{ label: 'Distance', value: formatParsecs(distancePc) }] : []),
        { label: 'Magnitude', value: star.magnitude.toFixed(2) },
        ...(luminosity !== null ? [{ label: 'Luminosity', value: formatLuminosity(luminosity), derived: true }] : [])
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
      // Quotes the catalogue's own reach rather than a figure that has already been raised once.
      this.hudNote.set(`Galactic structure is an illustrative model built on measured arm geometry — no catalogue holds the Galaxy’s stars. The ${this.stars.length} catalogued stars within ${LOCAL_GRID_RINGS_PC[LOCAL_GRID_RINGS_PC.length - 1]} pc are real.`);
      return;
    }

    this.hudEyebrow.set('Solar Neighbourhood');
    this.hudTitle.set('Local Stars');
    this.hudSubtitle.set('Hipparcos · Yale Bright Star · Gliese');
    this.hudReadouts.set([
      // Both numbers, because they differ: the catalogue is what the map knows and the first is
      // what it draws. See `STAR_RENDER_BUDGET`.
      { label: 'Stars', value: this.starField && this.starField.drawnCount < this.stars.length ? `${this.starField.drawnCount} / ${this.stars.length}` : `${this.stars.length}` },
      { label: 'Radius', value: `${LOCAL_GRID_RINGS_PC[LOCAL_GRID_RINGS_PC.length - 1]} pc` },
      { label: 'Exoplanets', value: `${this.exoplanets.length}` },
      // The one thing the field itself cannot show: which of those points can be flown into.
      { label: 'Systems', value: `${this.enterableSystems}` }
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

  /**
   * Picks a body in the system view. Clicking one pins its card; clicking empty space unpins,
   * which is also how the card is dismissed without aiming for its close control.
   *
   * This used to navigate straight to `/body/:id`. That tore down the system scene and the camera
   * with it, so comparing two planets meant flying back into the system between each — the card
   * shows the same numbers over the live view instead, and `Full view` still opens the route.
   */
  private handleSystemClick(): void {
    if (!this.systemRenderer) {
      return;
    }
    const [hit] = this.raycaster.intersectObjects(this.systemRenderer.pickableObjects);
    const member = hit ? this.systemRenderer.memberForObject(hit.object) : undefined;

    this.pinnedBodyId = member ? member.id : null;
    if (member) {
      this.navigationStore.selectBody(member.id);
    }
    this.refreshObjectCard();
  }

  /**
   * Hover preview, so a body's figures can be read without committing a click.
   *
   * The raycast is against the system's own handful of pickable meshes rather than the star field,
   * so it stays cheap even on a software rasterizer — it is the rendering that is slow in that
   * environment, not the picking. Skipped outside the system view and during a camera flight.
   */
  private readonly handlePointerMove = (event: PointerEvent): void => {
    if (!this.systemRenderer || !this.systemGroup.visible || this.rig?.isAnimating) {
      return;
    }
    const canvas = this.canvasRef().nativeElement;
    const rect = canvas.getBoundingClientRect();
    const pointerNdc = new THREE.Vector2(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(pointerNdc, this.engine.getCamera());

    const [hit] = this.raycaster.intersectObjects(this.systemRenderer.pickableObjects);
    const hoveredId = (hit ? this.systemRenderer.memberForObject(hit.object) : undefined)?.id ?? null;
    if (hoveredId === this.hoveredBodyId) {
      return;
    }
    this.hoveredBodyId = hoveredId;
    canvas.style.cursor = hoveredId ? 'pointer' : '';
    this.refreshObjectCard();
  };

  /** A pinned body wins over a hovered one, so the card does not change under the pointer. */
  private refreshObjectCard(): void {
    const id = this.pinnedBodyId ?? this.hoveredBodyId;
    this.objectCard.set(id === null ? undefined : buildBodyViewModel(id, { bodies: this.bodies, exoplanets: this.exoplanets, stars: this.stars }));
  }

  /** Clears the card and everything that would bring it straight back. */
  private clearObjectCard(): void {
    this.pinnedBodyId = null;
    this.hoveredBodyId = null;
    this.objectCard.set(undefined);
    this.canvasRef().nativeElement.style.cursor = '';
  }

  dismissObjectCard(): void {
    this.clearObjectCard();
  }

  /** The deliberate step out to the dedicated route, from the card's own control. */
  openObjectDetail(id: string): void {
    this.navigationStore.selectBody(id);
    void this.router.navigate(['/body', id]);
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
    // The star's luminosity, derived from its own catalogued magnitude and distance, is what
    // decides how hot each body in the system is — and so what each of them looks like.
    const hostLuminosity = luminosityOf(star);
    this.systemRenderer = new SystemOrbitsRenderer(systemBodies, systemExoplanets, { x: star.x, y: star.y, z: star.z }, hostLuminosity);
    this.systemGroup.add(this.systemRenderer.object);
    this.applyDisplay(this.display());

    // Framed against the grid's outer ring rather than the outermost orbit — the ring is always
    // the wider of the two — and against the camera this scene actually has, so the margin holds
    // whatever the window shape. Computed before the star, because how far away the star will be
    // seen from is what decides how big its halo has to be to stay visible.
    const viewport = { fovDegrees: camera.fov, aspect: camera.aspect };
    const framingDistance = systemFramingDistanceAu(this.systemRenderer.gridOuterRadiusAu, viewport);
    const frameRadiusAu = systemFrameRadiusAu(framingDistance, viewport);

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
      this.starGlow = createGlowSprite(0xfff2c0, starGlowExtentAu(starRadiusAu, frameRadiusAu));
    } else {
      starMarkerMaterial.color.copy(starColor);
      this.starGlow = createGlowSprite(starColor, starGlowExtentAu(starRadiusAu, frameRadiusAu, DIM_STAR_GLOW_SCALE));
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
    // The bodies it described are no longer on screen, and a stale pin would otherwise survive
    // into the next system entered.
    this.clearObjectCard();

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
