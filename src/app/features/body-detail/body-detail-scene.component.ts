import { AfterViewInit, Component, ElementRef, OnDestroy, signal, viewChild } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { Subscription } from 'rxjs';
import * as THREE from 'three/webgpu';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

import { DataLoaderService } from '../../core/data/data-loader.service';
import { EngineService } from '../../core/engine/engine.service';
import { bodyPageView } from '../../shared/rendering/body-orientation';
import { planetTexture } from '../../shared/rendering/procedural-planet-texture';
import { applyMilkyWaySkybox, createGlowSprite } from '../../shared/rendering/skybox';
import { atmosphereColorFor, bodyTexturePath, loadCachedTexture, MILKY_WAY_SKYBOX_PATH, saturnRing } from '../../shared/rendering/texture-catalog';
import { BodyRecord } from '../../shared/models/body.model';
import { ExoplanetRecord } from '../../shared/models/exoplanet.model';
import { StarRecord } from '../../shared/models/star.model';
import { Bookmark } from '../../shared/state/bookmarks.store';
import { NavigationStore } from '../../shared/state/navigation.store';
import { TimeStore } from '../../shared/state/time.store';
import { ChevronIconComponent } from '../../shared/ui/chevron-icon.component';
import { HudDockComponent } from '../hud/hud-dock.component';
import { BodyDetailViewModel } from './body-detail.model';
import { buildBodyViewModel } from './body-view-model';
import { InfoPanelComponent } from './info-panel.component';

/** Gas giants read as smoother/less rocky than terrestrial bodies under the same lighting rig. */
const GAS_GIANT_IDS = new Set(['jupiter', 'saturn', 'uranus', 'neptune']);
/** The body is drawn at unit radius here, so the halo's extent is its multiple directly. */
const GLOW_SCALE = 2.6;
/** Where the page's light stands, and the Sun with it wherever the body's real one is known. */
const SUN_LIGHT_POSITION = new THREE.Vector3(4, 3, 5);

/**
 * Separate, focused route for inspecting a single planet/moon/exoplanet: its own scene/camera
 * (via a dedicated `EngineService` instance, unrelated to the galaxy/system camera rig) plus
 * an `InfoPanelComponent` showing its real NASA data. Reachable from system-view picking or
 * search, and keeps `NavigationStore` in sync so returning to `/` resumes the correct system.
 *
 * Reacts to `ActivatedRoute.paramMap` (rather than reading the route snapshot once) because
 * Angular's default route-reuse strategy keeps this component instance alive when navigating
 * directly from one `/body/:id` to another (e.g. selecting a second search result while
 * already on a body's detail page) — only the id param changes, not the route config.
 */
@Component({
  selector: 'app-body-detail-scene',
  providers: [EngineService],
  imports: [ChevronIconComponent, HudDockComponent, InfoPanelComponent, RouterLink],
  template: `
    <div class="relative h-full w-full">
      <canvas #canvas data-testid="scene-canvas" class="block h-full w-full"></canvas>
      @if (viewModel()) {
        <app-info-panel [body]="viewModel()!" />
      } @else if (notFound()) {
        <div class="hud-brackets hud-acquire hud-surface absolute top-4 right-4 w-80 max-w-[calc(100%-2rem)] p-4 font-body text-text">
          <p class="type-eyebrow text-accent">No record</p>
          <p class="mt-2 text-sm text-muted">That id isn't in the catalog — it may have been renamed or mistyped.</p>
          <a
            routerLink="/"
            class="type-label mt-4 inline-flex items-center gap-2 border border-border/60 px-3 py-1.5 text-muted transition-colors hover:border-accent/70 hover:text-accent focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            <app-chevron-icon class="h-3 w-3" direction="left" />
            Back to the galaxy
          </a>
        </div>
      }
      <!-- Search, what has been kept and the clock: there is no scene readout here, the info
           panel is the reading, and the panel's own control is what keeps this body. A solar-system
           body is drawn at the clock's date and turns at its rate, so both are shown and can be set
           here; an exoplanet, whose day no one has measured, turns for show whatever the clock says. -->
      <app-hud-dock [date]="date()" [clock]="true" (bookmarkChosen)="goToBookmark($event)" />
    </div>
  `
})
export class BodyDetailSceneComponent implements AfterViewInit, OnDestroy {
  /** A kept place, revisited from this page: a star means leaving it for the map. */
  goToBookmark(bookmark: Bookmark): void {
    if (bookmark.kind === 'star') {
      this.navigationStore.selectStar(Number(bookmark.id));
      void this.router.navigate(['/']);
    } else {
      void this.router.navigate(['/body', String(bookmark.id)]);
    }
  }

  private readonly canvasRef = viewChild.required<ElementRef<HTMLCanvasElement>>('canvas');

  private controls?: OrbitControls;
  private scene?: THREE.Scene;
  private planet?: THREE.Mesh;
  private planetMaterial?: THREE.MeshStandardMaterial;
  private sunLight?: THREE.DirectionalLight;
  /** The solar-system record behind the body shown, which is what can be turned by its real pole. */
  private body?: BodyRecord;
  private ring?: THREE.Mesh;
  private glow?: THREE.Sprite;
  private resizeObserver?: ResizeObserver;
  private unsubscribeTick?: () => void;
  private paramSubscription?: Subscription;
  private sceneReady = false;

  private stars: readonly StarRecord[] = [];
  private bodies: readonly BodyRecord[] = [];
  private exoplanets: readonly ExoplanetRecord[] = [];

  readonly viewModel = signal<BodyDetailViewModel | undefined>(undefined);
  readonly notFound = signal(false);
  /** The date the body is drawn for, as the dock's strip prints it; empty at the present. */
  readonly date = signal('');
  /** The side of the equator the Sun stood on at the last frame, 1 north or -1 south; 0 once a body is shown. */
  private sunSide = 0;

  constructor(
    private readonly engine: EngineService,
    private readonly dataLoader: DataLoaderService,
    private readonly route: ActivatedRoute,
    private readonly router: Router,
    private readonly navigationStore: NavigationStore,
    private readonly time: TimeStore
  ) {}

  ngAfterViewInit(): void {
    void this.bootstrap();
  }

  ngOnDestroy(): void {
    this.paramSubscription?.unsubscribe();
    this.unsubscribeTick?.();
    this.resizeObserver?.disconnect();
    this.controls?.dispose();
    this.planet?.geometry.dispose();
    this.planetMaterial?.dispose();
    this.disposeRing();
    this.disposeGlow();
    this.engine.dispose();
  }

  private async bootstrap(): Promise<void> {
    const [stars, bodies, exoplanets] = await Promise.all([this.dataLoader.loadStars(), this.dataLoader.loadBodies(), this.dataLoader.loadExoplanets()]);
    this.stars = stars.stars;
    this.bodies = bodies;
    this.exoplanets = exoplanets;

    await this.initScene();
    this.sceneReady = true;

    this.paramSubscription = this.route.paramMap.subscribe((params) => {
      this.showBody(params.get('id'));
    });
  }

  private showBody(id: string | null): void {
    if (!id) {
      this.viewModel.set(undefined);
      this.notFound.set(true);
      return;
    }

    // Shared with the system view's object card, so the same body cannot read differently there.
    const viewModel = buildBodyViewModel(id, { bodies: this.bodies, exoplanets: this.exoplanets, stars: this.stars });
    if (!viewModel) {
      this.viewModel.set(undefined);
      this.notFound.set(true);
      return;
    }
    this.viewModel.set(viewModel);

    if (viewModel.hostStarId !== undefined) {
      this.navigationStore.selectStar(viewModel.hostStarId);
    }

    this.notFound.set(false);
    this.navigationStore.selectBody(id);
    if (this.sceneReady) {
      this.applyViewModelToScene();
    }
  }

  private applyViewModelToScene(): void {
    const viewModel = this.viewModel();
    if (!viewModel || !this.planetMaterial) {
      return;
    }

    // Real photography wherever it exists, and a surface derived from the body's own measured
    // properties wherever it does not — which is every exoplanet, since none has had its
    // surface imaged, and the handful of moons no probe returned a usable map of.
    const realTexturePath = bodyTexturePath(viewModel.id);
    this.planetMaterial.map = realTexturePath ? loadCachedTexture(realTexturePath) : planetTexture(viewModel.appearance);
    // The texture supplies its own colour, so the base stays white rather than tinting it twice.
    this.planetMaterial.color.set(0xffffff);
    // A fluid envelope scatters light more evenly than a solid surface does.
    this.planetMaterial.roughness = GAS_GIANT_IDS.has(viewModel.id) || viewModel.appearance.palette.structure === 'banded' ? 0.55 : 0.85;
    this.planetMaterial.needsUpdate = true;
    // Back to the page's own light and a sphere at rest; `tick` turns both where the IAU says how.
    this.body = this.bodies.find((body) => body.id === viewModel.id);
    this.planet?.rotation.set(0, 0, 0);
    this.sunLight?.position.copy(SUN_LIGHT_POSITION);
    this.sunSide = 0;

    this.disposeRing();
    this.disposeGlow();
    if (this.scene) {
      if (viewModel.id === 'saturn' && this.body) {
        // Flat in the page's horizontal, which is Saturn's equator: the planet is drawn pole up, at
        // unit radius. They used to reach 2.6 radii out; the outermost ring the texture draws is 2.42.
        this.ring = saturnRing(this.body.radiusKm, 1);
        this.scene.add(this.ring);
      }
      const atmosphereColor = atmosphereColorFor(viewModel.id);
      if (atmosphereColor !== undefined) {
        this.glow = createGlowSprite(atmosphereColor, GLOW_SCALE);
        this.scene.add(this.glow);
      }
    }
  }

  private disposeRing(): void {
    if (!this.ring) {
      return;
    }
    this.scene?.remove(this.ring);
    this.ring.geometry.dispose();
    (this.ring.material as THREE.Material).dispose();
    this.ring = undefined;
  }

  private disposeGlow(): void {
    if (!this.glow) {
      return;
    }
    this.scene?.remove(this.glow);
    (this.glow.material as THREE.SpriteMaterial).dispose();
    this.glow = undefined;
  }

  private async initScene(): Promise<void> {
    const canvas = this.canvasRef().nativeElement;

    try {
      await this.engine.init(canvas);
    } catch (error) {
      console.error('Failed to initialize the 3D engine.', error);
      return;
    }

    const scene = this.engine.getScene();
    this.scene = scene;
    applyMilkyWaySkybox(scene, MILKY_WAY_SKYBOX_PATH);

    const camera = this.engine.getCamera();
    camera.position.set(0, 0.6, 3);
    camera.near = 0.05;
    camera.far = 100;
    camera.updateProjectionMatrix();

    this.controls = new OrbitControls(camera, canvas);
    this.controls.enableDamping = true;
    this.controls.minDistance = 1.5;
    this.controls.maxDistance = 12;

    scene.add(new THREE.AmbientLight(0xffffff, 0.35));
    this.sunLight = new THREE.DirectionalLight(0xfff4e0, 1.6);
    this.sunLight.position.copy(SUN_LIGHT_POSITION);
    scene.add(this.sunLight);

    const geometry = new THREE.SphereGeometry(1, 64, 48);
    const viewModel = this.viewModel();
    this.planetMaterial = new THREE.MeshStandardMaterial({
      // White, always: the map that arrives a moment later carries the colour, whether it is a
      // photograph or a surface derived from the body's own measurements.
      color: 0xffffff,
      roughness: 0.85,
      metalness: 0.05
    });
    this.planet = new THREE.Mesh(geometry, this.planetMaterial);
    scene.add(this.planet);

    this.observeResize(canvas);
    this.unsubscribeTick = this.engine.onTick((deltaSeconds) => this.tick(deltaSeconds));
    this.engine.start();
  }

  /**
   * A body the IAU gives rotational elements for is turned as it is at the map's date, under its
   * real Sun, at the rate the map's clock runs (see `bodyPageView`). Eris, Haumea, Makemake and
   * Nereid, whose day is measured but whose pole is not, turn pole up at that day on the same
   * clock, as the system view turns them; Hyperion, which tumbles, is left still, as it is there.
   * An exoplanet turns slowly for show, as the page always turned it.
   */
  private tick(deltaSeconds: number): void {
    this.controls?.update();
    this.date.set(this.time.atNow() ? '' : this.time.date().toISOString().slice(0, 10));
    if (!this.planet || !this.sunLight) {
      return;
    }
    const sunAzimuth = Math.atan2(SUN_LIGHT_POSITION.x, SUN_LIGHT_POSITION.z);
    if (this.body && bodyPageView(this.body, this.bodies, this.time.julianDate(), sunAzimuth, this.planet.quaternion, this.sunLight.position)) {
      this.sunLight.position.multiplyScalar(SUN_LIGHT_POSITION.length());
    } else if (this.body?.rotationPeriodHours !== undefined) {
      // Counted from the orbit's epoch, as `spinFor` counts: where the meridian starts is unknown.
      const turns = ((this.time.julianDate() - this.body.orbit.epochJd) * 24) / this.body.rotationPeriodHours;
      this.planet.rotation.set(0, (turns % 1) * 2 * Math.PI, 0);
    } else if (!this.body) {
      this.planet.rotation.y += deltaSeconds * 0.08;
    }
    const sunSide = this.sunLight.position.y < 0 ? -1 : 1;
    if (sunSide !== this.sunSide) {
      // Above or below the equator, whichever side the Sun is on, when a body is shown and again
      // whenever the Sun crosses it, as the clock runs or is set: held above it, the page opened
      // Saturn on the unlit face of its rings from 2025 until 2039, while the Sun is south of them —
      // the face Earth does not see either — and the Clock set to 2045 left it on the other one.
      // Between crossings the camera is the reader's to orbit where they like.
      this.sunSide = sunSide;
      const camera = this.engine.getCamera();
      camera.position.y = Math.abs(camera.position.y) * sunSide;
      // Aimed again before this frame is drawn: the controls aimed it from where it was, and the
      // frame drawn from here otherwise had the body 22.6 degrees off the middle of the view.
      if (this.controls) {
        camera.lookAt(this.controls.target);
      }
    }
  }

  private observeResize(canvas: HTMLCanvasElement): void {
    this.resizeObserver = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      this.engine.resize(width, height);
    });
    this.resizeObserver.observe(canvas);
  }
}
