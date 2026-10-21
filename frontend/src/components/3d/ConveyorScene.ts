import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { ConveyorConfiguration } from '../../types/conveyor';
import { ConveyorGenerator } from './ConveyorGenerator';
import { CADAssetLoader } from './cadAssetLoader';
import { CadLayoutResult, cadLayoutKey } from '../../services/cadLayoutService';

export type CameraPreset = 'isometric' | 'top' | 'front' | 'side' | 'perspective';
export interface CadStatus {
  /** 'exact' = the client's real CAD parts; 'generated' = approximation; 'loading' = waiting for the layout. */
  state: 'exact' | 'generated' | 'loading';
  reasons: string[];   // exact: options the client's CAD has no part for; generated: why the layout is unavailable
  legs?: number;
}

export type FocusTarget = 'overview' | 'drive' | 'supports' | 'chain' | 'infeed' | 'feet' | 'curves' | 'guides';

export class ConveyorScene {
  private container: HTMLElement;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private renderer: THREE.WebGLRenderer;
  private controls: OrbitControls;
  private conveyorGenerator: ConveyorGenerator;
  private currentConveyorGroup: THREE.Group | null = null;
  private cadEnvMap: THREE.Texture | null = null; // soft studio reflections, applied to CAD parts only
  private buildToken = 0; // invalidates in-flight async CAD builds when the configuration changes
  private cadResult: CadLayoutResult | null = null; // how the client's exact parts are arranged (from the backend)
  private cadGroup: THREE.Group | null = null;      // the exact CAD currently shown (kept until the next layout is ready)
  private cadStatusListener: ((status: CadStatus) => void) | null = null;
  private animationFrameId: number | null = null;
  private resizeObserver: ResizeObserver | null = null;

  // Visuals & Grid
  private gridHelper: THREE.GridHelper | null = null;
  private groundMesh: THREE.Mesh | null = null;
  private isWireframe: boolean = false;
  private isAutoRotating: boolean = false;
  private showDimensions: boolean = true;
  private showPathDebug: boolean = false;
  private showFlow: boolean = true;
  private showProducts: boolean = false;
  private clock: THREE.Clock = new THREE.Clock();
  private currentConfig: ConveyorConfiguration | null = null;
  private currentPreset: CameraPreset = 'isometric';
  private isInitialLoad: boolean = true;
  // The camera is framed once for the first model and once for the first client CAD model. After that it stays where
  // the user put it while the conveyor is customised (no re-zoom); "Fit View" and the view buttons still move it.
  private framedFirst = false;
  private framedCad = false;
  private autoFocus = false; // customisation controls no longer zoom the camera onto a component
  private currentFocusComponent: FocusTarget | null = null;

  // Theme & Lighting References
  private ambientLight!: THREE.AmbientLight;
  private keyLight!: THREE.DirectionalLight;
  private fillLight!: THREE.DirectionalLight;
  private rimLight!: THREE.DirectionalLight;
  private hemiLight!: THREE.HemisphereLight;
  private floorMat!: THREE.ShadowMaterial;
  private currentTheme: 'dark' | 'light' = 'dark';

  // Animation target for smooth camera transitions
  private targetCameraPos: THREE.Vector3 | null = null;
  private targetLookAt: THREE.Vector3 | null = null;

  constructor(container: HTMLElement, initialTheme: 'dark' | 'light' = 'dark') {
    this.container = container;
    this.currentTheme = initialTheme;
    this.conveyorGenerator = new ConveyorGenerator();

    const isDark = initialTheme === 'dark';
    const bgColor = isDark ? 0x121C27 : 0xE5E9ED;

    // 1. Setup Three.js Scene
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(bgColor);
    this.scene.fog = new THREE.FogExp2(bgColor, 0.00008);

    // 2. Setup Camera using actual container dimensions
    const width = Math.max(container.clientWidth || 800, 300);
    const height = Math.max(container.clientHeight || 500, 200);
    this.camera = new THREE.PerspectiveCamera(45, width / height, 10, 80000);
    this.camera.position.set(3000, 2000, 3000);

    // 3. Setup WebGL Renderer with High Quality
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: 'high-performance',
      alpha: false
    });
    this.renderer.setSize(width, height);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = isDark ? 1.15 : 1.05;

    container.innerHTML = '';
    container.appendChild(this.renderer.domElement);

    // 4. Setup OrbitControls
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.maxPolarAngle = Math.PI / 2 - 0.02; // Prevent going beneath floor
    this.controls.minDistance = 200;
    this.controls.maxDistance = 60000;
    this.controls.target.set(1500, 425, 0);

    // 5. Setup Studio CAD Lighting
    this.setupLighting();

    // 6. Setup Floor Grid & Ground Plane
    this.setupFloorGrid();

    // 7. Start Render Loop
    this.animate = this.animate.bind(this);
    this.animate();

    // 8. Setup Window and Container Resize Observers
    this.handleResize = this.handleResize.bind(this);
    window.addEventListener('resize', this.handleResize);

    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(() => {
        this.handleResize();
      });
      this.resizeObserver.observe(this.container);
    }
  }

  private setupLighting(): void {
    const isDark = this.currentTheme === 'dark';

    this.ambientLight = new THREE.AmbientLight(0xffffff, isDark ? 0.75 : 0.85);
    this.scene.add(this.ambientLight);

    this.keyLight = new THREE.DirectionalLight(0xffffff, isDark ? 1.45 : 1.35);
    this.keyLight.position.set(4000, 6000, 3000);
    this.keyLight.castShadow = true;
    this.keyLight.shadow.mapSize.width = 2048;
    this.keyLight.shadow.mapSize.height = 2048;
    this.keyLight.shadow.camera.near = 500;
    this.keyLight.shadow.camera.far = 30000;
    this.keyLight.shadow.camera.left = -10000;
    this.keyLight.shadow.camera.right = 10000;
    this.keyLight.shadow.camera.top = 10000;
    this.keyLight.shadow.camera.bottom = -10000;
    this.keyLight.shadow.bias = -0.0005;
    this.scene.add(this.keyLight);

    this.fillLight = new THREE.DirectionalLight(isDark ? 0xa0c4e2 : 0x8ba2b8, isDark ? 0.55 : 0.65);
    this.fillLight.position.set(-3000, 3000, -3000);
    this.scene.add(this.fillLight);

    this.rimLight = new THREE.DirectionalLight(isDark ? 0x56a4e8 : 0x64748b, isDark ? 0.45 : 0.35);
    this.rimLight.position.set(0, 2000, -4000);
    this.scene.add(this.rimLight);

    this.hemiLight = new THREE.HemisphereLight(
      isDark ? 0xe8f0f8 : 0xffffff,
      isDark ? 0x151f2b : 0xe5e9ed,
      0.4
    );
    this.scene.add(this.hemiLight);
  }

  private setupFloorGrid(): void {
    const isDark = this.currentTheme === 'dark';
    const gridSize = 50000;
    const gridDivisions = 100; // 500 mm major grid spacing

    const majorGrid = isDark ? 0x243546 : 0xC9D1D9;
    const minorGrid = isDark ? 0x162433 : 0xDCE2E7;

    this.gridHelper = new THREE.GridHelper(gridSize, gridDivisions, majorGrid, minorGrid);
    this.gridHelper.position.y = 0;
    this.scene.add(this.gridHelper);

    const floorGeom = new THREE.PlaneGeometry(gridSize, gridSize);
    this.floorMat = new THREE.ShadowMaterial({
      opacity: isDark ? 0.28 : 0.18
    });
    this.groundMesh = new THREE.Mesh(floorGeom, this.floorMat);
    this.groundMesh.rotation.x = -Math.PI / 2;
    this.groundMesh.position.y = -0.5;
    this.groundMesh.receiveShadow = true;
    this.scene.add(this.groundMesh);
  }

  public setTheme(theme: 'dark' | 'light'): void {
    if (this.currentTheme === theme) return;
    this.currentTheme = theme;
    const isDark = theme === 'dark';

    // 1. Scene Background & Fog
    const bgColor = isDark ? 0x121C27 : 0xE5E9ED;
    this.scene.background = new THREE.Color(bgColor);
    this.scene.fog = new THREE.FogExp2(bgColor, 0.00008);

    // 2. Floor Grid
    if (this.gridHelper) {
      this.scene.remove(this.gridHelper);
      this.gridHelper.geometry.dispose();
      (this.gridHelper.material as THREE.Material).dispose();
    }
    const gridSize = 50000;
    const gridDivisions = 100;
    const majorGrid = isDark ? 0x243546 : 0xCAD6E2;
    const minorGrid = isDark ? 0x162433 : 0xD5E1ED;
    this.gridHelper = new THREE.GridHelper(gridSize, gridDivisions, majorGrid, minorGrid);
    this.gridHelper.position.y = 0;
    this.scene.add(this.gridHelper);

    // 3. Ground Plane Shadow
    if (this.floorMat) {
      this.floorMat.opacity = isDark ? 0.28 : 0.18;
    }

    // 4. Studio CAD Lighting
    if (this.ambientLight) {
      this.ambientLight.intensity = isDark ? 0.75 : 0.85;
    }
    if (this.keyLight) {
      this.keyLight.intensity = isDark ? 1.45 : 1.35;
    }
    if (this.fillLight) {
      this.fillLight.color.setHex(isDark ? 0xa0c4e2 : 0x8ba2b8);
      this.fillLight.intensity = isDark ? 0.55 : 0.65;
    }
    if (this.rimLight) {
      this.rimLight.color.setHex(isDark ? 0x56a4e8 : 0x64748b);
      this.rimLight.intensity = isDark ? 0.45 : 0.35;
    }
    if (this.hemiLight) {
      this.hemiLight.color.setHex(isDark ? 0xe8f0f8 : 0xffffff);
      this.hemiLight.groundColor.setHex(isDark ? 0x151f2b : 0xe5e9ed);
    }
  }

  /**
   * Computes the bounding box of physical conveyor components, updating world matrices first.
   * Excludes dimension callout texts and debug lines to prevent artificial bounding distortion.
   */
  public getModelBoundingBox(): THREE.Box3 {
    const box = new THREE.Box3();
    if (!this.currentConveyorGroup) return box;

    // Ensure all world matrices across the sub-assembly hierarchy are up to date
    this.currentConveyorGroup.updateMatrixWorld(true);

    this.currentConveyorGroup.children.forEach((child) => {
      if (
        child.name === 'ConveyorDimensions' ||
        child.name === 'ConveyorPathDebug' ||
        child.name === 'ConveyorDemoProducts'
      ) {
        return;
      }
      box.expandByObject(child);
    });

    // Fallback if box is somehow empty
    if (box.isEmpty() && this.currentConfig) {
      const len = this.currentConfig.length || 3000;
      const w = this.currentConfig.width || 82.5;
      const h = this.currentConfig.workingHeight?.height || 850;
      box.min.set(0, 0, -w / 2);
      box.max.set(len, h, w / 2);
    }

    return box;
  }

  /**
   * Mathematically calculates the exact camera position and center target
   * by projecting all 8 bounding box corners against the camera frustum with an 18% safety margin.
   * This guarantees that NO corner of the conveyor (infeed, discharge, motor, feet, guides)
   * can ever be clipped on the left, right, top, or bottom of the viewport.
   */
  public calculateFitCamera(preset: CameraPreset = 'isometric'): { position: THREE.Vector3; target: THREE.Vector3 } {
    const bbox = this.getModelBoundingBox();
    const center = new THREE.Vector3();
    bbox.getCenter(center);

    // Get 8 bounding box corners in world space
    const corners = [
      new THREE.Vector3(bbox.min.x, bbox.min.y, bbox.min.z),
      new THREE.Vector3(bbox.min.x, bbox.min.y, bbox.max.z),
      new THREE.Vector3(bbox.min.x, bbox.max.y, bbox.min.z),
      new THREE.Vector3(bbox.min.x, bbox.max.y, bbox.max.z),
      new THREE.Vector3(bbox.max.x, bbox.min.y, bbox.min.z),
      new THREE.Vector3(bbox.max.x, bbox.min.y, bbox.max.z),
      new THREE.Vector3(bbox.max.x, bbox.max.y, bbox.min.z),
      new THREE.Vector3(bbox.max.x, bbox.max.y, bbox.max.z)
    ];

    // Actual canvas viewport dimensions & aspect ratio
    const width = Math.max(this.container.clientWidth || this.renderer.domElement.clientWidth || 800, 300);
    const height = Math.max(this.container.clientHeight || this.renderer.domElement.clientHeight || 500, 200);
    const aspect = width / height;

    const fovY = (this.camera.fov * Math.PI) / 180;
    const tanHalfFovY = Math.tan(fovY / 2);
    const tanHalfFovX = tanHalfFovY * aspect;

    // 8% safety margin so the conveyor comfortably occupies ~80-85% of viewport with crisp detail
    const safetyMargin = 0.08;
    const effectiveTanX = tanHalfFovX * (1 - safetyMargin);
    const effectiveTanY = tanHalfFovY * (1 - safetyMargin);

    // Determine unit direction vector from model center to camera
    let dir = new THREE.Vector3();
    let up = new THREE.Vector3(0, 1, 0);

    switch (preset) {
      case 'top':
        dir.set(0, 1, 0.0001).normalize();
        up.set(0, 0, -1);
        break;
      case 'front':
        dir.set(0, 0.15, 1).normalize();
        break;
      case 'side':
        dir.set(-1, 0.15, 0).normalize();
        break;
      case 'isometric':
      case 'perspective':
      default:
        // Balanced CAD isometric viewing angle:
        // Shows full conveyor length, track width, infeed, discharge, motor, legs, and guides
        dir.set(0.85, 0.65, 1.15).normalize();
        break;
    }

    // Build camera orthonormal coordinate basis:
    // w = forward vector from camera towards model center
    const w = dir.clone().negate();
    const right = new THREE.Vector3().crossVectors(w, up).normalize();
    const cameraUp = new THREE.Vector3().crossVectors(right, w).normalize();

    // Calculate required distance so that EVERY bounding box corner fits inside frustum
    let requiredDistance = 1400;

    for (const corner of corners) {
      const delta = corner.clone().sub(center);

      // Distance offset along camera view direction (positive if corner is closer to camera than center)
      const projCam = delta.dot(dir);

      // Lateral distance from center along camera right axis
      const projRight = Math.abs(delta.dot(right));

      // Vertical distance from center along camera up axis
      const projUp = Math.abs(delta.dot(cameraUp));

      const distForWidth = projCam + (projRight / effectiveTanX);
      const distForHeight = projCam + (projUp / effectiveTanY);

      requiredDistance = Math.max(requiredDistance, distForWidth, distForHeight);
    }

    const target = center.clone();
    const position = center.clone().add(dir.multiplyScalar(requiredDistance));

    return { position, target };
  }

  public focusComponent(component: FocusTarget): void {
    if (!this.currentConveyorGroup || !this.autoFocus) return;

    this.currentFocusComponent = component;

    if (component === 'overview') {
      this.fitToView(false);
      return;
    }

    const workingY = this.currentConfig?.workingHeight?.height || 850;
    const len = this.currentConfig?.length || 3000;
    const isNoSupport = this.currentConfig?.workingHeight?.type === 'without-support';

    let target = new THREE.Vector3();
    let camOffset = new THREE.Vector3(850, 450, 950);

    if (component === 'feet') {
      const supObj = this.currentConveyorGroup.getObjectByName('ConveyorSupports');
      if (!isNoSupport && supObj && supObj.children.length > 0) {
        const leg = supObj.children[0];
        const box = new THREE.Box3().setFromObject(leg);
        target.set((box.min.x + box.max.x) / 2, Math.max(workingY * 0.35, 120), (box.min.z + box.max.z) / 2);
        camOffset.set(850, 420, 950);
      } else {
        this.fitToView(false);
        return;
      }
    } else if (component === 'drive') {
      const driveObj = this.currentConveyorGroup.getObjectByName('ConveyorDriveUnit');
      if (driveObj) {
        const box = new THREE.Box3().setFromObject(driveObj);
        box.getCenter(target);
      } else {
        const isStart = this.currentConfig?.drivePosition?.startsWith('start');
        target.set(isStart ? 80 : len - 80, workingY, 0);
      }
      camOffset.set(850, 420, 900);
    } else if (component === 'supports') {
      const supObj = this.currentConveyorGroup.getObjectByName('ConveyorSupports');
      if (!isNoSupport && supObj && supObj.children.length > 0) {
        const midIdx = Math.floor(supObj.children.length / 2);
        const leg = supObj.children[midIdx] || supObj.children[0];
        const box = new THREE.Box3().setFromObject(leg);
        box.getCenter(target);
        camOffset.set(1050, 500, 1150);
      } else {
        this.fitToView(false);
        return;
      }
    } else if (component === 'curves') {
      const curveObj = this.currentConveyorGroup.getObjectByName('ConveyorCurveModules');
      if (curveObj) {
        const box = new THREE.Box3().setFromObject(curveObj);
        box.getCenter(target);
      } else {
        target.set(len * 0.5, workingY, 0);
      }
      camOffset.set(750, 1100, 1000);
    } else if (component === 'guides') {
      const guideObj = this.currentConveyorGroup.getObjectByName('ConveyorSideGuides');
      if (guideObj) {
        const box = new THREE.Box3().setFromObject(guideObj);
        target.set(box.min.x + 300, workingY + 60, (box.min.z + box.max.z) / 2);
      } else {
        target.set(len * 0.4, workingY + 60, 0);
      }
      camOffset.set(800, 420, 850);
    } else if (component === 'chain') {
      const chainObj = this.currentConveyorGroup.getObjectByName('ConveyorChain');
      if (chainObj) {
        new THREE.Box3().setFromObject(chainObj).getCenter(target);
      } else {
        target.set(len * 0.4, workingY + 30, 0);
      }
      camOffset.set(850, 480, 850);
    } else if (component === 'infeed') {
      target.set(40, workingY, 0);
      camOffset.set(-850, 420, 900);
    }

    this.targetLookAt = target;
    this.targetCameraPos = target.clone().add(camOffset);
  }

  public onCadStatus(listener: ((status: CadStatus) => void) | null): void {
    this.cadStatusListener = listener;
  }

  /** The backend's layout for the current configuration; applies the client's exact parts when it is ready. */
  public setCadLayout(result: CadLayoutResult | null): void {
    this.cadResult = result;
    if (result && this.currentConfig && cadLayoutKey(this.currentConfig) === result.key) {
      this.applyCadResult(result, ++this.buildToken);
    }
  }

  public updateConfiguration(config: ConveyorConfiguration): void {
    this.currentConfig = config;
    const token = ++this.buildToken;

    // 1. Clean up previous model (the exact CAD, if shown, is kept so the view does not flash while the new layout loads)
    const keepCad = this.cadGroup;
    if (keepCad?.parent) keepCad.parent.remove(keepCad);
    if (this.currentConveyorGroup) {
      this.conveyorGenerator.disposeGroup(this.currentConveyorGroup);
      this.scene.remove(this.currentConveyorGroup);
      this.currentConveyorGroup = null;
    }

    // 2. Generated model: always built, shown whenever the client's real parts cannot express the configuration
    this.currentConveyorGroup = this.conveyorGenerator.generateConveyor(config);
    this.scene.add(this.currentConveyorGroup);
    if (keepCad) {
      this.currentConveyorGroup.children.forEach((c) => { c.visible = false; });
      this.currentConveyorGroup.add(keepCad);
    }

    // 3. The client's exact parts, if the layout for this configuration is already known
    const key = cadLayoutKey(config);
    if (this.cadResult && this.cadResult.key === key) {
      this.applyCadResult(this.cadResult, token);
    } else if (!keepCad) {
      this.emitCadStatus({ state: 'loading', reasons: [] });
    }

    // 4. Apply wireframe state if enabled
    this.applyWireframeState();

    // 5. Apply dimension, debug, flow, and demo product visibility
    this.applyDimensionVisibility();
    this.applyPathDebugVisibility();
    this.conveyorGenerator.flowIndicatorGen.setVisible(this.showFlow);
    this.conveyorGenerator.productGen.setVisible(this.showProducts);

    // 6. Automatic Centering & Camera Framing
    this.reframeCamera(false);
  }

  private emitCadStatus(status: CadStatus): void {
    this.cadStatusListener?.(status);
  }

  private releaseCad(group: THREE.Group | null): void {
    if (!group) return;
    group.parent?.remove(group);
    (group.userData.dispose as (() => void) | undefined)?.();
  }

  private async applyCadResult(result: CadLayoutResult, token: number): Promise<void> {
    const root = this.currentConveyorGroup;
    if (!root) return;

    if (!result.exact || !result.layout) {
      // The client's parts cannot express this configuration: show the generated approximation.
      this.releaseCad(this.cadGroup);
      this.cadGroup = null;
      root.children.forEach((c) => { c.visible = true; });
      this.applyDimensionVisibility();
      this.applyPathDebugVisibility();
      this.emitCadStatus({ state: 'generated', reasons: result.reasons });
      this.reframeCamera(false);
      return;
    }

    let cad: THREE.Group;
    try {
      cad = await CADAssetLoader.getInstance().buildFromLayout(result.layout);
    } catch (err) {
      console.warn('Client CAD model unavailable, showing generated geometry instead.', err);
      this.releaseCad(this.cadGroup);
      this.cadGroup = null;
      root.children.forEach((c) => { c.visible = true; });
      this.emitCadStatus({ state: 'generated', reasons: ['client CAD model could not be loaded'] });
      return;
    }
    if (token !== this.buildToken || root !== this.currentConveyorGroup) {
      (cad.userData.dispose as (() => void) | undefined)?.();   // configuration changed while building
      return;
    }

    // Swap: drop the previous exact CAD and the generated geometry, show the new exact CAD
    this.releaseCad(this.cadGroup);
    [...root.children].forEach((child) => {
      this.conveyorGenerator.disposeGroup(child as THREE.Group);
      root.remove(child);
    });
    cad.name = 'ConveyorReferenceCAD';
    root.add(cad);
    this.cadGroup = cad;

    if (!this.cadEnvMap) {
      const pmrem = new THREE.PMREMGenerator(this.renderer);
      this.cadEnvMap = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
      pmrem.dispose();
    }
    cad.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).forEach((m) => {
        const std = m as THREE.MeshStandardMaterial;
        if (std.isMeshStandardMaterial) {
          std.envMap = this.cadEnvMap;
          std.envMapIntensity = 0.7;
          std.needsUpdate = true;
        }
      });
    });

    this.applyWireframeState();
    this.emitCadStatus({ state: 'exact', reasons: result.reasons, legs: result.layout.legs });
    this.reframeCamera(true);
  }

  private reframeCamera(forceSnap: boolean): void {
    // Keep the shadow map tight around the model (a fixed +-10 m area gives coarse shadows on small conveyors)
    const box = this.getModelBoundingBox();
    if (!box.isEmpty() && this.keyLight) {
      const centre = box.getCenter(new THREE.Vector3());
      const r = Math.max(1500, box.getSize(new THREE.Vector3()).length() * 0.75);
      const cam = this.keyLight.shadow.camera;
      cam.left = -r; cam.right = r; cam.top = r; cam.bottom = -r;
      cam.updateProjectionMatrix();
      this.keyLight.target.position.copy(centre);
      this.keyLight.position.copy(centre).add(new THREE.Vector3(4000, 6000, 3000));
      this.keyLight.target.updateMatrixWorld();
    }
    // Camera: frame the first model and the first client CAD model, then leave the view alone
    if (forceSnap ? this.framedCad : this.framedFirst) return;
    if (forceSnap) this.framedCad = true; else this.framedFirst = true;
    if (this.currentFocusComponent && this.currentFocusComponent !== 'overview') {
      this.focusComponent(this.currentFocusComponent);
    } else {
      const fit = this.calculateFitCamera(this.currentPreset);

      if (this.isInitialLoad || forceSnap) {
        // Immediate snap on initial page load so the conveyor is perfectly centered and framed with no clipping
        this.camera.position.copy(fit.position);
        this.controls.target.copy(fit.target);
        this.camera.lookAt(fit.target);
        this.controls.update();
        this.isInitialLoad = false;
      } else {
        // Smooth animated reframing when parameters change
        this.targetCameraPos = fit.position;
        this.targetLookAt = fit.target;
      }
    }
  }

  public fitToView(immediate: boolean = false): void {
    if (!this.currentConveyorGroup) return;

    this.currentFocusComponent = 'overview';
    const fit = this.calculateFitCamera(this.currentPreset);

    if (immediate) {
      this.camera.position.copy(fit.position);
      this.controls.target.copy(fit.target);
      this.camera.lookAt(fit.target);
      this.controls.update();
      this.targetCameraPos = null;
      this.targetLookAt = null;
    } else {
      this.targetCameraPos = fit.position;
      this.targetLookAt = fit.target;
    }
  }

  public setViewPreset(preset: CameraPreset): void {
    if (!this.currentConveyorGroup) return;

    this.currentPreset = preset;
    const fit = this.calculateFitCamera(preset);
    this.targetCameraPos = fit.position;
    this.targetLookAt = fit.target;
  }

  public toggleWireframe(): boolean {
    this.isWireframe = !this.isWireframe;
    this.applyWireframeState();
    return this.isWireframe;
  }

  public toggleAutoRotate(): boolean {
    this.isAutoRotating = !this.isAutoRotating;
    this.controls.autoRotate = this.isAutoRotating;
    this.controls.autoRotateSpeed = 1.5;
    return this.isAutoRotating;
  }

  public toggleDimensions(): boolean {
    this.showDimensions = !this.showDimensions;
    this.applyDimensionVisibility();
    return this.showDimensions;
  }

  public togglePathDebug(): boolean {
    this.showPathDebug = !this.showPathDebug;
    this.applyPathDebugVisibility();
    return this.showPathDebug;
  }

  public toggleFlow(): boolean {
    this.showFlow = !this.showFlow;
    this.conveyorGenerator.flowIndicatorGen.setVisible(this.showFlow);
    return this.showFlow;
  }

  public toggleProducts(): boolean {
    this.showProducts = !this.showProducts;
    this.conveyorGenerator.productGen.setVisible(this.showProducts);
    return this.showProducts;
  }

  private applyWireframeState(): void {
    if (!this.currentConveyorGroup) return;

    this.currentConveyorGroup.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        const mesh = child as THREE.Mesh;
        if (Array.isArray(mesh.material)) {
          mesh.material.forEach((m) => {
            if ('wireframe' in m) {
              (m as any).wireframe = this.isWireframe;
            }
          });
        } else if (mesh.material && 'wireframe' in mesh.material) {
          (mesh.material as any).wireframe = this.isWireframe;
        }
      }
    });
  }

  private applyDimensionVisibility(): void {
    if (!this.currentConveyorGroup) return;

    const dimObj = this.currentConveyorGroup.getObjectByName('ConveyorDimensions');
    if (dimObj) {
      dimObj.visible = this.showDimensions;
    }
  }

  private applyPathDebugVisibility(): void {
    if (!this.currentConveyorGroup) return;

    const debugObj = this.currentConveyorGroup.getObjectByName('ConveyorPathDebug');
    if (debugObj) {
      debugObj.visible = this.showPathDebug;
    }
  }

  private animate(): void {
    this.animationFrameId = requestAnimationFrame(this.animate);

    // Update real-time conveyor flow indicator & demo products animation
    const elapsed = this.clock.getElapsedTime();
    const travelDir = this.currentConfig?.travelDirection || 'forward';

    if (this.currentConveyorGroup && this.showFlow) {
      this.conveyorGenerator.flowIndicatorGen.update(elapsed, travelDir);
    }

    if (this.currentConveyorGroup && this.showProducts) {
      this.conveyorGenerator.productGen.update(elapsed, travelDir);
    }

    // Smooth camera transition if target is set
    if (this.targetCameraPos && this.targetLookAt) {
      this.camera.position.lerp(this.targetCameraPos, 0.12);
      this.controls.target.lerp(this.targetLookAt, 0.12);

      if (this.camera.position.distanceTo(this.targetCameraPos) < 4) {
        this.camera.position.copy(this.targetCameraPos);
        this.controls.target.copy(this.targetLookAt);
        this.targetCameraPos = null;
        this.targetLookAt = null;
      }
    }

    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }

  public handleResize(): void {
    if (!this.container || !this.renderer || !this.camera) return;

    const width = this.container.clientWidth;
    const height = this.container.clientHeight;

    if (width === 0 || height === 0) return;

    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
  }

  public dispose(): void {
    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
    }

    window.removeEventListener('resize', this.handleResize);

    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = null;
    }

    if (this.currentConveyorGroup) {
      this.conveyorGenerator.disposeGroup(this.currentConveyorGroup);
      this.scene.remove(this.currentConveyorGroup);
    }

    if (this.gridHelper) {
      this.scene.remove(this.gridHelper);
      this.gridHelper.geometry.dispose();
      (this.gridHelper.material as THREE.Material).dispose();
    }

    this.keyLight?.shadow.map?.dispose();
    this.keyLight?.dispose();

    if (this.groundMesh) {
      this.scene.remove(this.groundMesh);
      this.groundMesh.geometry.dispose();
      (this.groundMesh.material as THREE.Material).dispose();
    }

    this.releaseCad(this.cadGroup);
    this.cadGroup = null;
    this.cadEnvMap?.dispose();
    this.controls.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();

    if (this.renderer.domElement.parentElement) {
      this.renderer.domElement.parentElement.removeChild(this.renderer.domElement);
    }
  }
}
