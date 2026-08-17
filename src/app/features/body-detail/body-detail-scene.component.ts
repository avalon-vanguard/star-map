import { AfterViewInit, Component, ElementRef, OnDestroy, signal, viewChild } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { Subscription } from 'rxjs';
import * as THREE from 'three/webgpu';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

import { DataLoaderService } from '../../core/data/data-loader.service';
import { EngineService } from '../../core/engine/engine.service';
import { planetTexture } from '../../shared/rendering/procedural-planet-texture';
import { applyMilkyWaySkybox, createGlowSprite } from '../../shared/rendering/skybox';
import { atmosphereColorFor, bodyTexturePath, loadCachedTexture, MILKY_WAY_SKYBOX_PATH, SATURN_RING_TEXTURE_PATH } from '../../shared/rendering/texture-catalog';
import { BodyRecord } from '../../shared/models/body.model';
import { ExoplanetRecord } from '../../shared/models/exoplanet.model';
import { StarRecord } from '../../shared/models/star.model';
import { NavigationStore } from '../../shared/state/navigation.store';
import { BodyDetailViewModel } from './body-detail.model';
import { buildBodyViewModel } from './body-view-model';
import { InfoPanelComponent } from './info-panel.component';

/** Gas giants read as smoother/less rocky than terrestrial bodies under the same lighting rig. */
const GAS_GIANT_IDS = new Set(['jupiter', 'saturn', 'uranus', 'neptune']);
/** The body is drawn at unit radius here, so the halo's extent is its multiple directly. */
const GLOW_SCALE = 2.6;

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
  imports: [InfoPanelComponent, RouterLink],
  template: `
    <div class="relative h-full w-full">
      <canvas #canvas data-testid="scene-canvas" class="block h-full w-full"></canvas>
      @if (viewModel()) {
        <app-info-panel [body]="viewModel()!" />
      } @else if (notFound()) {
        <div class="hud-brackets hud-acquire absolute top-20 right-4 w-80 max-w-[calc(100%-2rem)] border border-border/60 bg-panel/92 p-4 font-body text-text backdrop-blur-md sm:top-4">
          <p class="text-[10px] tracking-[0.18em] text-accent uppercase">No record</p>
          <p class="mt-2 text-sm text-muted">That id isn't in the catalog — it may have been renamed or mistyped.</p>
          <a
            routerLink="/"
            class="mt-4 inline-flex items-center gap-2 border border-border/60 px-3 py-1.5 text-[10px] tracking-[0.16em] text-muted uppercase transition-colors hover:border-accent/70 hover:text-accent focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            <svg class="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M15 6l-6 6 6 6" />
            </svg>
            Back to the galaxy
          </a>
        </div>
      }
    </div>
  `
})
export class BodyDetailSceneComponent implements AfterViewInit, OnDestroy {
  private readonly canvasRef = viewChild.required<ElementRef<HTMLCanvasElement>>('canvas');

  private controls?: OrbitControls;
  private scene?: THREE.Scene;
  private planet?: THREE.Mesh;
  private planetMaterial?: THREE.MeshStandardMaterial;
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

  constructor(
    private readonly engine: EngineService,
    private readonly dataLoader: DataLoaderService,
    private readonly route: ActivatedRoute,
    private readonly navigationStore: NavigationStore
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
    // properties wherever it does not — which is every exoplanet, since none has ever been
    // imaged, and the handful of moons no probe returned a usable map of.
    const realTexturePath = bodyTexturePath(viewModel.id);
    this.planetMaterial.map = realTexturePath ? loadCachedTexture(realTexturePath) : planetTexture(viewModel.appearance);
    // The texture supplies its own colour, so the base stays white rather than tinting it twice.
    this.planetMaterial.color.set(0xffffff);
    // A fluid envelope scatters light more evenly than a solid surface does.
    this.planetMaterial.roughness = GAS_GIANT_IDS.has(viewModel.id) || viewModel.appearance.palette.structure === 'banded' ? 0.55 : 0.85;
    this.planetMaterial.needsUpdate = true;

    this.disposeRing();
    this.disposeGlow();
    if (this.scene) {
      if (viewModel.id === 'saturn') {
        this.ring = this.buildSaturnRing();
        this.scene.add(this.ring);
      }
      const atmosphereColor = atmosphereColorFor(viewModel.id);
      if (atmosphereColor !== undefined) {
        this.glow = createGlowSprite(atmosphereColor, GLOW_SCALE);
        this.scene.add(this.glow);
      }
    }
  }

  /**
   * Saturn's rings, built from a real ring-transparency map. `RingGeometry`'s default UVs wrap
   * around the angle rather than the radius, so the per-vertex U is remapped to distance from
   * center — the standard fix for sampling a radially-varying ring texture correctly.
   */
  private buildSaturnRing(): THREE.Mesh {
    const geometry = new THREE.RingGeometry(1.4, 2.6, 128, 1);
    const position = geometry.attributes['position'];
    const uv = geometry.attributes['uv'];
    const vertex = new THREE.Vector3();
    for (let i = 0; i < position.count; i++) {
      vertex.fromBufferAttribute(position, i);
      const radialFraction = THREE.MathUtils.clamp((vertex.length() - 1.4) / (2.6 - 1.4), 0, 1);
      uv.setXY(i, radialFraction, 1);
    }

    const ringTexture = loadCachedTexture(SATURN_RING_TEXTURE_PATH);
    const material = new THREE.MeshBasicMaterial({
      map: ringTexture,
      alphaMap: ringTexture,
      transparent: true,
      opacity: 0.85,
      side: THREE.DoubleSide,
      depthWrite: false
    });

    const ring = new THREE.Mesh(geometry, material);
    ring.rotation.x = Math.PI / 2 - THREE.MathUtils.degToRad(17);
    return ring;
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
    const sunLight = new THREE.DirectionalLight(0xfff4e0, 1.6);
    sunLight.position.set(4, 3, 5);
    scene.add(sunLight);

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

  private tick(deltaSeconds: number): void {
    this.controls?.update();
    if (this.planet) {
      this.planet.rotation.y += deltaSeconds * 0.08;
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
