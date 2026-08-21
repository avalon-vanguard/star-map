import * as THREE from 'three/webgpu';

import { JumpLink } from '../../shared/astro/jump-links';

/** Faint, because there are tens of thousands of them and none is worth reading on its own. */
const LINK_OPACITY = 0.16;
/** The one route is the figure; the graph it is drawn on is the ground. */
const ROUTE_OPACITY = 0.9;
/**
 * How far the graph falls back while a route is up. Near the Sun the catalogue is dense enough
 * that the links are a solid haze, and a chain drawn through it would be one bright thread in a
 * bright cloud; stepping the ground down is what makes the figure a figure.
 */
const GROUND_WHILE_ROUTED = 0.4;

export interface LinkPoint {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/**
 * The jump-link graph, and one route through it.
 *
 * Both are line segments in the galaxy's parsec frame: the graph as a single buffer, because a
 * pair of vertices per link is the cheapest way to draw a hundred thousand of them, and the
 * route as a second, brighter one over the top. The route is a strip rather than a set of pairs
 * so a chain of hops reads as one continuous thing.
 */
export class JumpLinkRenderer {
  readonly object = new THREE.Group();

  private readonly linkMaterial: THREE.LineBasicMaterial;
  private readonly routeMaterial: THREE.LineBasicMaterial;
  private readonly links: THREE.LineSegments;
  private readonly route: THREE.Line;
  private strength = 1;
  private routed = false;

  constructor(accent: THREE.ColorRepresentation) {
    this.linkMaterial = new THREE.LineBasicMaterial({ color: accent, transparent: true, opacity: LINK_OPACITY, depthWrite: false });
    this.routeMaterial = new THREE.LineBasicMaterial({ color: accent, transparent: true, opacity: ROUTE_OPACITY, depthWrite: false });

    this.links = new THREE.LineSegments(new THREE.BufferGeometry(), this.linkMaterial);
    this.route = new THREE.Line(new THREE.BufferGeometry(), this.routeMaterial);
    // Both are rebuilt from scratch whenever they change, so their bounds are only ever right
    // by accident between rebuilds; culling on a stale sphere drops the graph mid-pan.
    this.links.frustumCulled = false;
    this.route.frustumCulled = false;
    this.object.add(this.links, this.route);
    this.setLinks([], () => undefined);
    this.setRoute([], () => undefined);
  }

  setLinks(links: readonly JumpLink[], positionOf: (starId: number) => LinkPoint | undefined): void {
    const vertices = new Float32Array(links.length * 6);
    let at = 0;
    for (const link of links) {
      const from = positionOf(link.from);
      const to = positionOf(link.to);
      if (!from || !to) {
        continue;
      }
      vertices.set([from.x, from.y, from.z, to.x, to.y, to.z], at);
      at += 6;
    }
    this.replaceGeometry(this.links, at === vertices.length ? vertices : vertices.subarray(0, at));
  }

  /** The chain to draw over the graph, departure first. Fewer than two stars draws nothing. */
  setRoute(starIds: readonly number[], positionOf: (starId: number) => LinkPoint | undefined): void {
    const points = starIds.map(positionOf).filter((point): point is LinkPoint => point !== undefined);
    this.routed = points.length >= 2;
    this.applyOpacity();
    const vertices = new Float32Array(points.length < 2 ? 0 : points.length * 3);
    points.forEach((point, i) => {
      if (vertices.length > 0) {
        vertices.set([point.x, point.y, point.z], i * 3);
      }
    });
    this.replaceGeometry(this.route, vertices);
  }

  /** Crossfaded with the local layer: from outside the Galaxy the graph is a smear. */
  setStrength(strength: number): void {
    this.strength = THREE.MathUtils.clamp(strength, 0, 1);
    this.applyOpacity();
    this.object.visible = this.strength > 0;
  }

  private applyOpacity(): void {
    this.linkMaterial.opacity = LINK_OPACITY * this.strength * (this.routed ? GROUND_WHILE_ROUTED : 1);
    this.routeMaterial.opacity = ROUTE_OPACITY * this.strength;
  }

  dispose(): void {
    this.links.geometry.dispose();
    this.route.geometry.dispose();
    this.linkMaterial.dispose();
    this.routeMaterial.dispose();
  }

  private replaceGeometry(target: THREE.LineSegments | THREE.Line, vertices: Float32Array): void {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
    const previous = target.geometry;
    target.geometry = geometry;
    previous.dispose();
  }
}
