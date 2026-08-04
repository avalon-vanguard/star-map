import { AfterViewInit, Component, effect, ElementRef, OnDestroy, viewChild } from '@angular/core';
import { Router } from '@angular/router';
import * as THREE from 'three/webgpu';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

import { dateToJulianDate } from '../../shared/astro/constants';
import { DataLoaderService } from '../../core/data/data-loader.service';
import { EngineService } from '../../core/engine/engine.service';
import { BodyRecord } from '../../shared/models/body.model';
import { DeepSkyRecord } from '../../shared/models/deepsky.model';
import { ExoplanetRecord } from '../../shared/models/exoplanet.model';
import { applyMilkyWaySkybox, createGlowSprite } from '../../shared/rendering/skybox';
import { loadCachedTexture, MILKY_WAY_SKYBOX_PATH, SUN_TEXTURE_PATH } from '../../shared/rendering/texture-catalog';
import { StarRecord } from '../../shared/models/star.model';
import { NavigationStore } from '../../shared/state/navigation.store';
import { CameraRigController } from './camera-rig-controller';
import { DeepSkyRenderer } from './deep-sky-renderer';
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
 * How many deep-sky objects get a permanent label. These sit on a fixed backdrop shell rather
 * than near the camera, so proximity is meaningless for them — the brightest handful are simply
 * always named.
 */
const DEEP_SKY_LABEL_COUNT = 12;
/** How often (seconds) the visible label set is recomputed; doesn't need to be per-frame. */
const LABEL_UPDATE_INTERVAL_SECONDS = 0.2;
/** Pointer travel (px) above which a press counts as an orbit drag rather than a selection. */
const CLICK_DRAG_SLOP_PX = 5;

const GALAXY_OVERVIEW_POSITION = new THREE.Vector3(0, 15, 30);
const GALAXY_OVERVIEW_TARGET = new THREE.Vector3(0, 0, 0);
const GALAXY_NEAR_PC = 0.01;
const GALAXY_FAR_PC = 5000;
const GALAXY_MIN_DISTANCE_PC = 0.5;
const GALAXY_MAX_DISTANCE_PC = 2000;
/** How close (pc) the camera dives toward a selected star before the unit-space swap. */
const GALAXY_APPROACH_DISTANCE_PC = 0.05;

const SYSTEM_NEAR_AU = 0.002;
const SYSTEM_FAR_AU = 20000;
const SYSTEM_MIN_DISTANCE_AU = 0.05;
const SYSTEM_MAX_DISTANCE_AU = 5000;
/** Where the camera lands (AU) immediately after swapping into system space, pre-settle. */
const SYSTEM_ENTRY_DISTANCE_AU = 200;
/** How far out (AU) the camera flies before swapping back to galaxy/parsec space. */
const SYSTEM_EXIT_DISTANCE_AU = 400;
const MIN_SYSTEM_FRAMING_DISTANCE_AU = 3;
const MAX_SYSTEM_FRAMING_DISTANCE_AU = 80;

const APPROACH_DURATION_SECONDS = 1.0;
const SETTLE_DURATION_SECONDS = 0.9;
const EXIT_DURATION_SECONDS = 0.9;
const RETURN_DURATION_SECONDS = 1.1;

const STAR_MARKER_RADIUS_AU = 0.2;

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
  template: `
    <div class="relative h-full w-full">
      <canvas #canvas data-testid="scene-canvas" class="block h-full w-full"></canvas>
      <div #labelHost class="absolute inset-0 overflow-hidden pointer-events-none"></div>
      @if (navigationStore.viewLevel() === 'system') {
        <button
          type="button"
          (click)="exitSystem()"
          class="absolute top-4 left-4 flex items-center gap-1.5 rounded-md border border-border bg-panel/70 px-3 py-1.5 font-body text-xs tracking-wide text-muted uppercase backdrop-blur-md transition-colors hover:border-accent hover:text-accent focus:outline-none focus:ring-1 focus:ring-accent/50"
        >
          <svg class="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M15 6l-6 6 6 6" />
          </svg>
          Galaxy
        </button>
      }
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
  private readonly starMarkerGeometry = new THREE.SphereGeometry(STAR_MARKER_RADIUS_AU, 24, 16);

  private controls?: OrbitControls;
  private rig?: CameraRigController;
  private starField?: StarFieldRenderer;
  private deepSky?: DeepSkyRenderer;
  private deepSkyLabels: readonly LabeledPoint[] = [];
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
    this.labelOverlay?.dispose();
    this.systemRenderer?.dispose();
    (this.starMarker?.material as THREE.Material | undefined)?.dispose();
    (this.starGlow?.material as THREE.SpriteMaterial | undefined)?.dispose();
    this.starMarkerGeometry.dispose();
    this.starMarkerMaterial.dispose();
    this.engine.dispose();
  }

  exitSystem(): void {
    this.navigationStore.selectStar(null);
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

    if (this.currentStarId === null) {
      this.labelUpdateAccumulator += deltaSeconds;
      if (this.labelUpdateAccumulator >= LABEL_UPDATE_INTERVAL_SECONDS) {
        this.labelUpdateAccumulator = 0;
        this.updateLabels(camera);
      }
    }

    if (this.currentStarId !== null) {
      this.systemRenderer?.update(dateToJulianDate());
    }
    this.labelOverlay?.render(camera);
  }

  private updateLabels(camera: THREE.PerspectiveCamera): void {
    const selectedId = this.navigationStore.selectedStarId();
    const { x: cx, y: cy, z: cz } = camera.position;
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
    const starLabels = candidates.slice(0, LABEL_MAX_COUNT).map((candidate) => candidate.star);
    this.labelOverlay?.update([...starLabels, ...this.deepSkyLabels]);
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
    this.systemRenderer = new SystemOrbitsRenderer(systemBodies, systemExoplanets);
    this.systemGroup.add(this.systemRenderer.object);

    const starMarkerMaterial = this.starMarkerMaterial.clone();
    const starColor = colorIndexToRgb(star.colorIndex, star.spectralType);
    if (star.id === SOL_STAR_ID) {
      // The Sun is the only star we have (and could ever have) a real photograph of; every
      // other point in the galaxy view is far too distant to be resolved as a disk.
      starMarkerMaterial.map = loadCachedTexture(SUN_TEXTURE_PATH);
      starMarkerMaterial.color.set(0xffffff);
      this.starGlow = createGlowSprite(0xfff2c0, STAR_MARKER_RADIUS_AU, SUN_GLOW_SCALE);
    } else {
      starMarkerMaterial.color.copy(starColor);
      this.starGlow = createGlowSprite(starColor, STAR_MARKER_RADIUS_AU, SUN_GLOW_SCALE * 0.6);
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

    const framingDistance = THREE.MathUtils.clamp(
      this.systemRenderer.maxTopLevelSemiMajorAxisAu * 2.4 || MIN_SYSTEM_FRAMING_DISTANCE_AU,
      MIN_SYSTEM_FRAMING_DISTANCE_AU,
      MAX_SYSTEM_FRAMING_DISTANCE_AU
    );

    this.rig!.flyTo({ position: direction.clone().multiplyScalar(framingDistance), target: new THREE.Vector3(0, 0, 0) }, SETTLE_DURATION_SECONDS, () => {
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
