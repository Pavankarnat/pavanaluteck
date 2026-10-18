import * as THREE from 'three';
import { ConveyorConfiguration } from '../../types/conveyor';
import { ConveyorPath, getVisualWidth } from './pathMath';
import { FrameGenerator } from './FrameGenerator';
import { ChainGenerator } from './ChainGenerator';
import { DriveGenerator } from './DriveGenerator';
import { SupportGenerator } from './SupportGenerator';
import { SideGuideGenerator } from './SideGuideGenerator';
import { CurveGenerator } from './CurveGenerator';
import { FlowIndicatorGenerator } from './FlowIndicatorGenerator';
import { ProductGenerator } from './ProductGenerator';
import { ConveyorMaterials } from './materials';

export class ConveyorGenerator {
  private frameGen: FrameGenerator;
  private chainGen: ChainGenerator;
  private driveGen: DriveGenerator;
  private supportGen: SupportGenerator;
  private sideGuideGen: SideGuideGenerator;
  private curveGen: CurveGenerator;
  public flowIndicatorGen: FlowIndicatorGenerator;
  public productGen: ProductGenerator;
  private materials: ConveyorMaterials;

  constructor() {
    this.frameGen = new FrameGenerator();
    this.chainGen = new ChainGenerator();
    this.driveGen = new DriveGenerator();
    this.supportGen = new SupportGenerator();
    this.sideGuideGen = new SideGuideGenerator();
    this.curveGen = new CurveGenerator();
    this.flowIndicatorGen = new FlowIndicatorGenerator();
    this.productGen = new ProductGenerator();
    this.materials = ConveyorMaterials.getInstance();
  }

  public generateConveyor(config: ConveyorConfiguration): THREE.Group {
    const rootGroup = new THREE.Group();
    rootGroup.name = 'ConveyorRoot';

    // 1. Compute Path
    const path = new ConveyorPath(config);

    // 2. Generate Sub-assemblies
    const frameGroup = this.frameGen.generate(config, path);
    const chainGroup = this.chainGen.generate(config, path);
    const driveGroup = this.driveGen.generate(config, path);
    const supportGroup = this.supportGen.generate(config, path);
    const sideGuideGroup = this.sideGuideGen.generate(config, path);
    const curveGroup = this.curveGen.generate(config, path);
    const flowGroup = this.flowIndicatorGen.generate(config, path);
    const productGroup = this.productGen.generate(config, path);

    rootGroup.add(frameGroup);
    rootGroup.add(chainGroup);
    rootGroup.add(driveGroup);
    rootGroup.add(supportGroup);
    rootGroup.add(sideGuideGroup);
    rootGroup.add(curveGroup);
    rootGroup.add(flowGroup);
    rootGroup.add(productGroup);

    // 3. Add CAD Dimension Markings
    const dimensionsGroup = this.buildDimensionLines(config, path);
    dimensionsGroup.name = 'ConveyorDimensions';
    rootGroup.add(dimensionsGroup);

    // 4. Add Visual Path Debug Overlay
    const pathDebugGroup = this.buildPathDebug(path, config.workingHeight?.height || 850);
    pathDebugGroup.name = 'ConveyorPathDebug';
    pathDebugGroup.visible = false; // toggled by user in CAD toolbar
    rootGroup.add(pathDebugGroup);

    return rootGroup;
  }

  private buildDimensionLines(config: ConveyorConfiguration, path: ConveyorPath): THREE.Group {
    const dimGroup = new THREE.Group();

    const visualW = getVisualWidth(config.width);
    const workingY = config.workingHeight.enabled && config.workingHeight.type !== 'without-support'
      ? config.workingHeight.height
      : 850;

    // Dimension line along the track
    const dimY = workingY + 120;
    const linePts: THREE.Vector3[] = [];

    const numDimSteps = 24;
    for (let i = 0; i <= numDimSteps; i++) {
      const dist = (i / numDimSteps) * path.totalLength;
      const s = path.getSampleAtDistance(dist);
      const p = s.point.clone().add(s.leftNormal.clone().multiplyScalar(visualW / 2 + 50));
      p.y = dimY;
      linePts.push(p);
    }

    const lineGeom = new THREE.BufferGeometry().setFromPoints(linePts);
    const dimLine = new THREE.Line(lineGeom, this.materials.dimensionLine);
    dimGroup.add(dimLine);

    // Start and End Tick Marks
    const startTickPts = [
      linePts[0].clone().add(new THREE.Vector3(0, -15, 0)),
      linePts[0].clone().add(new THREE.Vector3(0, 15, 0))
    ];
    dimGroup.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(startTickPts), this.materials.dimensionLine));

    const endTickPts = [
      linePts[linePts.length - 1].clone().add(new THREE.Vector3(0, -15, 0)),
      linePts[linePts.length - 1].clone().add(new THREE.Vector3(0, 15, 0))
    ];
    dimGroup.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(endTickPts), this.materials.dimensionLine));

    return dimGroup;
  }

  private buildPathDebug(path: ConveyorPath, workingY: number): THREE.Group {
    const debugGroup = new THREE.Group();

    // 1. Centerline Line
    const centerPts = path.samples.map(s => new THREE.Vector3(s.point.x, workingY + 60, s.point.z));
    const centerGeom = new THREE.BufferGeometry().setFromPoints(centerPts);
    const centerLine = new THREE.Line(centerGeom, new THREE.LineBasicMaterial({ color: 0x00ff88, linewidth: 3 }));
    debugGroup.add(centerLine);

    // 2. Travel Direction Arrows every 400 mm
    const arrowGeom = new THREE.ConeGeometry(12, 35, 12);
    arrowGeom.rotateX(Math.PI / 2);
    const arrowMat = new THREE.MeshBasicMaterial({ color: 0x00e5ff });

    const numArrows = Math.max(3, Math.floor(path.totalLength / 400));
    for (let i = 0; i <= numArrows; i++) {
      const dist = (i / numArrows) * path.totalLength;
      const s = path.getSampleAtDistance(dist);
      const arrow = new THREE.Mesh(arrowGeom, arrowMat);
      arrow.position.set(s.point.x, workingY + 65, s.point.z);
      arrow.rotation.y = -s.heading;
      debugGroup.add(arrow);
    }

    // 3. Curve Centers & Radial Vectors
    path.segments.forEach((seg, idx) => {
      if (seg.type === 'curve') {
        const centerSphereGeom = new THREE.SphereGeometry(15, 12, 12);
        const centerSphere = new THREE.Mesh(centerSphereGeom, new THREE.MeshBasicMaterial({ color: 0xff0055 }));
        centerSphere.position.set(seg.center.x, workingY + 60, seg.center.z);
        debugGroup.add(centerSphere);

        // Radius lines from center to start and end
        const radiusStartPts = [
          new THREE.Vector3(seg.center.x, workingY + 60, seg.center.z),
          new THREE.Vector3(seg.startPoint.x, workingY + 60, seg.startPoint.z)
        ];
        const radiusEndPts = [
          new THREE.Vector3(seg.center.x, workingY + 60, seg.center.z),
          new THREE.Vector3(seg.endPoint.x, workingY + 60, seg.endPoint.z)
        ];

        const lineStart = new THREE.Line(
          new THREE.BufferGeometry().setFromPoints(radiusStartPts),
          new THREE.LineDashedMaterial({ color: 0xff0055, dashSize: 20, gapSize: 10 })
        );
        lineStart.computeLineDistances();
        debugGroup.add(lineStart);

        const lineEnd = new THREE.Line(
          new THREE.BufferGeometry().setFromPoints(radiusEndPts),
          new THREE.LineDashedMaterial({ color: 0xff0055, dashSize: 20, gapSize: 10 })
        );
        lineEnd.computeLineDistances();
        debugGroup.add(lineEnd);
      }
    });

    return debugGroup;
  }

  public disposeGroup(group: THREE.Group): void {
    const shared = this.materials.getSharedMaterials();
    group.traverse((obj) => {
      // CAD assets share geometry/materials with a cache; only the geometry they own is released.
      (obj.userData.dispose as (() => void) | undefined)?.();
      for (let p: THREE.Object3D | null = obj; p; p = p.parent) {
        if (p.userData.sharedAsset) return;
      }
      if ((obj as THREE.InstancedMesh).isInstancedMesh) {
        (obj as THREE.InstancedMesh).dispose();
      }
      if ((obj as THREE.Mesh).isMesh || (obj as THREE.Line).isLine) {
        const mesh = obj as THREE.Mesh;
        mesh.geometry?.dispose();
        const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        mats.forEach((m) => {
          if (m && !shared.has(m)) m.dispose();
        });
      }
    });
  }
}
