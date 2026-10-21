import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { CadCut, CadLayout, CadWarp } from '../../services/cadLayoutService';

const MM = 0.001; // the converted GLB is in metres, layouts are in millimetres

/** Original (STEP) name of a node; three.js sanitises `node.name`, the loader keeps the original in userData. */
const nodeName = (o: THREE.Object3D): string => (o.userData?.name as string | undefined) ?? o.name;

export class CADAssetLoader {
  private static instance: CADAssetLoader;
  private loader: GLTFLoader;
  private basePromise: Promise<THREE.Object3D> | null = null;
  private prismPromise: Promise<THREE.Mesh[]> | null = null;

  private constructor() {
    this.loader = new GLTFLoader();
  }

  public static getInstance(): CADAssetLoader {
    if (!CADAssetLoader.instance) {
      CADAssetLoader.instance = new CADAssetLoader();
    }
    return CADAssetLoader.instance;
  }

  /** The assembly converted from the client's STEP (804-125.stp): every part, in the STEP's own frame. */
  private loadBase(): Promise<THREE.Object3D> {
    if (!this.basePromise) {
      this.basePromise = new Promise((resolve, reject) => {
        this.loader.load(
          '/aluflex_target_exact.glb',
          (gltf) => {
            const assembly = gltf.scene.children[0] ?? gltf.scene; // the "804-125" top-level node
            assembly.updateMatrixWorld(true);
            resolve(assembly);
          },
          undefined,
          (err) => {
            console.error('Failed to load target CAD model GLB:', err);
            this.basePromise = null;
            reject(err);
          }
        );
      });
    }
    return this.basePromise;
  }

  /** Straight prisms cut from the client's bent strips / guide rails (straight conveyors have no bend to carry them). */
  private loadPrisms(): Promise<THREE.Mesh[]> {
    if (!this.prismPromise) {
      this.prismPromise = new Promise((resolve, reject) => {
        this.loader.load(
          '/straight_bars.glb',
          (gltf) => {
            const meshes: THREE.Mesh[] = [];
            gltf.scene.traverse((o) => { if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh); });
            resolve(meshes);
          },
          undefined,
          (err) => { this.prismPromise = null; reject(err); }
        );
      });
    }
    return this.prismPromise;
  }

  /**
   * The client's exact parts arranged for `layout` (the same edits the STEP export applies).
   * Geometry that is not edited is shared with the cached asset and must not be disposed; edited geometry is
   * owned by the returned group and released through `group.userData.dispose()`.
   */
  public async buildFromLayout(layout: CadLayout): Promise<THREE.Group> {
    const base = await this.loadBase();
    const prisms = layout.clones.some((c) => c.prism !== undefined) ? await this.loadPrisms() : [];
    const assembly = base.clone(true);
    assembly.updateMatrixWorld(true);

    // Reference-pose world matrices, taken before any edit (layouts are expressed against them).
    const world0 = new Map<THREE.Object3D, THREE.Matrix4>();
    assembly.traverse((o) => world0.set(o, o.matrixWorld.clone()));

    const find = (path: string[]): THREE.Object3D | null => {
      let node: THREE.Object3D | undefined = assembly;
      for (const name of path) {
        node = node.children.find((c) => nodeName(c) === name);
        if (!node) return null;
      }
      return node;
    };

    const owned: THREE.BufferGeometry[] = [];
    const missing: string[] = [];

    // 1. stretch bars: every vertex beyond a cut plane is shifted (planes are in reference-world mm)
    const p = new THREE.Vector3();
    const shift = new THREE.Vector3();
    /** Give every mesh under `node` its own geometry with the cuts applied. `refWorld(mesh)` is the mesh's reference pose. */
    const warpTmp = new THREE.Vector3();
    const warpC = new THREE.Vector3();
    const warpD1 = new THREE.Vector3();
    const warpD2 = new THREE.Vector3();
    /** Displacement (mm) of a point (mm) under the chain-width warp; mirrors backend/app/step_width.py. */
    const warpDisplacement = (spec: CadWarp, pMm: THREE.Vector3, out: THREE.Vector3) => {
      warpC.set(...spec.c); warpD1.set(...spec.d1); warpD2.set(...spec.d2);
      warpTmp.copy(pMm).sub(warpC);
      const a = warpTmp.dot(warpD1);
      const b = warpTmp.dot(warpD2);
      const horizontal = Math.hypot(warpTmp.x, warpTmp.y);
      if (horizontal < 1) return out.set(0, 0, 0);            // on the bend axis: stays
      if (a <= 0) return out.copy(warpD2).multiplyScalar(spec.sigma * spec.h);
      if (b >= 0) return out.copy(warpD1).multiplyScalar(-spec.sigma * spec.h);
      warpTmp.z = 0;
      return out.copy(warpTmp).multiplyScalar((-spec.sigma * spec.h) / horizontal);
    };
    const stretchNode = (node: THREE.Object3D, cuts: CadCut[], refWorld: (m: THREE.Mesh) => THREE.Matrix4, warp?: CadWarp) => {
      const cutVecs = cuts.map((c) => ({ n: c.n, c: c.c, d: new THREE.Vector3(...c.d) }));
      const pMm = new THREE.Vector3();
      const wd = new THREE.Vector3();
      node.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh) return;
        const w0 = refWorld(mesh);
        const inv = w0.clone().invert();
        const geom = mesh.geometry.clone();
        const pos = geom.getAttribute('position');
        for (let i = 0; i < pos.count; i++) {
          p.fromBufferAttribute(pos, i).applyMatrix4(w0);
          shift.set(0, 0, 0);
          for (const c of cutVecs) {
            if ((p.x * c.n[0] + p.y * c.n[1] + p.z * c.n[2]) / MM > c.c) shift.add(c.d);
          }
          if (warp) {
            pMm.copy(p).multiplyScalar(1 / MM);
            shift.add(warpDisplacement(warp, pMm, wd));
          }
          if (shift.lengthSq() > 0) {
            p.addScaledVector(shift, MM).applyMatrix4(inv);
            pos.setXYZ(i, p.x, p.y, p.z);
          } else {
            pos.setXYZ(i, pos.getX(i), pos.getY(i), pos.getZ(i));
          }
        }
        pos.needsUpdate = true;
        geom.computeBoundingBox();
        geom.computeBoundingSphere();
        mesh.geometry = geom;
        owned.push(geom);
      });
    };
    // a part can have both a stretch and a width warp: apply them together (both are measured on the reference pose)
    const edits = new Map<string, { path: string[]; cuts: CadCut[]; warp?: CadWarp }>();
    for (const st of layout.stretches) {
      const key = st.path.join('');
      edits.set(key, { path: st.path, cuts: [...(edits.get(key)?.cuts ?? []), ...st.cuts], warp: edits.get(key)?.warp });
    }
    for (const wp of layout.warps ?? []) {
      const key = wp.path.join('');
      edits.set(key, { path: wp.path, cuts: edits.get(key)?.cuts ?? [], warp: wp.spec });
    }
    for (const ed of edits.values()) {
      const node = find(ed.path);
      if (!node) { missing.push(ed.path.join('/')); continue; }
      stretchNode(node, ed.cuts, (m) => world0.get(m)!, ed.warp);
    }

    // 2. rigid moves: local = parentWorld0^-1 * M * world0   (M is a 4x4 row-major matrix, translation in mm)
    const toMatrix = (m: number[]) => {
      const t = new THREE.Matrix4().set(m[0], m[1], m[2], m[3] * MM, m[4], m[5], m[6], m[7] * MM, m[8], m[9], m[10], m[11] * MM, m[12], m[13], m[14], m[15]);
      return t;
    };
    const place = (node: THREE.Object3D, m: number[], ref: THREE.Matrix4, parentWorld: THREE.Matrix4) => {
      const t = toMatrix(m);
      const local = parentWorld.clone().invert().multiply(t).multiply(ref);
      node.matrix.copy(local);
      node.matrix.decompose(node.position, node.quaternion, node.scale);
    };
    const parentW0 = (node: THREE.Object3D) => (node.parent ? world0.get(node.parent) : undefined) ?? new THREE.Matrix4();
    for (const mv of layout.moves) {
      const node = find(mv.path);
      if (!node) { missing.push(mv.path.join('/')); continue; }
      place(node, mv.matrix, world0.get(node)!, parentW0(node));
    }

    // 2b. parts inside an assembly (castors of the stands) that this layout leaves out: before the stands are copied
    for (const path of layout.hidden) {
      if (path.length < 2) continue;
      const node = find(path);
      if (node) node.parent?.remove(node);
    }

    // 3. repeated parts (stands, guide posts): copies of the already edited source, placed from its reference pose
    for (const cl of layout.clones) {
      const src = find([cl.source]);
      if (!src || !src.parent) { missing.push(cl.source); continue; }
      // bars carry their own stretch, so they are copied from the untouched model; stands are copied after the
      // height edits so they pick those up
      let pristine: THREE.Object3D | undefined = base;
      if (cl.cuts || cl.warp) {
        for (const name of [cl.source]) pristine = pristine?.children.find((c) => nodeName(c) === name);
      }
      const copy = ((cl.cuts || cl.warp) && pristine ? pristine : src).clone(true);
      copy.userData = { ...copy.userData, name: cl.name };
      if (cl.prism !== undefined) {
        // straight prism of the bar: same material, the prism's own geometry
        const prismGeometry = prisms[cl.prism].geometry.clone();
        owned.push(prismGeometry);
        copy.traverse((o) => { if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).geometry = prismGeometry; });
      }
      place(copy, cl.matrix, world0.get(src)!, parentW0(src));
      src.parent.add(copy);
      if (cl.cuts || cl.warp) {
        // the copy's meshes correspond one-to-one with the source's, so they share its reference poses
        const srcMeshes: THREE.Mesh[] = [];
        src.traverse((o) => { if ((o as THREE.Mesh).isMesh) srcMeshes.push(o as THREE.Mesh); });
        let k = 0;
        stretchNode(copy, cl.cuts ?? [], () => world0.get(srcMeshes[k++])!, cl.warp);
      }
    }

    // 4. reference parts this layout does not use
    for (const path of layout.hidden) {
      if (path.length > 1) continue;
      const node = find(path);
      if (node) node.parent?.remove(node);
    }

    if (missing.length) console.warn('CAD layout: parts not found in the model:', missing.slice(0, 8));

    // Same orientation the viewer has always used for this asset: STEP Z-up in mm -> viewer Y-up.
    const group = new THREE.Group();
    group.name = 'ConveyorRoot_TargetCADExact';
    assembly.scale.set(1000, 1000, 1000);
    assembly.rotation.x = Math.PI / 2;
    assembly.rotation.y = Math.PI;
    assembly.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (mesh.isMesh) {
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).forEach((m) => this.tuneMaterial(m));
      }
    });
    group.add(assembly);
    group.userData.sharedAsset = true;
    group.userData.dispose = () => owned.forEach((g) => g.dispose());
    group.updateMatrixWorld(true);

    // Castor wheels sit on the floor grid (Y = 0)
    const bbox = new THREE.Box3().setFromObject(group);
    if (bbox.min.y !== 0) assembly.position.y -= bbox.min.y;
    return group;
  }

  private tuneMaterial(mat: THREE.Material): void {
    if ((mat as THREE.MeshStandardMaterial).isMeshStandardMaterial) {
      const std = mat as THREE.MeshStandardMaterial;
      std.side = THREE.DoubleSide;
      // The STEP->GLB conversion carries only base colours, so glTF defaults make every part fully
      // metallic (and nearly black without reflections). Use satin-metal / plastic values that keep
      // the CAD colours (light aluminium, green guides, black plates) like the client's renders.
      const lum = (std.color.r + std.color.g + std.color.b) / 3;
      std.metalness = lum > 0.35 ? 0.35 : 0.1; // light parts = anodised aluminium, dark parts = plastic/steel
      std.roughness = lum > 0.35 ? 0.42 : 0.55;
    }
  }
}
