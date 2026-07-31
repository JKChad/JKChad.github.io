import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { concrete, emissiveTrim, glass, metal, paintedMetal } from '../rendering/Materials.js';

const FLOOR_Y = 0;

export class Room {
  constructor(scene, bus) {
    this.scene = scene;
    this.bus = bus;
    this.group = new THREE.Group();
    this.group.name = 'industrial security office';
    this.colliders = [];
    this.occluders = [];
    this.decalReceivers = [];

    const { width, depth, height } = CONFIG.room;
    this.width = width;
    this.depth = depth;
    this.height = height;

    this.materials = {
      floor: concrete({
        name: 'oil-dark concrete floor',
        color: 0x202428,
        roughness: 0.72,
        envMapIntensity: 0.35,
        repeat: [9, 7],
        seed: 4,
      }),
      ceiling: paintedMetal({
        name: 'smoke stained ceiling paint',
        color: 0x20272c,
        roughness: 0.78,
        metalness: 0.16,
        repeat: [7, 5],
        seed: 5,
      }),
      wall: paintedMetal({
        name: 'worn charcoal wall panels',
        color: 0x283139,
        roughness: 0.74,
        metalness: 0.22,
        repeat: [5, 3],
        seed: 6,
      }),
      darkWall: concrete({
        name: 'cold poured concrete wall',
        color: 0x1e2328,
        roughness: 0.9,
        repeat: [5, 3],
        seed: 7,
      }),
      steel: metal({
        name: 'oxidized blue steel',
        color: 0x46535a,
        roughness: 0.58,
        seed: 8,
      }),
      blackSteel: metal({
        name: 'blackened structural steel',
        color: 0x1a2024,
        roughness: 0.62,
        metalness: 0.7,
        seed: 10,
      }),
      desk: paintedMetal({
        name: 'scuffed desk enamel',
        color: 0x343b3b,
        roughness: 0.66,
        metalness: 0.42,
        repeat: [3, 2],
        seed: 12,
      }),
      crate: paintedMetal({
        name: 'worn olive storage crate',
        color: 0x3b3f34,
        roughness: 0.76,
        metalness: 0.28,
        repeat: [2, 2],
        seed: 16,
      }),
      amber: emissiveTrim({ name: 'amber emergency paint', color: 0xff9c39, intensity: 0.38 }),
      teal: emissiveTrim({ name: 'low teal status glass', color: 0x35d6cf, intensity: 0.26 }),
      glass: glass({ opacity: 0.28, roughness: 0.28 }),
    };

    scene.add(this.group);

    this._buildShell(width, depth, height);
    this._buildPillars(width, depth, height);
    this._buildSecurityDesks();
    this._buildServerCorner();
    this._buildCrates();
    this._buildDoorframe(width, depth, height);
    this._buildVents(width, depth, height);
    this._buildDetailTrim(width, depth);

    this.patrolPath = [
      new THREE.Vector3(-9.5, FLOOR_Y, -6.4),
      new THREE.Vector3(8.6, FLOOR_Y, -6.4),
      new THREE.Vector3(8.6, FLOOR_Y, 5.7),
      new THREE.Vector3(-9.5, FLOOR_Y, 5.7),
    ];
  }

  _box(name, size, position, material, options = {}) {
    const geometry = new THREE.BoxGeometry(size.x, size.y, size.z);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = name;
    mesh.position.copy(position);
    if (options.rotation) mesh.rotation.set(options.rotation.x ?? 0, options.rotation.y ?? 0, options.rotation.z ?? 0);
    mesh.castShadow = options.castShadow ?? true;
    mesh.receiveShadow = options.receiveShadow ?? true;

    if (options.receiveDecals) {
      mesh.userData.receiveDecals = true;
      this.decalReceivers.push(mesh);
    }
    if (options.reflectiveFloor) mesh.userData.reflectiveFloor = true;
    if (options.occluder) {
      mesh.userData.lightOccluder = true;
      this.occluders.push(mesh);
    }

    this.group.add(mesh);

    if (options.collider) {
      mesh.updateMatrixWorld(true);
      this.colliders.push(new THREE.Box3().setFromObject(mesh));
    }

    return mesh;
  }

  _buildShell(width, depth, height) {
    const wallT = 0.28;
    const halfW = width / 2;
    const halfD = depth / 2;

    this.floor = this._box(
      'slightly glossy scuffed concrete floor',
      new THREE.Vector3(width, 0.16, depth),
      new THREE.Vector3(0, -0.08, 0),
      this.materials.floor,
      { castShadow: false, receiveDecals: true, reflectiveFloor: true, collider: true }
    );

    this.ceiling = this._box(
      'low gridded metal ceiling',
      new THREE.Vector3(width, 0.18, depth),
      new THREE.Vector3(0, height + 0.09, 0),
      this.materials.ceiling,
      { castShadow: false, receiveShadow: true }
    );

    this._box(
      'left cold concrete wall',
      new THREE.Vector3(wallT, height, depth),
      new THREE.Vector3(-halfW - wallT / 2, height / 2, 0),
      this.materials.darkWall,
      { receiveDecals: true, collider: true, occluder: true }
    );
    this._box(
      'right service wall',
      new THREE.Vector3(wallT, height, depth),
      new THREE.Vector3(halfW + wallT / 2, height / 2, 0),
      this.materials.wall,
      { receiveDecals: true, collider: true, occluder: true }
    );
    this._box(
      'rear wall with cable stains',
      new THREE.Vector3(width, height, wallT),
      new THREE.Vector3(0, height / 2, -halfD - wallT / 2),
      this.materials.wall,
      { receiveDecals: true, collider: true, occluder: true }
    );

    const doorW = 3.35;
    const doorH = 2.55;
    const sideW = (width - doorW) / 2;
    this._box(
      'front wall left return',
      new THREE.Vector3(sideW, height, wallT),
      new THREE.Vector3(-doorW / 2 - sideW / 2, height / 2, halfD + wallT / 2),
      this.materials.darkWall,
      { receiveDecals: true, collider: true, occluder: true }
    );
    this._box(
      'front wall right return',
      new THREE.Vector3(sideW, height, wallT),
      new THREE.Vector3(doorW / 2 + sideW / 2, height / 2, halfD + wallT / 2),
      this.materials.darkWall,
      { receiveDecals: true, collider: true, occluder: true }
    );
    this._box(
      'front wall lintel',
      new THREE.Vector3(doorW, height - doorH, wallT),
      new THREE.Vector3(0, doorH + (height - doorH) / 2, halfD + wallT / 2),
      this.materials.darkWall,
      { receiveDecals: true, collider: true, occluder: true }
    );
  }

  _buildPillars(width, depth, height) {
    const positions = [
      [-width / 2 + 3.1, -depth / 2 + 3.2],
      [width / 2 - 3.1, -depth / 2 + 3.2],
      [-width / 2 + 3.1, depth / 2 - 3.6],
      [width / 2 - 3.1, depth / 2 - 3.6],
    ];

    for (const [x, z] of positions) {
      this._box(
        'blackened steel support pillar',
        new THREE.Vector3(0.62, height, 0.62),
        new THREE.Vector3(x, height / 2, z),
        this.materials.blackSteel,
        { receiveDecals: true, collider: true, occluder: true }
      );
      this._box(
        'amber impact collar',
        new THREE.Vector3(0.7, 0.12, 0.7),
        new THREE.Vector3(x, 0.94, z),
        this.materials.amber,
        { castShadow: false, receiveShadow: false }
      );
    }
  }

  _buildSecurityDesks() {
    const deskY = 0.72;
    const topThickness = 0.16;
    const desktop = (name, x, z, sx, sz) => {
      this._box(
        name,
        new THREE.Vector3(sx, topThickness, sz),
        new THREE.Vector3(x, deskY, z),
        this.materials.desk,
        { receiveDecals: true, collider: true, occluder: true }
      );
      for (const lx of [-sx / 2 + 0.24, sx / 2 - 0.24]) {
        for (const lz of [-sz / 2 + 0.24, sz / 2 - 0.24]) {
          this._box(
            `${name} tubular leg`,
            new THREE.Vector3(0.12, deskY, 0.12),
            new THREE.Vector3(x + lx, deskY / 2 - 0.02, z + lz),
            this.materials.blackSteel,
            { collider: false, occluder: false }
          );
        }
      }
    };

    desktop('main security desk slab', -2.2, -0.4, 5.8, 1.55);
    desktop('server side workbench', 4.0, 2.2, 4.4, 1.45);
    desktop('archive side table', -5.8, 3.0, 2.5, 1.25);

    const monitorMat = this.materials.blackSteel;
    const screenGlass = this.materials.glass;
    const screens = [
      [-3.6, 0.14, -0.9],
      [-2.1, 0.02, -1.0],
      [3.45, -0.18, 1.62],
      [4.75, 0.12, 1.74],
    ];

    for (const [x, yaw, z] of screens) {
      this._box(
        'dead security monitor housing',
        new THREE.Vector3(0.76, 0.48, 0.08),
        new THREE.Vector3(x, 1.08, z),
        monitorMat,
        { rotation: new THREE.Vector3(0, yaw, 0), receiveDecals: true }
      );
      this._box(
        'cold smoked monitor glass',
        new THREE.Vector3(0.66, 0.36, 0.025),
        new THREE.Vector3(x, 1.09, z - 0.05),
        screenGlass,
        { rotation: new THREE.Vector3(0, yaw, 0), castShadow: false }
      );
    }

    this._box(
      'thin teal access strip',
      new THREE.Vector3(1.3, 0.035, 0.035),
      new THREE.Vector3(4.0, 0.84, 1.45),
      this.materials.teal,
      { castShadow: false, receiveShadow: false }
    );
  }

  _buildServerCorner() {
    const rackMat = this.materials.blackSteel;
    const ventMat = this.materials.steel;
    const panelMat = paintedMetal({
      name: 'server rack charcoal panels',
      color: 0x222b31,
      roughness: 0.64,
      metalness: 0.48,
      repeat: [2, 4],
      seed: 31,
    });

    for (let i = 0; i < 4; i++) {
      const z = -6.3 + i * 1.15;
      this._box(
        'server rack body',
        new THREE.Vector3(1.05, 2.45, 0.9),
        new THREE.Vector3(12.35, 1.225, z),
        rackMat,
        { receiveDecals: true, collider: true, occluder: true }
      );
      this._box(
        'server rack removable panel',
        new THREE.Vector3(0.06, 1.88, 0.66),
        new THREE.Vector3(11.79, 1.26, z),
        panelMat,
        { receiveDecals: true }
      );
      for (let s = 0; s < 4; s++) {
        this._box(
          'thin rack vent slots',
          new THREE.Vector3(0.065, 0.035, 0.46),
          new THREE.Vector3(11.75, 0.56 + s * 0.34, z),
          ventMat,
          { castShadow: false }
        );
      }
    }
  }

  _buildCrates() {
    const crates = [
      [-10.8, 0.45, 7.2, 1.4, 0.9, 1.05],
      [-9.55, 0.33, 7.95, 1.15, 0.66, 0.9],
      [-11.2, 1.16, 7.38, 0.95, 0.58, 0.8],
      [9.8, 0.4, 7.7, 1.55, 0.8, 1.0],
      [10.85, 0.95, 7.4, 0.8, 0.7, 0.82],
      [8.1, 0.32, -8.3, 1.35, 0.64, 1.0],
    ];

    for (const [x, y, z, sx, sy, sz] of crates) {
      this._box(
        'dented olive storage crate',
        new THREE.Vector3(sx, sy, sz),
        new THREE.Vector3(x, y, z),
        this.materials.crate,
        { receiveDecals: true, collider: true, occluder: true }
      );
      this._box(
        'crate oxidized steel latch',
        new THREE.Vector3(sx * 0.42, 0.05, 0.045),
        new THREE.Vector3(x, y + sy * 0.18, z - sz / 2 - 0.025),
        this.materials.steel,
        { castShadow: false }
      );
    }
  }

  _buildDoorframe(width, depth, height) {
    const halfD = depth / 2;
    const frameZ = halfD - 0.05;
    const doorMat = metal({
      name: 'sealed blast door oxidized plate',
      color: 0x2c3438,
      roughness: 0.49,
      metalness: 0.72,
      repeat: [2, 3],
      seed: 40,
    });

    this._box(
      'closed service door slab',
      new THREE.Vector3(2.72, 2.34, 0.16),
      new THREE.Vector3(0, 1.17, frameZ + 0.1),
      doorMat,
      { receiveDecals: true, collider: true, occluder: true }
    );
    this._box(
      'left heavy door jamb',
      new THREE.Vector3(0.28, 2.68, 0.36),
      new THREE.Vector3(-1.62, 1.34, frameZ),
      this.materials.blackSteel,
      { collider: true, occluder: true }
    );
    this._box(
      'right heavy door jamb',
      new THREE.Vector3(0.28, 2.68, 0.36),
      new THREE.Vector3(1.62, 1.34, frameZ),
      this.materials.blackSteel,
      { collider: true, occluder: true }
    );
    this._box(
      'top heavy door lintel',
      new THREE.Vector3(3.52, 0.28, 0.36),
      new THREE.Vector3(0, 2.68, frameZ),
      this.materials.blackSteel,
      { collider: true, occluder: true }
    );
    this._box(
      'door amber emergency stripe',
      new THREE.Vector3(2.25, 0.045, 0.035),
      new THREE.Vector3(0, 1.7, frameZ - 0.095),
      this.materials.amber,
      { castShadow: false, receiveShadow: false }
    );

    this._box(
      'back wall amber wayfinding stripe',
      new THREE.Vector3(width - 3.0, 0.04, 0.035),
      new THREE.Vector3(0, 1.02, -depth / 2 + 0.145),
      this.materials.amber,
      { castShadow: false, receiveShadow: false }
    );
  }

  _buildVents(width, depth, height) {
    const ventMat = this.materials.steel;
    const positions = [
      [-width / 2 + 0.18, 2.72, -4.7, Math.PI / 2],
      [width / 2 - 0.18, 2.42, 5.3, -Math.PI / 2],
      [-5.5, height - 0.08, depth / 2 - 4.2, 0],
    ];

    for (const [x, y, z, yaw] of positions) {
      this._box(
        'oxidized service vent frame',
        new THREE.Vector3(0.08, 0.72, 1.55),
        new THREE.Vector3(x, y, z),
        ventMat,
        { rotation: new THREE.Vector3(0, yaw, 0), receiveDecals: true }
      );
      for (let i = 0; i < 5; i++) {
        this._box(
          'thin vent baffle',
          new THREE.Vector3(0.1, 0.045, 1.2),
          new THREE.Vector3(x, y - 0.26 + i * 0.13, z),
          this.materials.blackSteel,
          { rotation: new THREE.Vector3(0, yaw, 0), castShadow: false }
        );
      }
    }
  }

  _buildDetailTrim(width, depth) {
    const cableMat = this.materials.blackSteel;
    const z = -depth / 2 + 0.22;
    for (let i = 0; i < 5; i++) {
      this._box(
        'rear wall cable run',
        new THREE.Vector3(width - 3.4, 0.055, 0.05),
        new THREE.Vector3(0.15, 2.2 + i * 0.12, z),
        cableMat,
        { castShadow: false, receiveShadow: true }
      );
    }

    this._box(
      'floor drain grate',
      new THREE.Vector3(2.4, 0.035, 0.7),
      new THREE.Vector3(-6.5, 0.012, -6.0),
      this.materials.steel,
      { castShadow: false, receiveDecals: true }
    );
    for (let i = 0; i < 7; i++) {
      this._box(
        'floor drain dark slot',
        new THREE.Vector3(0.06, 0.04, 0.62),
        new THREE.Vector3(-7.35 + i * 0.28, 0.04, -6.0),
        cableMat,
        { castShadow: false }
      );
    }
  }
}
