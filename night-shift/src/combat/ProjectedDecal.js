import * as THREE from 'three';
import { DecalGeometry } from 'three/examples/jsm/geometries/DecalGeometry.js';

const _zAxis = new THREE.Vector3(0, 0, 1);
const _quaternion = new THREE.Quaternion();
const _roll = new THREE.Quaternion();
const _euler = new THREE.Euler();
const _size = new THREE.Vector3();

export class ProjectedDecal {
  constructor(options = {}) {
    this.planeGeometry = options.planeGeometry ?? new THREE.PlaneGeometry(1, 1);
    this.offset = options.offset ?? 0.014;
  }

  apply(mesh, { point, normal, target, width, height, depth, rotation = 0, offset = this.offset }) {
    const projectionTarget = this._projectionTarget(target);
    if (projectionTarget) {
      try {
        const geometry = this._projectedGeometry(projectionTarget, point, normal, width, height, depth, rotation);
        if (geometry?.attributes?.position?.count > 0) {
          this._replaceGeometry(mesh, geometry);
          mesh.position.set(0, 0, 0);
          mesh.quaternion.identity();
          mesh.scale.set(1, 1, 1);
          mesh.userData.projectedDecal = true;
          return true;
        }
        geometry?.dispose?.();
      } catch {
        // Projection can fail on unusual or transient geometry. Use the safe plane fallback below.
      }
    }

    this._replaceGeometry(mesh, this.planeGeometry);
    mesh.position.copy(point).addScaledVector(normal, offset);
    mesh.quaternion.copy(this._orientation(normal, rotation));
    mesh.scale.set(width, height, 1);
    mesh.userData.projectedDecal = false;
    return false;
  }

  release(mesh) {
    this._replaceGeometry(mesh, this.planeGeometry);
    mesh.position.set(0, 0, 0);
    mesh.quaternion.identity();
    mesh.scale.set(1, 1, 1);
    mesh.userData.projectedDecal = false;
  }

  _projectedGeometry(target, point, normal, width, height, depth, rotation) {
    target.updateMatrixWorld(true);
    _size.set(width, height, depth);
    _euler.setFromQuaternion(this._orientation(normal, rotation), 'XYZ');
    return new DecalGeometry(target, point, _euler, _size);
  }

  _orientation(normal, rotation) {
    _quaternion.setFromUnitVectors(_zAxis, normal);
    _roll.setFromAxisAngle(normal, rotation);
    return _quaternion.premultiply(_roll);
  }

  _projectionTarget(target) {
    if (target?.isMesh && target.geometry?.attributes?.position) return target;
    if (target?.object?.isMesh && target.object.geometry?.attributes?.position) return target.object;
    return null;
  }

  _replaceGeometry(mesh, geometry) {
    if (mesh.geometry && mesh.geometry !== geometry && mesh.geometry !== this.planeGeometry) {
      mesh.geometry.dispose();
    }
    mesh.geometry = geometry;
  }
}
