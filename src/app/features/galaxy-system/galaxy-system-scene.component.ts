import { AfterViewInit, Component, computed, effect, ElementRef, OnDestroy, signal, viewChild } from '@angular/core';
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
import { DEFAULT_HUD_DISPLAY, HudDisplay, HudDockComponent, HudReadout  } from '../hud/hud-dock.component';
import { RouteRequest, RouteResult, RouteStarOption } from '../hud/routes-panel.component';
import { buildSearchIndex, IndexedSearchEntry, rankSearchResults } from '../search/search-ranking';
import { StarmapHudComponent } from './starmap-hud.component';
import { SystemObjectCardComponent } from './system-object-card.component';
import { colorIndexToRgb, StarFieldRenderer, starRenderBudgetFromUrl } from './star-field-renderer';
import { collectJumpLinks, minimumRangeBetween, routeBetween } from '../../shared/astro/jump-links';
import { StarNeighbourhood } from '../../shared/astro/star-neighbourhood';
import { HostStarRings } from './host-star-rings';
import { JumpLinkRenderer } from './jump-link-renderer';
import { ReservedBox, ringPlacement } from './label-ring';
import { LabeledPoint, LabelSide, StarLabelOverlay } from './star-label-overlay';
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
/** Beyond this the text of a right-hand label would run off the view: hang it on the left. */
const LABEL_EDGE_NDC = 0.7;
/** How far right of its point a label's text reaches, in aspect-scaled NDC (~135px at 1440). */
const LABEL_REACH_NDC = 0.3;
/** How long the range control has to be still before the graph is rebuilt at its value. */
const JUMP_LINK_REBUILD_DELAY_MS = 250;

/** How many matches each routing field offers, and how little may be typed to get any. */
const ROUTE_OPTION_COUNT = 6;
const MIN_ROUTE_QUERY_LENGTH = 2;
/**
 * The widest crossing `minimumRangeBetween` will consider when saying what a route would need.
 * Beyond this the catalogue is one component and the answer stops being informative.
 */
const ROUTE_RANGE_CEILING_PC = 30;

/** How many neighbouring stars are named from inside a system. */
const NEIGHBOUR_COUNT = 4;
/**
 * How far out from the centre of the view a neighbour's name sits, as a fraction of the frame's
 * half-height. Clear of the scale rail at the top and the dock at the bottom.
 */
const NEIGHBOUR_RING_NDC = 0.74;
/**
 * How far in front of the camera a neighbour's name is planted, in AU. Any depth projects to
 * the same place on the ring, but not to the same stability: unprojecting at the middle of the
 * depth buffer lands ~0.008 AU from the eye, where a hundredth of a degree of camera drift
 * swings the label across the screen. Out here the same drift moves it by a pixel.
 */
const NEIGHBOUR_DEPTH_AU = 500;

/** Radius of the selection arcs, in pixels — the leader line starts at their rim. */
const SELECTION_RADIUS_PX = 14;
const HUD_ACCENT = 0x4dd7ff;
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
      <!-- Between the canvas and the labels, not up in the HUD where it used to live: everything
           in this stack paints in tree order, so from there a decorative gradient was laid over
           the names near the edge of the frame — which is exactly where the neighbour ring is. -->
      <div aria-hidden="true" class="hud-vignette pointer-events-none absolute inset-0"></div>
      <!-- isolate: CSS2DRenderer gives every label its own z-index for depth ordering; without a
           stacking context here those indices escape and the labels paint over the HUD. -->
      <div #labelHost class="pointer-events-none absolute inset-0 isolate overflow-hidden"></div>
      <!-- Leader from the selected body to its card, drawn in screen space and repositioned in
           the render loop; visibility is toggled there too, so no change detection per frame. -->
      <svg aria-hidden="true" class="pointer-events-none absolute inset-0 h-full w-full text-accent/60">
        <line #leader x1="0" y1="0" x2="0" y2="0" stroke="currentColor" stroke-width="1" visibility="hidden" />
      </svg>
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
        [routing]="true"
        [routeResult]="routeResult()"
        [routeOptions]="routeOptions()"
        [currentStar]="currentStarOption()"
        defaultTab="readout"
        (displayChange)="display.set($event)"
        (routeQuery)="onRouteQuery($event)"
        (routeRequested)="onRouteRequested($event)"
        (routeStarSelected)="navigationStore.selectStar($event)"
        (jumpRangeChange)="jumpRangePc.set($event)"
      />
    </div>
  `
})
export class GalaxySystemSceneComponent implements AfterViewInit, OnDestroy {
  private readonly canvasRef = viewChild.required<ElementRef<HTMLCanvasElement>>('canvas');
  private readonly labelHostRef = viewChild.required<ElementRef<HTMLDivElement>>('labelHost');
  private readonly leaderRef = viewChild.required<ElementRef<SVGLineElement>>('leader');
  private readonly objectCardRef = viewChild<SystemObjectCardComponent, ElementRef<HTMLElement>>(SystemObjectCardComponent, { read: ElementRef });
  private readonly dockRef = viewChild<HudDockComponent, ElementRef<HTMLElement>>(HudDockComponent, { read: ElementRef });
  /**
   * The card's own box, looked up when the card changes rather than in the render loop that
   * draws the leader to it. The host element is a stable wrapper; the panel inside it is what
   * moves, and it is only replaced when a different body is selected.
   */
  private readonly objectCardElement = computed(() => this.objectCardRef()?.nativeElement.querySelector('[data-testid="object-card"]') ?? null);

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
  /** The body the card is about — what the selection mark brackets and the leader line leaves. */
  private cardBodyId: string | null = null;

  private controls?: OrbitControls;
  private rig?: CameraRigController;
  private starField?: StarFieldRenderer;
  private hostRings?: HostStarRings;
  /** Proximity over the whole catalogue, built once; the neighbour labels are one query on it. */
  private neighbourhood?: StarNeighbourhood;
  private jumpLinks?: JumpLinkRenderer;
  /** How far a single crossing may be. Drives both the drawn graph and the route walked on it. */
  readonly jumpRangePc = signal(3);
  readonly routeResult = signal<RouteResult | null>(null);
  /**
   * Matches for whichever routing field is being typed into. Stars only: a route is a chain of
   * stars, and offering a moon as a destination would be offering a place that leads nowhere.
   *
   * Derived rather than assigned, because the two things it needs arrive in either order — the
   * catalogue is still loading when the dock is already up, and a query typed before it lands
   * used to return nothing and stay nothing until the next keystroke.
   */
  readonly routeOptions = computed<readonly RouteStarOption[]>(() => {
    const query = this.routeQuery().trim();
    const index = this.starSearchIndex();
    if (query.length < MIN_ROUTE_QUERY_LENGTH || index.length === 0) {
      return [];
    }
    return rankSearchResults(index, query, ROUTE_OPTION_COUNT).flatMap((entry) =>
      entry.starId === undefined ? [] : [{ id: entry.starId, name: entry.name, subtitle: entry.subtitle }]
    );
  });
  private readonly routeQuery = signal('');
  /** The range the drawn graph was last built at, so a redraw is skipped when nothing moved. */
  private drawnJumpRangePc: number | null = null;
  private jumpLinkRebuild?: ReturnType<typeof setTimeout>;
  /** The current system's neighbours, resolved on arrival: id, name, distance and bearing. */
  private neighbours: readonly { star: StarRecord; distancePc: number; direction: THREE.Vector3 }[] = [];
  /**
   * The HUD boxes the ring prints around, read on the label pass rather than per frame: each
   * read is a forced layout, and the panels move when a tab is switched, not between frames.
   */
  private reserved: readonly ReservedBox[] = [];
  /** Scratch for the per-frame ring maths, so holding the ring still allocates nothing. */
  private readonly ringBearing = new THREE.Vector3();
  private readonly ringInverse = new THREE.Quaternion();
  private readonly ringPoint = new THREE.Vector3();
  private deepSky?: DeepSkyRenderer;
  private deepSkyLabels: readonly LabeledPoint[] = [];
  /** Stars with at least one catalogued body, which are the ones the map can be flown into. */
  private starIdsWithBodies = new Set<number>();
  /** Stars alone, normalised once, for the two routing fields. Empty until the catalogue lands. */
  private readonly starSearchIndex = signal<IndexedSearchEntry[]>([]);
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
    // Reads both signals, so flipping the layer on and dragging the range each land here. The
    // rebuild is a quarter-second of walking the catalogue, and the range control emits per
    // pixel dragged, so it waits for the hand to settle rather than running once per pixel.
    effect(() => {
      this.jumpRangePc();
      this.display().jumpLinks;
      clearTimeout(this.jumpLinkRebuild);
      this.jumpLinkRebuild = setTimeout(() => this.refreshJumpLinks(), JUMP_LINK_REBUILD_DELAY_MS);
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
    this.canvasRef().nativeElement.removeEventListener('pointermove', this.handlePointerMove);
    this.controls?.dispose();
    this.starField?.dispose();
    this.hostRings?.dispose();
    this.jumpLinks?.dispose();
    clearTimeout(this.jumpLinkRebuild);
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
    this.neighbourhood = new StarNeighbourhood(stars);
    this.starSearchIndex.set(
      buildSearchIndex(stars.map((star) => ({ kind: 'star' as const, name: star.name, subtitle: star.spectralType, starId: star.id })))
    );
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
    this.hostRings = new HostStarRings(stars.filter((star) => this.starIdsWithBodies.has(star.id)), HUD_ACCENT);
    this.galaxyGroup.add(this.hostRings.object);
    this.jumpLinks = new JumpLinkRenderer(HUD_ACCENT);
    this.galaxyGroup.add(this.jumpLinks.object);

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

    // A neighbour's label offers to fly there, and goes through the store like every other way
    // of choosing a star — so a label click, a search hit and an in-scene click are one path.
    this.labelOverlay = new StarLabelOverlay(scene, (starId) => this.navigationStore.selectStar(starId));
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
    this.updateSelectionMark(camera);
    this.updateNeighbourRing(camera);
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
    this.hostRings?.setStrength(display.systems ? 1 - this.galacticStrength : 0);
    this.jumpLinks?.setStrength(display.jumpLinks ? 1 - this.galacticStrength : 0);
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

      // Text hangs on the right unless it would run off the view there, or into the space a
      // label already placed to the right is using; then it hangs on the left, unless *that*
      // is off the view. A crowded centre still gets right-hand labels — the separation test
      // above already keeps them apart.
      const crowdedRight = placed.some(
        (other) => other.x > point.x && other.x - point.x < LABEL_REACH_NDC && Math.abs(other.y - point.y) < LABEL_MIN_SEPARATION_NDC
      );
      // The body the card is about hangs its label on the left regardless: the leader line to
      // the card leaves its right, and would otherwise run straight through the text.
      const side: LabelSide =
        candidate.id === this.cardBodyId || ((projected.x > LABEL_EDGE_NDC || crowdedRight) && projected.x > -LABEL_EDGE_NDC) ? 'left' : 'right';

      placed.push(point);
      chosen.push({ ...candidate, side });
    }

    return chosen;
  }

  /**
   * Brackets the body the card is about with the selection arcs, and draws the leader from
   * their rim to the card's near edge. Screen-space work done here, once per frame, because the
   * body moves every frame and the card's height depends on its content.
   */
  private updateSelectionMark(camera: THREE.PerspectiveCamera): void {
    const leader = this.leaderRef().nativeElement;
    const member = this.systemGroup.visible && this.cardBodyId !== null ? this.systemRenderer?.members.find((candidate) => candidate.id === this.cardBodyId) : undefined;
    if (!member) {
      this.labelOverlay?.setSelection(null);
      leader.setAttribute('visibility', 'hidden');
      return;
    }

    const world = member.marker.getWorldPosition(new THREE.Vector3());
    this.labelOverlay?.setSelection(world);

    const card = this.objectCardElement();
    const canvas = this.canvasRef().nativeElement;
    const projected = world.clone().project(camera);
    if (!card || projected.z > 1) {
      leader.setAttribute('visibility', 'hidden');
      return;
    }
    const canvasRect = canvas.getBoundingClientRect();
    const cardRect = card.getBoundingClientRect();
    const fromX = ((projected.x + 1) / 2) * canvas.clientWidth;
    const fromY = ((1 - projected.y) / 2) * canvas.clientHeight;
    // The card is top-right: meet its left edge, at the body's height where the edge allows.
    const toX = cardRect.left - canvasRect.left;
    const toY = Math.min(Math.max(fromY, cardRect.top - canvasRect.top + 12), cardRect.bottom - canvasRect.top - 12);
    const dx = toX - fromX;
    const dy = toY - fromY;
    const length = Math.hypot(dx, dy);
    if (length <= SELECTION_RADIUS_PX) {
      leader.setAttribute('visibility', 'hidden');
      return;
    }
    // Start on the arcs' rim, not the body's centre.
    leader.setAttribute('x1', String(fromX + (dx / length) * SELECTION_RADIUS_PX));
    leader.setAttribute('y1', String(fromY + (dy / length) * SELECTION_RADIUS_PX));
    leader.setAttribute('x2', String(toX));
    leader.setAttribute('y2', String(toY));
    leader.setAttribute('visibility', 'visible');
  }

  /** Resolves the current system's neighbours once, on arrival. Cleared outside a system. */
  private resolveNeighbours(): void {
    const origin = this.currentStarId === null ? undefined : this.starsById.get(this.currentStarId);
    if (!origin || !this.neighbourhood) {
      this.neighbours = [];
      return;
    }
    this.neighbours = this.neighbourhood
      // Asked wide and cut back, because a catalogue holds binary companions as two rows at one
      // position: a neighbour whose separation rounds to what no separation prints as is not a
      // place to go, it is the same place. Compared through the formatter rather than against a
      // hand-picked epsilon, so the rule stays "would print as zero" whatever the formatter does.
      .nearest(origin.id, NEIGHBOUR_COUNT * 2)
      .filter((neighbour) => formatParsecs(neighbour.distancePc) !== formatParsecs(0))
      .slice(0, NEIGHBOUR_COUNT)
      .flatMap((neighbour) => {
        const star = this.starsById.get(neighbour.id);
        return star
          ? [
              {
                star,
                distancePc: neighbour.distancePc,
                // A unit vector in the catalogue's parsec frame, which is the same direction in
                // the system's AU frame: only the scale between the two differs.
                direction: new THREE.Vector3(star.x - origin.x, star.y - origin.y, star.z - origin.z).normalize()
              }
            ]
          : [];
      });
  }

  /** Re-reads the HUD surfaces the ring has to print around, as boxes relative to the canvas. */
  private refreshReservedBoxes(): void {
    const canvas = this.canvasRef().nativeElement.getBoundingClientRect();
    const panels = [
      this.dockRef()?.nativeElement.querySelector('[role="tabpanel"]'),
      this.dockRef()?.nativeElement.querySelector('[role="tablist"]')?.parentElement,
      this.objectCardRef()?.nativeElement.querySelector('[data-testid="object-card"]')
    ];
    this.reserved = panels.flatMap((panel) => {
      if (!panel) {
        return [];
      }
      const box = panel.getBoundingClientRect();
      return [{ left: box.left - canvas.left, top: box.top - canvas.top, right: box.right - canvas.left, bottom: box.bottom - canvas.top }];
    });
  }

  /**
   * Where a neighbour's name sits: on the ring, at the bearing its own direction lands on —
   * moved along the ring where a HUD panel already holds that place. `null` where the whole
   * neighbourhood of that bearing is covered.
   */
  private neighbourRingPosition(camera: THREE.PerspectiveCamera, direction: THREE.Vector3): THREE.Vector3 | null {
    const bearing = this.ringBearing.copy(direction).applyQuaternion(this.ringInverse.copy(camera.quaternion).invert());
    // A neighbour behind the camera keeps the side it is on, which is still the way to turn to
    // bring it round.
    const angle = Math.atan2(bearing.y, bearing.x);
    const canvas = this.canvasRef().nativeElement;
    const placed = ringPlacement(angle, NEIGHBOUR_RING_NDC, { width: canvas.clientWidth, height: canvas.clientHeight }, this.reserved);
    if (!placed) {
      return null;
    }
    const along = this.ringPoint.set(placed.x, placed.y, 0.5).unproject(camera).sub(camera.position).normalize();
    return along.multiplyScalar(NEIGHBOUR_DEPTH_AU).add(camera.position);
  }

  /**
   * Names the stars nearest the one the camera is inside, each on the side of the view its own
   * lies on. It is the one thing a system view cannot otherwise say: which way its neighbours
   * are, and how far. Each is a button that flies there, so a chain of neighbours can be walked
   * without pulling back out to the field between hops.
   *
   * These are bearings, not sky positions, and are drawn as such: a ring of names at a fixed
   * radius from the centre of the frame, which reads as instrument rather than as scene. The
   * true position cannot be drawn — the nearest star to the Sun is 268 000 AU away, thirteen
   * times the far plane — and a true *direction* is worse than useless here: at this field of
   * view three neighbours in four fall outside the frame, so the view would name whichever
   * happened to be in front and stay silent about the rest. What survives is the half of the
   * direction a viewer can act on: which way to turn to face it.
   */
  private neighbourLabels(camera: THREE.PerspectiveCamera): LabeledPoint[] {
    this.refreshReservedBoxes();
    return this.neighbours.flatMap(({ star, distancePc, direction }) => {
      const position = this.neighbourRingPosition(camera, direction);
      if (!position) {
        return [];
      }
      return [{
        // Namespaced, so a star's ghost and the same star's own label in the galaxy view are
        // never the one DOM node being asked to be two different things.
        id: `neighbour:${star.id}`,
        name: star.name,
        kind: formatParsecs(distancePc),
        tone: 'ghost' as const,
        selectStarId: star.id,
        x: position.x,
        y: position.y,
        z: position.z
      }];
    });
  }

  /**
   * Holds the ring still. The names are placed relative to the camera, so between label passes
   * — five a second — any camera movement would drag them off the ring and snap them back. This
   * runs every frame and costs four vector operations.
   */
  private updateNeighbourRing(camera: THREE.PerspectiveCamera): void {
    if (!this.systemGroup.visible || this.neighbours.length === 0) {
      return;
    }
    for (const { star, direction } of this.neighbours) {
      const position = this.neighbourRingPosition(camera, direction);
      if (position) {
        this.labelOverlay?.moveLabel(`neighbour:${star.id}`, position.x, position.y, position.z);
      }
    }
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
    // Bodies first, so a neighbour's name never takes the space one of this system's own would
    // have had: `spreadLabels` keeps whichever candidate it reaches first.
    this.labelOverlay?.update(this.spreadLabels([...points, ...this.neighbourLabels(camera)], camera, null));
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

  /** Offered as the departure without typing, since it is where the view already is. */
  readonly currentStarOption = computed<RouteStarOption | null>(() => {
    const starId = this.navigationStore.selectedStarId();
    const star = starId === null ? undefined : this.starsById.get(starId);
    return star ? { id: star.id, name: star.name, subtitle: star.spectralType } : null;
  });

  onRouteQuery(query: string): void {
    this.routeQuery.set(query);
  }

  /**
   * Walks the graph, and where it cannot, says what range would. The search is lazy — it asks
   * the index for a star's neighbours as it reaches that star — so plotting one route never
   * costs a pass over the catalogue.
   */
  onRouteRequested({ fromId, toId, rangePc }: RouteRequest): void {
    if (!this.neighbourhood) {
      return;
    }
    const route = routeBetween(this.neighbourhood, fromId, toId, rangePc);
    if (route) {
      this.routeResult.set({
        stars: route.stars.map((id) => ({ id, name: this.starsById.get(id)?.name ?? `Star ${id}` })),
        totalPc: route.totalPc,
        neededRangePc: null
      });
      this.jumpLinks?.setRoute(route.stars, (id) => this.starsById.get(id));
      return;
    }
    this.routeResult.set({
      stars: [],
      totalPc: 0,
      neededRangePc: minimumRangeBetween(this.neighbourhood, fromId, toId, ROUTE_RANGE_CEILING_PC)
    });
    this.jumpLinks?.setRoute([], () => undefined);
  }

  /**
   * Rebuilds the drawn graph, which is the expensive half: every star's neighbours, once. Only
   * when the layer is on and the range has actually moved — the control emits per pixel dragged.
   */
  private refreshJumpLinks(): void {
    if (!this.jumpLinks || !this.neighbourhood) {
      return;
    }
    const rangePc = this.jumpRangePc();
    if (!this.display().jumpLinks) {
      if (this.drawnJumpRangePc !== null) {
        this.jumpLinks.setLinks([], () => undefined);
        this.drawnJumpRangePc = null;
      }
      return;
    }
    if (this.drawnJumpRangePc === rangePc) {
      return;
    }
    this.drawnJumpRangePc = rangePc;
    const links = collectJumpLinks(this.neighbourhood, rangePc);
    this.jumpLinks.setLinks(links, (id) => this.starsById.get(id));
  }

  /** A pinned body wins over a hovered one, so the card does not change under the pointer. */
  private refreshObjectCard(): void {
    const id = this.pinnedBodyId ?? this.hoveredBodyId;
    this.cardBodyId = id;
    this.objectCard.set(id === null ? undefined : buildBodyViewModel(id, { bodies: this.bodies, exoplanets: this.exoplanets, stars: this.stars }));
  }

  /** Clears the card and everything that would bring it straight back. */
  private clearObjectCard(): void {
    this.pinnedBodyId = null;
    this.hoveredBodyId = null;
    this.cardBodyId = null;
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
      this.resolveNeighbours();
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
      this.resolveNeighbours();
      onComplete();
      return;
    }

    this.rig!.flyTo({ position: GALAXY_OVERVIEW_POSITION.clone(), target: GALAXY_OVERVIEW_TARGET.clone() }, RETURN_DURATION_SECONDS, () => {
      this.currentStarId = null;
      this.resolveNeighbours();
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
