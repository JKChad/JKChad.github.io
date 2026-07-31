import * as THREE from 'three';
import { BlendFunction, Effect } from 'postprocessing';

const fragmentShader = /* glsl */ `
uniform float time;
uniform float intensity;
uniform float tealLift;
uniform float redPush;
uniform float contrast;
uniform vec2 resolution;

float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  vec3 color = inputColor.rgb;
  float luma = dot(color, vec3(0.2126, 0.7152, 0.0722));
  vec2 pixel = uv * max(resolution, vec2(1.0));

  float grain = hash(pixel + time * 71.13) - 0.5;
  float shadowWeight = 1.0 - smoothstep(0.08, 0.78, luma);
  color += grain * intensity * (0.58 + shadowWeight * 0.75);

  color = (color - 0.5) * contrast + 0.5;

  vec3 teal = vec3(-0.014, 0.026, 0.035) * tealLift * (0.35 + shadowWeight);
  color += teal;

  float edge = smoothstep(0.36, 0.84, distance(uv, vec2(0.5)) * 1.42);
  color += vec3(0.105, -0.026, -0.042) * redPush * edge;

  outputColor = vec4(max(color, vec3(0.0)), inputColor.a);
}
`;

export class FilmGrainEffect extends Effect {
  constructor(options = {}) {
    super('NightShiftFilmGrain', fragmentShader, {
      blendFunction: BlendFunction.NORMAL,
      uniforms: new Map([
        ['time', new THREE.Uniform(0)],
        ['intensity', new THREE.Uniform(options.intensity ?? 0.027)],
        ['tealLift', new THREE.Uniform(options.tealLift ?? 0)],
        ['redPush', new THREE.Uniform(options.redPush ?? 0)],
        ['contrast', new THREE.Uniform(options.contrast ?? 1.045)],
        ['resolution', new THREE.Uniform(new THREE.Vector2(1, 1))],
      ]),
    });
  }

  set intensity(value) {
    this.uniforms.get('intensity').value = value;
  }

  get intensity() {
    return this.uniforms.get('intensity').value;
  }

  set tealLift(value) {
    this.uniforms.get('tealLift').value = value;
  }

  get tealLift() {
    return this.uniforms.get('tealLift').value;
  }

  set redPush(value) {
    this.uniforms.get('redPush').value = value;
  }

  get redPush() {
    return this.uniforms.get('redPush').value;
  }

  set contrast(value) {
    this.uniforms.get('contrast').value = value;
  }

  get contrast() {
    return this.uniforms.get('contrast').value;
  }

  update(renderer, inputBuffer, deltaTime = 0) {
    this.uniforms.get('time').value += deltaTime;
  }

  setSize(width, height) {
    this.uniforms.get('resolution').value.set(width, height);
  }
}

export { FilmGrainEffect as FilmGrainPass };
