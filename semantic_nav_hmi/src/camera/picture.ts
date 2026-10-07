/**
 * WebGL renderer for the camera picture.
 *
 * Draws the latest frame contain- or cover-fitted, with optional digital zoom. For the
 * simulation's orbit camera it can also re-project the frame from the view it was
 * rendered with to the view the operator is asking for, so the picture answers the
 * mouse at once while the real frames (~0.1 s behind) catch up:
 *  - the robot is an upright cylinder of its size at its position, so it keeps its shape;
 *  - other pixels whose ray meets the ground go through the ground plane — exact for it
 *    (ground the old frame could not see behind the robot borrows nearby ground);
 *  - the rest land on a distant wall around the robot (where buildings and trees usually
 *    are), which closes the ground off without a seam.
 * Other things standing up close bend a little while the gesture lasts, and edges the old
 * frame never saw are stretched and dimmed; every new frame shrinks the correction to what
 * is left, and it vanishes when the view settles.
 */

import { cameraBasis, type OrbitView } from './orbit';

export interface FrameRect {
  /** device px */
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface DrawOptions {
  /** fill the canvas (crop) instead of showing the whole frame (letterbox) */
  cover: boolean;
  /** digital zoom: factor and visible-window centre in normalised image coordinates */
  zoom: { z: number; cx: number; cy: number };
  /** re-project from the frame's view to the requested one; `robot` sizes the robot's cylinder */
  warp: { frame: OrbitView; now: OrbitView; robot: { radius: number; height: number } } | null;
}

const VERT = `
attribute vec2 aPos;
varying vec2 vPos;
void main() {
  vPos = vec2(aPos.x * 0.5 + 0.5, 0.5 - aPos.y * 0.5);
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

const FRAG = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
varying vec2 vPos;
uniform sampler2D uTex;
uniform vec4 uFrame;   // full image rect in canvas units (x, y, w, h)
uniform vec3 uZoom;    // digital zoom: factor, centre x, centre y
uniform float uWarp;
uniform vec3 uCPos; uniform vec3 uCFwd; uniform vec3 uCRight; uniform vec3 uCUp;  // requested view
uniform vec3 uFPos; uniform vec3 uFFwd; uniform vec3 uFRight; uniform vec3 uFUp;  // frame's view
uniform float uTanH;   // tan(horizontal fov / 2)
uniform float uAspect; // image width / height
uniform vec2 uRobot;   // robot cylinder radius and height (0: none)
uniform float uWall;   // radius of the background wall around the robot
uniform vec3 uBg;

// where the ray o + t d leaves the background wall (o inside it)
float hitWall(vec3 o, vec3 d) {
  float a = dot(d.xy, d.xy);
  if (a < 1e-9) return 1e9;
  float b = 2.0 * dot(o.xy, d.xy);
  float c = dot(o.xy, o.xy) - uWall * uWall;
  return (-b + sqrt(max(b * b - 4.0 * a * c, 0.0))) / (2.0 * a);
}

// first hit (t > 0) of the ray o + t d with the robot's cylinder, 1e9 if none
float hitRobot(vec3 o, vec3 d) {
  float r = uRobot.x;
  float h = uRobot.y;
  float best = 1e9;
  if (r <= 0.0) return best;
  float c = dot(o.xy, o.xy) - r * r;
  if (c > 0.0) {
    float a = dot(d.xy, d.xy);
    float b = 2.0 * dot(o.xy, d.xy);
    float disc = b * b - 4.0 * a * c;
    if (a > 1e-9 && disc >= 0.0) {
      float t = (-b - sqrt(disc)) / (2.0 * a);
      float z = o.z + t * d.z;
      if (t > 0.0 && z >= 0.0 && z <= h) best = t;
    }
  }
  if (o.z > h && d.z < -1e-6) {
    float t = (h - o.z) / d.z;
    vec2 p = o.xy + t * d.xy;
    if (t < best && dot(p, p) <= r * r) best = t;
  }
  return best;
}

void main() {
  vec2 a = (vPos - uFrame.xy) / uFrame.zw;
  vec2 uv;
  if (uWarp > 0.5) {
    // this pixel's ray in the requested view…
    vec3 d = uCFwd + (2.0 * a.x - 1.0) * uTanH * uCRight + (1.0 - 2.0 * a.y) * uTanH / uAspect * uCUp;
    // …meets the robot, the ground or the wall (nearest first): look that point up in the frame
    float tw = hitWall(uCPos, d);
    float tg = (d.z < -1e-5 && uCPos.z > 0.0) ? -uCPos.z / d.z : 1e9;
    if (tg > tw) tg = 1e9;
    float tr = hitRobot(uCPos, d);
    float t = min(min(tg, tr), tw);
    vec3 r = t < 1e9 ? uCPos + t * d - uFPos : d;
    float depth = dot(r, uFFwd);
    if (depth <= 1e-6) { gl_FragColor = vec4(uBg, 1.0); return; }
    uv = vec2((dot(r, uFRight) / depth / uTanH + 1.0) * 0.5, (1.0 - dot(r, uFUp) / depth * uAspect / uTanH) * 0.5);
    // ground the frame's camera could not see past the robot: borrow the ground that was on
    // screen here (the robot sat elsewhere), rather than paint a ghost of the robot
    if (tg < tr && hitRobot(uFPos, r) < 1.0) uv = a;
    vec3 col = texture2D(uTex, clamp(uv, 0.0, 1.0)).rgb;
    // edges the frame never saw: stretch the border, dimmed
    vec2 o = max(max(-uv, uv - 1.0), 0.0);
    gl_FragColor = vec4(col * (1.0 - 0.15 * smoothstep(0.0, 0.1, max(o.x, o.y))), 1.0);
    return;
  } else {
    uv = uZoom.yz + (a - 0.5) / uZoom.x;
    if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) { gl_FragColor = vec4(uBg, 1.0); return; }
  }
  gl_FragColor = vec4(texture2D(uTex, uv).rgb, 1.0);
}`;

const UNIFORMS = [
  'uTex', 'uFrame', 'uZoom', 'uWarp', 'uCPos', 'uCFwd', 'uCRight', 'uCUp', 'uFPos', 'uFFwd', 'uFRight', 'uFUp', 'uTanH', 'uAspect', 'uRobot', 'uWall', 'uBg',
] as const;

type Uniforms = Record<(typeof UNIFORMS)[number], WebGLUniformLocation | null>;

/** The stage background (#0a0a0a) */
const BG: [number, number, number] = [10 / 255, 10 / 255, 10 / 255];

export class Picture {
  private gl: WebGLRenderingContext;
  private prog: WebGLProgram | null = null;
  private tex: WebGLTexture | null = null;
  private u = {} as Uniforms;
  private size: { w: number; h: number } | null = null;
  private source: ImageBitmap | null = null;

  /**
   * null when hardware WebGL is not available — the caller falls back to a 2D canvas
   * (a software-rendered context would be slower than that)
   */
  static create(canvas: HTMLCanvasElement): Picture | null {
    try {
      const gl = canvas.getContext('webgl', {
        alpha: false,
        antialias: false,
        depth: false,
        preserveDrawingBuffer: true,
        failIfMajorPerformanceCaveat: true,
      });
      if (!gl) return null;
      const p = new Picture(gl);
      canvas.addEventListener('webglcontextlost', (e) => e.preventDefault());
      canvas.addEventListener('webglcontextrestored', () => p.init());
      return p.init() ? p : null;
    } catch {
      return null;
    }
  }

  private constructor(gl: WebGLRenderingContext) {
    this.gl = gl;
  }

  private init(): boolean {
    const gl = this.gl;
    const shader = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? 'shader');
      return s;
    };
    try {
      const prog = gl.createProgram()!;
      gl.attachShader(prog, shader(gl.VERTEX_SHADER, VERT));
      gl.attachShader(prog, shader(gl.FRAGMENT_SHADER, FRAG));
      gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog) ?? 'link');
      gl.useProgram(prog);
      this.prog = prog;
      for (const name of UNIFORMS) this.u[name] = gl.getUniformLocation(prog, name);

      const buf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
      const loc = gl.getAttribLocation(prog, 'aPos');
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

      this.tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, this.tex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.uniform1i(this.u.uTex, 0);
      if (this.source) {
        try {
          this.upload(this.source);
        } catch {
          this.size = null; // that frame is gone; the next one will do
        }
      }
      return true;
    } catch (e) {
      console.warn('[camera] WebGL unavailable, using 2D canvas', e);
      return false;
    }
  }

  get hasFrame(): boolean {
    return this.size !== null;
  }

  /** Make `bmp` the current frame (the caller keeps ownership). */
  upload(bmp: ImageBitmap): void {
    const gl = this.gl;
    this.source = bmp;
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, bmp);
    this.size = { w: bmp.width, h: bmp.height };
  }

  /** Free the GPU context now rather than at garbage collection (views remount on swap). */
  dispose(): void {
    this.gl.getExtension('WEBGL_lose_context')?.loseContext();
  }

  clear(): void {
    this.size = null;
    this.source = null;
    const gl = this.gl;
    gl.clearColor(BG[0], BG[1], BG[2], 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
  }

  /** Draw onto a canvas of `cw`×`ch` device px; returns where the full frame lies. */
  draw(cw: number, ch: number, o: DrawOptions): FrameRect | null {
    const gl = this.gl;
    if (!this.size || !this.prog || gl.isContextLost()) return null;
    const { w: bw, h: bh } = this.size;
    const scale = (o.cover ? Math.max : Math.min)(cw / bw, ch / bh);
    const rect = { w: bw * scale, h: bh * scale, x: 0, y: 0 };
    rect.x = (cw - rect.w) / 2;
    rect.y = (ch - rect.h) / 2;

    gl.viewport(0, 0, cw, ch);
    gl.uniform4f(this.u.uFrame, rect.x / cw, rect.y / ch, rect.w / cw, rect.h / ch);
    gl.uniform3f(this.u.uZoom, o.zoom.z, o.zoom.cx, o.zoom.cy);
    gl.uniform3f(this.u.uBg, BG[0], BG[1], BG[2]);
    gl.uniform1f(this.u.uWarp, o.warp ? 1 : 0);
    if (o.warp) {
      const c = cameraBasis(o.warp.now);
      const f = cameraBasis(o.warp.frame);
      const v3 = (loc: WebGLUniformLocation | null, p: { x: number; y: number; z: number }) => gl.uniform3f(loc, p.x, p.y, p.z);
      v3(this.u.uCPos, c.pos);
      v3(this.u.uCFwd, c.fwd);
      v3(this.u.uCRight, c.right);
      v3(this.u.uCUp, c.up);
      v3(this.u.uFPos, f.pos);
      v3(this.u.uFFwd, f.fwd);
      v3(this.u.uFRight, f.right);
      v3(this.u.uFUp, f.up);
      gl.uniform1f(this.u.uTanH, Math.tan(o.warp.now.horizontal_fov / 2));
      gl.uniform1f(this.u.uAspect, bw / bh);
      gl.uniform2f(this.u.uRobot, o.warp.robot.radius, o.warp.robot.height);
      // 15 m suits a street; always well outside both cameras
      gl.uniform1f(this.u.uWall, Math.max(15, 2 * Math.hypot(c.pos.x, c.pos.y), 2 * Math.hypot(f.pos.x, f.pos.y)));
    }
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    return rect;
  }
}
