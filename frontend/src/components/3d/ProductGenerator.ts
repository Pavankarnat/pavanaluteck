import * as THREE from 'three';
import { ConveyorConfiguration, TravelDirection } from '../../types/conveyor';
import { ConveyorPath, getVisualWidth } from './pathMath';

export class ProductGenerator {
  private rootGroup: THREE.Group;
  private productsGroup: THREE.Group;
  private productItems: { mesh: THREE.Group; baseOffset: number }[] = [];
  private path: ConveyorPath | null = null;
  private workingY: number = 850;
  private isVisible: boolean = false;
  private flowSpeedMmPerSec: number = 320;

  // Reusable Materials
  private boxCardboardMat: THREE.MeshStandardMaterial;
  private boxTapeMat: THREE.MeshStandardMaterial;
  private bottlePlasticMat: THREE.MeshStandardMaterial;
  private bottleCapMat: THREE.MeshStandardMaterial;
  private totePlasticMat: THREE.MeshStandardMaterial;

  constructor() {
    this.rootGroup = new THREE.Group();
    this.rootGroup.name = 'ConveyorDemoProducts';
    this.productsGroup = new THREE.Group();
    this.productsGroup.name = 'ProductItems';
    this.rootGroup.add(this.productsGroup);
    this.rootGroup.visible = false;

    // Materials
    this.boxCardboardMat = new THREE.MeshStandardMaterial({
      color: 0xc49a6c, // Kraft Cardboard Brown
      roughness: 0.85,
      metalness: 0.05,
      name: 'Cardboard_Kraft'
    });

    this.boxTapeMat = new THREE.MeshStandardMaterial({
      color: 0x9a7b56,
      roughness: 0.6,
      metalness: 0.1,
      name: 'Packing_Tape'
    });

    this.bottlePlasticMat = new THREE.MeshStandardMaterial({
      color: 0x0284c7, // Industrial Blue Plastic Bottle
      roughness: 0.3,
      metalness: 0.15,
      transparent: true,
      opacity: 0.85,
      name: 'Plastic_Bottle'
    });

    this.bottleCapMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.4,
      metalness: 0.1,
      name: 'Bottle_Cap'
    });

    this.totePlasticMat = new THREE.MeshStandardMaterial({
      color: 0x1e3a8a, // Navy Logistics Tote
      roughness: 0.4,
      metalness: 0.1,
      name: 'Logistics_Tote'
    });
  }

  public generate(config: ConveyorConfiguration, path: ConveyorPath): THREE.Group {
    this.path = path;
    this.productItems = [];
    this.productsGroup.clear();

    const visualW = getVisualWidth(config.width);
    this.workingY = config.workingHeight.enabled && config.workingHeight.type !== 'without-support'
      ? config.workingHeight.height
      : 850;

    const spacing = Math.max(500, Math.min(800, path.totalLength / Math.max(2, Math.floor(path.totalLength / 600))));
    const count = Math.max(2, Math.floor((path.totalLength - 300) / spacing));

    for (let i = 0; i < count; i++) {
      const baseOffset = 200 + i * spacing;
      const typeIndex = i % 3;
      let productMesh: THREE.Group;

      if (typeIndex === 0) {
        productMesh = this.createCardboardBox(visualW);
      } else if (typeIndex === 1) {
        productMesh = this.createBottlePack(visualW);
      } else {
        productMesh = this.createLogisticsTote(visualW);
      }

      const sample = path.getSampleAtDistance(baseOffset);
      productMesh.position.copy(sample.point);
      productMesh.position.y = this.workingY + 48;
      productMesh.rotation.y = -sample.heading;

      this.productsGroup.add(productMesh);
      this.productItems.push({ mesh: productMesh, baseOffset });
    }

    return this.rootGroup;
  }

  private createCardboardBox(visualW: number): THREE.Group {
    const group = new THREE.Group();
    const boxW = Math.min(visualW * 0.75, 75);
    const boxL = Math.min(visualW * 0.85, 90);
    const boxH = 55;

    const boxGeom = new THREE.BoxGeometry(boxL, boxH, boxW);
    const box = new THREE.Mesh(boxGeom, this.boxCardboardMat);
    box.position.y = boxH / 2;
    box.castShadow = true;
    box.receiveShadow = true;
    group.add(box);

    // Center packing tape strip
    const tapeGeom = new THREE.BoxGeometry(boxL + 0.5, 1, boxW * 0.25);
    const tape = new THREE.Mesh(tapeGeom, this.boxTapeMat);
    tape.position.y = boxH + 0.5;
    group.add(tape);

    return group;
  }

  private createBottlePack(visualW: number): THREE.Group {
    const group = new THREE.Group();
    const radius = Math.min(visualW * 0.16, 16);
    const height = 65;

    // 2x2 cluster of bottles
    const offsets = [
      { x: -radius * 1.1, z: -radius * 1.1 },
      { x: radius * 1.1, z: -radius * 1.1 },
      { x: -radius * 1.1, z: radius * 1.1 },
      { x: radius * 1.1, z: radius * 1.1 }
    ];

    const bodyGeom = new THREE.CylinderGeometry(radius, radius, height * 0.8, 16);
    const neckGeom = new THREE.CylinderGeometry(radius * 0.45, radius * 0.6, height * 0.2, 16);
    const capGeom = new THREE.CylinderGeometry(radius * 0.48, radius * 0.48, 6, 16);

    offsets.forEach((pos) => {
      const bottle = new THREE.Group();

      const body = new THREE.Mesh(bodyGeom, this.bottlePlasticMat);
      body.position.y = (height * 0.8) / 2;
      body.castShadow = true;
      bottle.add(body);

      const neck = new THREE.Mesh(neckGeom, this.bottlePlasticMat);
      neck.position.y = height * 0.8 + (height * 0.2) / 2;
      bottle.add(neck);

      const cap = new THREE.Mesh(capGeom, this.bottleCapMat);
      cap.position.y = height + 3;
      bottle.add(cap);

      bottle.position.set(pos.x, 0, pos.z);
      group.add(bottle);
    });

    return group;
  }

  private createLogisticsTote(visualW: number): THREE.Group {
    const group = new THREE.Group();
    const toteW = Math.min(visualW * 0.8, 80);
    const toteL = Math.min(visualW * 0.95, 100);
    const toteH = 45;

    const baseGeom = new THREE.BoxGeometry(toteL, toteH, toteW);
    const tote = new THREE.Mesh(baseGeom, this.totePlasticMat);
    tote.position.y = toteH / 2;
    tote.castShadow = true;
    tote.receiveShadow = true;
    group.add(tote);

    // Rim lip
    const rimGeom = new THREE.BoxGeometry(toteL + 4, 6, toteW + 4);
    const rim = new THREE.Mesh(rimGeom, this.totePlasticMat);
    rim.position.y = toteH - 3;
    group.add(rim);

    return group;
  }

  public update(elapsedSeconds: number, travelDirection: TravelDirection = 'forward'): void {
    if (!this.path || this.productItems.length === 0 || !this.isVisible) return;

    const totalLen = this.path.totalLength;
    if (totalLen <= 0) return;

    const isReverse = travelDirection === 'reverse';
    const dirSign = isReverse ? -1 : 1;
    const distanceShift = (elapsedSeconds * this.flowSpeedMmPerSec * dirSign) % totalLen;

    for (let i = 0; i < this.productItems.length; i++) {
      const item = this.productItems[i];
      let currentDist = (item.baseOffset + distanceShift) % totalLen;
      if (currentDist < 0) currentDist += totalLen;

      const sample = this.path.getSampleAtDistance(currentDist);

      item.mesh.position.copy(sample.point);
      item.mesh.position.y = this.workingY + 48;

      if (isReverse) {
        item.mesh.rotation.y = -sample.heading + Math.PI;
      } else {
        item.mesh.rotation.y = -sample.heading;
      }
    }
  }

  public setVisible(visible: boolean): void {
    this.isVisible = visible;
    this.rootGroup.visible = visible;
  }

  public getVisible(): boolean {
    return this.isVisible;
  }
}
