import * as THREE from 'three';

/**
 * The 16-bit look: the 3D scene is drawn at low resolution, then a single
 * pass adds dark sprite-style outlines from the depth buffer and reduces the
 * colours to a limited palette with ordered dithering. The canvas itself is
 * low resolution and is scaled up with sharp pixels by CSS.
 */
export class PixelPipeline {
  /** Colour levels per channel after quantisation. */
  levels = 20;
  dither = 1;
  outline = 0.62;
  /** Depth step, in metres, that counts as an object edge; smaller for close-up views. */
  edgeDepth = 0.5;
  edgeSlope = 0.3;

  private target: THREE.WebGLRenderTarget;
  private readonly quadScene = new THREE.Scene();
  private readonly quadCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly material: THREE.ShaderMaterial;

  constructor(private readonly renderer: THREE.WebGLRenderer) {
    this.target = this.makeTarget(4, 4);
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        tColor: { value: this.target.texture },
        tDepth: { value: this.target.depthTexture },
        resolution: { value: new THREE.Vector2(4, 4) },
        near: { value: 1 },
        far: { value: 1000 },
        levels: { value: this.levels },
        dither: { value: this.dither },
        outline: { value: this.outline },
        edgeDepth: { value: this.edgeDepth },
        edgeSlope: { value: this.edgeSlope },
      },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = vec4(position.xy, 0.0, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        precision highp float;
        uniform sampler2D tColor;
        uniform sampler2D tDepth;
        uniform vec2 resolution;
        uniform float near;
        uniform float far;
        uniform float levels;
        uniform float dither;
        uniform float outline;
        uniform float edgeDepth;
        uniform float edgeSlope;
        varying vec2 vUv;

        float viewDepth(vec2 uv) {
          float z = texture2D(tDepth, uv).x * 2.0 - 1.0;
          return 2.0 * near * far / (far + near - z * (far - near));
        }

        float bayer4(vec2 p) {
          vec2 q = floor(mod(p, 4.0));
          float i = q.x + q.y * 4.0;
          // 4x4 ordered-dither matrix, row by row.
          if (i < 1.0) return 0.0;    if (i < 2.0) return 8.0;   if (i < 3.0) return 2.0;   if (i < 4.0) return 10.0;
          if (i < 5.0) return 12.0;   if (i < 6.0) return 4.0;   if (i < 7.0) return 14.0;  if (i < 8.0) return 6.0;
          if (i < 9.0) return 3.0;    if (i < 10.0) return 11.0; if (i < 11.0) return 1.0;  if (i < 12.0) return 9.0;
          if (i < 13.0) return 15.0;  if (i < 14.0) return 7.0;  if (i < 15.0) return 13.0; return 5.0;
        }

        void main() {
          vec2 px = 1.0 / resolution;
          vec3 col = texture2D(tColor, vUv).rgb;

          // Outline: this pixel is on an object and a neighbour is well behind it.
          float dc = viewDepth(vUv);
          float dl = viewDepth(vUv - vec2(px.x, 0.0));
          float dr = viewDepth(vUv + vec2(px.x, 0.0));
          float du = viewDepth(vUv + vec2(0.0, px.y));
          float dd = viewDepth(vUv - vec2(0.0, px.y));
          float behind = max(max(dl, dr), max(du, dd)) - dc;
          // Ignore the steady slope of the ground plane.
          float slope = abs(dl + dr - 2.0 * dc) + abs(du + dd - 2.0 * dc);
          float edge = step(edgeDepth, behind) * step(edgeSlope, slope);
          col *= 1.0 - outline * edge;

          // Linear to display, with a little extra punch.
          col = pow(clamp(col, 0.0, 1.0), vec3(1.0 / 2.2));
          float luma = dot(col, vec3(0.299, 0.587, 0.114));
          col = clamp(mix(vec3(luma), col, 1.18), 0.0, 1.0);

          // Limited palette with ordered dithering.
          float t = (bayer4(gl_FragCoord.xy) + 0.5) / 16.0 - 0.5;
          col = floor(col * levels + 0.5 + t * dither) / levels;
          gl_FragColor = vec4(col, 1.0);
        }`,
      depthTest: false,
      depthWrite: false,
    });
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material);
    quad.frustumCulled = false;
    this.quadScene.add(quad);
  }

  private makeTarget(w: number, h: number): THREE.WebGLRenderTarget {
    const depthTexture = new THREE.DepthTexture(w, h);
    depthTexture.type = THREE.UnsignedIntType;
    return new THREE.WebGLRenderTarget(w, h, {
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      type: THREE.HalfFloatType,
      depthTexture,
    });
  }

  dispose(): void {
    this.target.dispose();
    this.material.dispose();
  }

  setSize(w: number, h: number): void {
    this.target.dispose();
    this.target = this.makeTarget(w, h);
    this.material.uniforms.tColor.value = this.target.texture;
    this.material.uniforms.tDepth.value = this.target.depthTexture;
    this.material.uniforms.resolution.value.set(w, h);
  }

  render(scene: THREE.Scene, camera: THREE.PerspectiveCamera): void {
    const u = this.material.uniforms;
    u.near.value = camera.near;
    u.far.value = camera.far;
    u.levels.value = this.levels;
    u.dither.value = this.dither;
    u.outline.value = this.outline;
    u.edgeDepth.value = this.edgeDepth;
    u.edgeSlope.value = this.edgeSlope;
    this.renderer.setRenderTarget(this.target);
    this.renderer.render(scene, camera);
    this.renderer.setRenderTarget(null);
    this.renderer.render(this.quadScene, this.quadCamera);
  }
}
