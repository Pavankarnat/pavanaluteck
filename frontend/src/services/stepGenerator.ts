import { ConveyorConfiguration } from '../types/conveyor';
import { ConveyorPath, PathSample } from '../components/3d/pathMath';

export class StepVector3 {
  constructor(public x: number = 0, public y: number = 0, public z: number = 0) {}

  clone(): StepVector3 {
    return new StepVector3(this.x, this.y, this.z);
  }

  add(v: StepVector3): this {
    this.x += v.x;
    this.y += v.y;
    this.z += v.z;
    return this;
  }

  multiplyScalar(s: number): this {
    this.x *= s;
    this.y *= s;
    this.z *= s;
    return this;
  }

  length(): number {
    return Math.sqrt(this.x * this.x + this.y * this.y + this.z * this.z);
  }

  normalize(): this {
    const len = this.length();
    if (len > 1e-9) {
      this.x /= len;
      this.y /= len;
      this.z /= len;
    }
    return this;
  }

  cross(v: StepVector3): StepVector3 {
    return new StepVector3(
      this.y * v.z - this.z * v.y,
      this.z * v.x - this.x * v.z,
      this.x * v.y - this.y * v.x
    );
  }
}

export class StepFileGenerator {
  private name: string;
  private data: string[] = [];
  private pointCache: Map<string, string> = new Map();
  private dirCache: Map<string, string> = new Map();
  private colorStyleCache: Map<string, string> = new Map();
  public styledItems: string[] = [];

  constructor(name: string = 'ALUFLEX_CONVEYOR') {
    this.name = name;
  }

  private addEntity(rhs: string): string {
    const lhs = `#${this.data.length + 1}`;
    this.data.push(`${lhs}=${rhs};`);
    return lhs;
  }

  public addCartesianPoint(x: number, y: number, z: number): string {
    const rx = Number(x.toFixed(4));
    const ry = Number(y.toFixed(4));
    const rz = Number(z.toFixed(4));
    const key = `${rx}_${ry}_${rz}`;
    if (this.pointCache.has(key)) {
      return this.pointCache.get(key)!;
    }
    const pid = this.addEntity(`CARTESIAN_POINT('',(${rx.toFixed(4)},${ry.toFixed(4)},${rz.toFixed(4)}))`);
    this.pointCache.set(key, pid);
    return pid;
  }

  public addVertexPoint(cartesianPoint: string): string {
    return this.addEntity(`VERTEX_POINT('',${cartesianPoint})`);
  }

  public addDirection(x: number, y: number, z: number): string {
    const len = Math.sqrt(x * x + y * y + z * z);
    const nx = len > 1e-9 ? x / len : x;
    const ny = len > 1e-9 ? y / len : y;
    const nz = len > 1e-9 ? z / len : z;
    const key = `${nx.toFixed(6)}_${ny.toFixed(6)}_${nz.toFixed(6)}`;
    if (this.dirCache.has(key)) {
      return this.dirCache.get(key)!;
    }
    const did = this.addEntity(`DIRECTION('',(${nx.toFixed(6)},${ny.toFixed(6)},${nz.toFixed(6)}))`);
    this.dirCache.set(key, did);
    return did;
  }

  public addVector(direction: string, magnitude: number = 1.0): string {
    return this.addEntity(`VECTOR('',${direction},${magnitude.toFixed(1)})`);
  }

  public addLine(point: string, vector: string): string {
    return this.addEntity(`LINE('',${point},${vector})`);
  }

  public addEdgeCurve(v1: string, v2: string, line: string): string {
    return this.addEntity(`EDGE_CURVE('',${v1},${v2},${line},.T.)`);
  }

  public addOrientedEdge(edgeCurve: string, orientation: boolean): string {
    return this.addEntity(`ORIENTED_EDGE('',*,*,${edgeCurve},${orientation ? '.T.' : '.F.'})`);
  }

  public addAxis2Placement3D(point: string, dir1: string, dir2: string): string {
    return this.addEntity(`AXIS2_PLACEMENT_3D('',${point},${dir1},${dir2})`);
  }

  public addPlane(axisPlacement: string): string {
    return this.addEntity(`PLANE('',${axisPlacement})`);
  }

  public addEdgeLoop(edges: string[]): string {
    return this.addEntity(`EDGE_LOOP('',(${edges.join(',')}))`);
  }

  public addFaceOuterBound(loop: string): string {
    return this.addEntity(`FACE_OUTER_BOUND('',${loop},.T.)`);
  }

  public addAdvancedFace(bounds: string[], surface: string, sameSense: boolean = true): string {
    return this.addEntity(`ADVANCED_FACE('',(${bounds.join(',')}),${surface},${sameSense ? '.T.' : '.F.'})`);
  }

  public addClosedShell(faces: string[]): string {
    return this.addEntity(`CLOSED_SHELL('',(${faces.join(',')}))`);
  }

  public addManifoldSolidBrep(name: string, shell: string): string {
    return this.addEntity(`MANIFOLD_SOLID_BREP('${name}',${shell})`);
  }

  public getOrCreateStyleAssignment(color: [number, number, number]): string {
    const r = color[0].toFixed(3);
    const g = color[1].toFixed(3);
    const b = color[2].toFixed(3);
    const key = `C_${r}_${g}_${b}`;
    if (this.colorStyleCache.has(key)) {
      return this.colorStyleCache.get(key)!;
    }
    const colorRgb = this.addEntity(`COLOUR_RGB('',${r},${g},${b})`);
    const fillColor = this.addEntity(`FILL_AREA_STYLE_COLOUR('',${colorRgb})`);
    const fillStyle = this.addEntity(`FILL_AREA_STYLE('',(${fillColor}))`);
    const surfFill = this.addEntity(`SURFACE_STYLE_FILL_AREA(${fillStyle})`);
    const surfSide = this.addEntity(`SURFACE_SIDE_STYLE('',(${surfFill}))`);
    const surfUsage = this.addEntity(`SURFACE_STYLE_USAGE(.BOTH.,${surfSide})`);
    const presStyle = this.addEntity(`PRESENTATION_STYLE_ASSIGNMENT((${surfUsage}))`);
    this.colorStyleCache.set(key, presStyle);
    return presStyle;
  }

  public addStyledItem(item: string, color: [number, number, number]): string {
    const presStyle = this.getOrCreateStyleAssignment(color);
    const sId = this.addEntity(`STYLED_ITEM('',(${presStyle}),${item})`);
    this.styledItems.push(sId);
    return sId;
  }

  public addStyledFaces(faces: string[], color: [number, number, number]): string[] {
    const presStyle = this.getOrCreateStyleAssignment(color);
    const res: string[] = [];
    for (const face of faces) {
      const sId = this.addEntity(`STYLED_ITEM('',(${presStyle}),${face})`);
      this.styledItems.push(sId);
      res.push(sId);
    }
    return res;
  }

  public addGeometricRepresentationContext(): string {
    const exp1 = this.addEntity('DIMENSIONAL_EXPONENTS(0.0,0.0,0.0,0.0,0.0,0.0,0.0)');
    const exp2 = this.addEntity('DIMENSIONAL_EXPONENTS(1.0,0.0,0.0,0.0,0.0,0.0,0.0)');

    const namedUnitPlaneAngle = this.addEntity(`(NAMED_UNIT(${exp1})PLANE_ANGLE_UNIT()SI_UNIT($,.RADIAN.))`);
    const namedUnitSolidAngle = this.addEntity(`(NAMED_UNIT(${exp1})SOLID_ANGLE_UNIT()SI_UNIT($,.STERADIAN.))`);
    const namedUnitLength = this.addEntity(`(NAMED_UNIT(${exp2})LENGTH_UNIT()SI_UNIT(.MILLI.,.METRE.))`);

    const uncertaintyMeasure = this.addEntity(`UNCERTAINTY_MEASURE_WITH_UNIT(LENGTH_MEASURE(1.0E-05),${namedUnitLength},'distance_accuracy_value','confusion accuracy')`);

    return this.addEntity(`(GEOMETRIC_REPRESENTATION_CONTEXT(3)GLOBAL_UNCERTAINTY_ASSIGNED_CONTEXT((${uncertaintyMeasure}))GLOBAL_UNIT_ASSIGNED_CONTEXT((${namedUnitLength},${namedUnitPlaneAngle},${namedUnitSolidAngle}))REPRESENTATION_CONTEXT('NONE','WORKSPACE'))`);
  }

  public addShapeDefinitionRepresentation(name: string, items: string[], context: string): string {
    const appContext = this.addEntity("APPLICATION_CONTEXT('core data for automotive mechanical design processes')");
    this.addEntity(`APPLICATION_PROTOCOL_DEFINITION('international standard','automotive_design',2000,${appContext})`);

    const prodDefContext = this.addEntity(`PRODUCT_DEFINITION_CONTEXT('part definition',${appContext},'design')`);
    const prodContext = this.addEntity(`PRODUCT_CONTEXT('',${appContext},'mechanical')`);
    const product = this.addEntity(`PRODUCT('${name}','','ALUFLEX INDUSTRIAL CONVEYOR',(${prodContext}))`);
    const prodFormation = this.addEntity(`PRODUCT_DEFINITION_FORMATION_WITH_SPECIFIED_SOURCE(' ','NONE',${product},.NOT_KNOWN.)`);
    const prodDef = this.addEntity(`PRODUCT_DEFINITION('','NONE',${prodFormation},${prodDefContext})`);
    const prodDefShape = this.addEntity(`PRODUCT_DEFINITION_SHAPE('NONE','NONE',${prodDef})`);

    const brepShape = this.addEntity(`ADVANCED_BREP_SHAPE_REPRESENTATION('${name}',(${items.join(',')}),${context})`);
    return this.addEntity(`SHAPE_DEFINITION_REPRESENTATION(${prodDefShape},${brepShape})`);
  }

  public addMechanicalDesignGeometricPresentationRepresentation(items: string[], context: string): string {
    return this.addEntity(`MECHANICAL_DESIGN_GEOMETRIC_PRESENTATION_REPRESENTATION(' ',(${items.join(',')}),${context})`);
  }

  public addSolidBox(
    center: { x: number; y: number; z: number },
    tangent: { x: number; y: number; z: number },
    normal: { x: number; y: number; z: number },
    dx: number,
    dy: number,
    dz: number,
    name: string,
    color: [number, number, number] = [0.7, 0.7, 0.7],
    up?: { x: number; y: number; z: number }
  ): { brep: string; styledItem: string } {
    const C = new StepVector3(center.x, center.y, center.z);
    const T = new StepVector3(tangent.x, tangent.y, tangent.z).normalize();
    const N = new StepVector3(normal.x, normal.y, normal.z).normalize();
    const U = up ? new StepVector3(up.x, up.y, up.z).normalize() : new StepVector3(0, 1, 0);

    // 8 Corner vertices:
    const pts = [
      C.clone().add(T.clone().multiplyScalar(-dx)).add(N.clone().multiplyScalar(-dy)).add(U.clone().multiplyScalar(-dz)), // 0: -T, -N, -U
      C.clone().add(T.clone().multiplyScalar(dx)).add(N.clone().multiplyScalar(-dy)).add(U.clone().multiplyScalar(-dz)),  // 1: +T, -N, -U
      C.clone().add(T.clone().multiplyScalar(dx)).add(N.clone().multiplyScalar(dy)).add(U.clone().multiplyScalar(-dz)),   // 2: +T, +N, -U
      C.clone().add(T.clone().multiplyScalar(-dx)).add(N.clone().multiplyScalar(dy)).add(U.clone().multiplyScalar(-dz)),  // 3: -T, +N, -U
      C.clone().add(T.clone().multiplyScalar(-dx)).add(N.clone().multiplyScalar(-dy)).add(U.clone().multiplyScalar(dz)),  // 4: -T, -N, +U
      C.clone().add(T.clone().multiplyScalar(dx)).add(N.clone().multiplyScalar(-dy)).add(U.clone().multiplyScalar(dz)),   // 5: +T, -N, +U
      C.clone().add(T.clone().multiplyScalar(dx)).add(N.clone().multiplyScalar(dy)).add(U.clone().multiplyScalar(dz)),    // 6: +T, +N, +U
      C.clone().add(T.clone().multiplyScalar(-dx)).add(N.clone().multiplyScalar(dy)).add(U.clone().multiplyScalar(dz))   // 7: -T, +N, +U
    ];

    const pointIds = pts.map((p) => this.addCartesianPoint(p.x, p.y, p.z));
    const vertexIds = pointIds.map((pId) => this.addVertexPoint(pId));

    const dirTPos = this.addDirection(T.x, T.y, T.z);
    const dirNPos = this.addDirection(N.x, N.y, N.z);
    const dirUPos = this.addDirection(U.x, U.y, U.z);
    const dirTNeg = this.addDirection(-T.x, -T.y, -T.z);
    const dirNNeg = this.addDirection(-N.x, -N.y, -N.z);
    const dirUNeg = this.addDirection(-U.x, -U.y, -U.z);

    // 12 Lines - each line starts EXACTLY at the edge's start vertex:
    // Bottom face edges (U = -dz):
    const l01 = this.addLine(pointIds[0], this.addVector(dirTPos)); // 0 -> 1 (+T)
    const l12 = this.addLine(pointIds[1], this.addVector(dirNPos)); // 1 -> 2 (+N)
    const l23 = this.addLine(pointIds[2], this.addVector(dirTNeg)); // 2 -> 3 (-T)
    const l30 = this.addLine(pointIds[3], this.addVector(dirNNeg)); // 3 -> 0 (-N)

    // Top face edges (U = +dz):
    const l45 = this.addLine(pointIds[4], this.addVector(dirTPos)); // 4 -> 5 (+T)
    const l56 = this.addLine(pointIds[5], this.addVector(dirNPos)); // 5 -> 6 (+N)
    const l67 = this.addLine(pointIds[6], this.addVector(dirTNeg)); // 6 -> 7 (-T)
    const l74 = this.addLine(pointIds[7], this.addVector(dirNNeg)); // 7 -> 4 (-N)

    // Vertical pillar edges (-U to +U):
    const l04 = this.addLine(pointIds[0], this.addVector(dirUPos)); // 0 -> 4 (+U)
    const l15 = this.addLine(pointIds[1], this.addVector(dirUPos)); // 1 -> 5 (+U)
    const l26 = this.addLine(pointIds[2], this.addVector(dirUPos)); // 2 -> 6 (+U)
    const l37 = this.addLine(pointIds[3], this.addVector(dirUPos)); // 3 -> 7 (+U)

    // 12 Edge Curves:
    const ec01 = this.addEdgeCurve(vertexIds[0], vertexIds[1], l01);
    const ec12 = this.addEdgeCurve(vertexIds[1], vertexIds[2], l12);
    const ec23 = this.addEdgeCurve(vertexIds[2], vertexIds[3], l23);
    const ec30 = this.addEdgeCurve(vertexIds[3], vertexIds[0], l30);

    const ec45 = this.addEdgeCurve(vertexIds[4], vertexIds[5], l45);
    const ec56 = this.addEdgeCurve(vertexIds[5], vertexIds[6], l56);
    const ec67 = this.addEdgeCurve(vertexIds[6], vertexIds[7], l67);
    const ec74 = this.addEdgeCurve(vertexIds[7], vertexIds[4], l74);

    const ec04 = this.addEdgeCurve(vertexIds[0], vertexIds[4], l04);
    const ec15 = this.addEdgeCurve(vertexIds[1], vertexIds[5], l15);
    const ec26 = this.addEdgeCurve(vertexIds[2], vertexIds[6], l26);
    const ec37 = this.addEdgeCurve(vertexIds[3], vertexIds[7], l37);

    // 6 Planar Faces with exact analytical planes passing through face vertices:
    // 1. Bottom Face (-U): loop 0 -> 3 -> 2 -> 1 -> 0
    const loopBot = this.addEdgeLoop([
      this.addOrientedEdge(ec30, false),
      this.addOrientedEdge(ec23, false),
      this.addOrientedEdge(ec12, false),
      this.addOrientedEdge(ec01, false)
    ]);
    const boundBot = this.addFaceOuterBound(loopBot);
    const apBot = this.addAxis2Placement3D(pointIds[0], dirUNeg, dirTPos);
    const fBot = this.addAdvancedFace([boundBot], this.addPlane(apBot), true);

    // 2. Top Face (+U): loop 4 -> 5 -> 6 -> 7 -> 4
    const loopTop = this.addEdgeLoop([
      this.addOrientedEdge(ec45, true),
      this.addOrientedEdge(ec56, true),
      this.addOrientedEdge(ec67, true),
      this.addOrientedEdge(ec74, true)
    ]);
    const boundTop = this.addFaceOuterBound(loopTop);
    const apTop = this.addAxis2Placement3D(pointIds[4], dirUPos, dirTPos);
    const fTop = this.addAdvancedFace([boundTop], this.addPlane(apTop), true);

    // 3. Front Face (+T): loop 1 -> 2 -> 6 -> 5 -> 1
    const loopFront = this.addEdgeLoop([
      this.addOrientedEdge(ec12, true),
      this.addOrientedEdge(ec26, true),
      this.addOrientedEdge(ec56, false),
      this.addOrientedEdge(ec15, false)
    ]);
    const boundFront = this.addFaceOuterBound(loopFront);
    const apFront = this.addAxis2Placement3D(pointIds[1], dirTPos, dirUPos);
    const fFront = this.addAdvancedFace([boundFront], this.addPlane(apFront), true);

    // 4. Back Face (-T): loop 0 -> 4 -> 7 -> 3 -> 0
    const loopBack = this.addEdgeLoop([
      this.addOrientedEdge(ec04, true),
      this.addOrientedEdge(ec74, false),
      this.addOrientedEdge(ec37, false),
      this.addOrientedEdge(ec30, true)
    ]);
    const boundBack = this.addFaceOuterBound(loopBack);
    const apBack = this.addAxis2Placement3D(pointIds[0], dirTNeg, dirUPos);
    const fBack = this.addAdvancedFace([boundBack], this.addPlane(apBack), true);

    // 5. Right Face (+N): loop 2 -> 3 -> 7 -> 6 -> 2
    const loopRight = this.addEdgeLoop([
      this.addOrientedEdge(ec23, true),
      this.addOrientedEdge(ec37, true),
      this.addOrientedEdge(ec67, false),
      this.addOrientedEdge(ec26, false)
    ]);
    const boundRight = this.addFaceOuterBound(loopRight);
    const apRight = this.addAxis2Placement3D(pointIds[2], dirNPos, dirUPos);
    const fRight = this.addAdvancedFace([boundRight], this.addPlane(apRight), true);

    // 6. Left Face (-N): loop 0 -> 1 -> 5 -> 4 -> 0
    const loopLeft = this.addEdgeLoop([
      this.addOrientedEdge(ec01, true),
      this.addOrientedEdge(ec15, true),
      this.addOrientedEdge(ec45, false),
      this.addOrientedEdge(ec04, false)
    ]);
    const boundLeft = this.addFaceOuterBound(loopLeft);
    const apLeft = this.addAxis2Placement3D(pointIds[0], dirNNeg, dirUPos);
    const fLeft = this.addAdvancedFace([boundLeft], this.addPlane(apLeft), true);

    const faces = [fBot, fTop, fFront, fBack, fRight, fLeft];
    const shell = this.addClosedShell(faces);
    const brep = this.addManifoldSolidBrep(name, shell);
    const styledItem = this.addStyledItem(brep, color);
    this.addStyledFaces(faces, color);

    return { brep, styledItem };
  }

  public addSolidCylinder(
    center: { x: number; y: number; z: number },
    axis: { x: number; y: number; z: number },
    radius: number,
    length: number,
    name: string,
    color: [number, number, number] = [0.7, 0.7, 0.7],
    segments: number = 16
  ): { brep: string; styledItem: string } {
    const C = new StepVector3(center.x, center.y, center.z);
    const A = new StepVector3(axis.x, axis.y, axis.z).normalize();
    const ref = Math.abs(A.y) < 0.9 ? new StepVector3(0, 1, 0) : new StepVector3(1, 0, 0);
    const U = A.cross(ref).normalize();
    const V = A.cross(U).normalize();

    const halfLen = length / 2.0;
    const botPts: StepVector3[] = [];
    const topPts: StepVector3[] = [];

    for (let i = 0; i < segments; i++) {
      const angle = (2.0 * Math.PI * i) / segments;
      const radVec = U.clone().multiplyScalar(radius * Math.cos(angle)).add(V.clone().multiplyScalar(radius * Math.sin(angle)));
      botPts.push(C.clone().add(A.clone().multiplyScalar(-halfLen)).add(radVec));
      topPts.push(C.clone().add(A.clone().multiplyScalar(halfLen)).add(radVec));
    }

    const botPtIds = botPts.map((p) => this.addCartesianPoint(p.x, p.y, p.z));
    const topPtIds = topPts.map((p) => this.addCartesianPoint(p.x, p.y, p.z));
    const botVpIds = botPtIds.map((pid) => this.addVertexPoint(pid));
    const topVpIds = topPtIds.map((pid) => this.addVertexPoint(pid));

    const dirAPos = this.addDirection(A.x, A.y, A.z);
    const dirANeg = this.addDirection(-A.x, -A.y, -A.z);
    const vecAPos = this.addVector(dirAPos);

    const botEdges: string[] = [];
    const topEdges: string[] = [];
    const sideEdges: string[] = [];

    for (let i = 0; i < segments; i++) {
      const nxt = (i + 1) % segments;
      const dVec = botPts[nxt].clone().add(botPts[i].clone().multiplyScalar(-1.0)).normalize();
      const lB = this.addLine(botPtIds[i], this.addVector(this.addDirection(dVec.x, dVec.y, dVec.z)));
      botEdges.push(this.addEdgeCurve(botVpIds[i], botVpIds[nxt], lB));

      const dVecTop = topPts[nxt].clone().add(topPts[i].clone().multiplyScalar(-1.0)).normalize();
      const lT = this.addLine(topPtIds[i], this.addVector(this.addDirection(dVecTop.x, dVecTop.y, dVecTop.z)));
      topEdges.push(this.addEdgeCurve(topVpIds[i], topVpIds[nxt], lT));

      const lS = this.addLine(botPtIds[i], vecAPos);
      sideEdges.push(this.addEdgeCurve(botVpIds[i], topVpIds[i], lS));
    }

    const faces: string[] = [];

    for (let i = 0; i < segments; i++) {
      const nxt = (i + 1) % segments;
      const oeBot = this.addOrientedEdge(botEdges[i], true);
      const oeSideNxt = this.addOrientedEdge(sideEdges[nxt], true);
      const oeTopRev = this.addOrientedEdge(topEdges[i], false);
      const oeSideCurrRev = this.addOrientedEdge(sideEdges[i], false);

      const loop = this.addEdgeLoop([oeBot, oeSideNxt, oeTopRev, oeSideCurrRev]);
      const bound = this.addFaceOuterBound(loop);

      const midAng = (2.0 * Math.PI * (i + 0.5)) / segments;
      const fn = U.clone().multiplyScalar(Math.cos(midAng)).add(V.clone().multiplyScalar(Math.sin(midAng))).normalize();
      const dirFn = this.addDirection(fn.x, fn.y, fn.z);
      const ap = this.addAxis2Placement3D(botPtIds[i], dirFn, dirAPos);
      faces.push(this.addAdvancedFace([bound], this.addPlane(ap), true));
    }

    // Top cap
    const topCapOe = topEdges.map((e) => this.addOrientedEdge(e, true));
    const topLoop = this.addEdgeLoop(topCapOe);
    const topCenter = C.clone().add(A.clone().multiplyScalar(halfLen));
    const topCenterId = this.addCartesianPoint(topCenter.x, topCenter.y, topCenter.z);
    const apTop = this.addAxis2Placement3D(topCenterId, dirAPos, this.addDirection(U.x, U.y, U.z));
    faces.push(this.addAdvancedFace([this.addFaceOuterBound(topLoop)], this.addPlane(apTop), true));

    // Bottom cap
    const botCapOe = [...botEdges].reverse().map((e) => this.addOrientedEdge(e, false));
    const botLoop = this.addEdgeLoop(botCapOe);
    const botCenter = C.clone().add(A.clone().multiplyScalar(-halfLen));
    const botCenterId = this.addCartesianPoint(botCenter.x, botCenter.y, botCenter.z);
    const apBot = this.addAxis2Placement3D(botCenterId, dirANeg, this.addDirection(U.x, U.y, U.z));
    faces.push(this.addAdvancedFace([this.addFaceOuterBound(botLoop)], this.addPlane(apBot), true));

    const shell = this.addClosedShell(faces);
    const brep = this.addManifoldSolidBrep(name, shell);
    const styledItem = this.addStyledItem(brep, color);
    this.addStyledFaces(faces, color);
    return { brep, styledItem };
  }

  public addStraightExtrudedSolid(
    profilePts2d: [number, number][],
    startPt: StepVector3,
    endPt: StepVector3,
    norm: StepVector3,
    workingY: number,
    name: string,
    color: [number, number, number]
  ): { brep: string; styledItem: string } {
    const pts1 = profilePts2d.map(([latOff, yOff]) =>
      new StepVector3(
        startPt.x + norm.x * latOff,
        workingY + yOff,
        startPt.z + norm.z * latOff
      )
    );
    const pts2 = profilePts2d.map(([latOff, yOff]) =>
      new StepVector3(
        endPt.x + norm.x * latOff,
        workingY + yOff,
        endPt.z + norm.z * latOff
      )
    );
    return this.buildPrismSolid(pts1, pts2, name, color);
  }

  public addCurvedExtrudedSolid(
    profilePts2d: [number, number][],
    centerArc: StepVector3,
    centerRadius: number,
    startAngle: number,
    endAngle: number,
    isLeft: boolean,
    workingY: number,
    name: string,
    color: [number, number, number],
    numSteps: number = 12
  ): { brep: string; styledItem: string }[] {
    const solids: { brep: string; styledItem: string }[] = [];
    const angleSpan = endAngle - startAngle;
    const stepAngle = angleSpan / numSteps;

    for (let s = 0; s < numSteps; s++) {
      const a1 = startAngle + s * stepAngle;
      const a2 = startAngle + (s + 1) * stepAngle;

      const pts1 = profilePts2d.map(([rOff, yOff]) =>
        new StepVector3(
          centerArc.x + (centerRadius + rOff) * Math.cos(a1),
          workingY + yOff,
          centerArc.z + (centerRadius + rOff) * Math.sin(a1)
        )
      );

      const pts2 = profilePts2d.map(([rOff, yOff]) =>
        new StepVector3(
          centerArc.x + (centerRadius + rOff) * Math.cos(a2),
          workingY + yOff,
          centerArc.z + (centerRadius + rOff) * Math.sin(a2)
        )
      );

      const sectorName = `${name}_Sec_${s + 1}`;
      const sign = isLeft ? -1.0 : 1.0;
      const tan1 = new StepVector3(-Math.sin(a1) * sign, 0.0, Math.cos(a1) * sign);
      const tan2 = new StepVector3(-Math.sin(a2) * sign, 0.0, Math.cos(a2) * sign);
      const cap1Norm = tan1.multiplyScalar(-1.0);
      const cap2Norm = tan2;
      solids.push(this.buildPrismSolid(pts1, pts2, sectorName, color, cap1Norm, cap2Norm));
    }

    return solids;
  }

  private buildPrismSolid(
    pts1: StepVector3[],
    pts2: StepVector3[],
    name: string,
    color: [number, number, number],
    cap1Normal?: StepVector3,
    cap2Normal?: StepVector3
  ): { brep: string; styledItem: string } {
    const N = pts1.length;
    const p1Ids = pts1.map((p) => this.addCartesianPoint(p.x, p.y, p.z));
    const p2Ids = pts2.map((p) => this.addCartesianPoint(p.x, p.y, p.z));
    const vp1Ids = p1Ids.map((pid) => this.addVertexPoint(pid));
    const vp2Ids = p2Ids.map((pid) => this.addVertexPoint(pid));

    const e1List: string[] = [];
    const e2List: string[] = [];
    const esList: string[] = [];

    for (let i = 0; i < N; i++) {
      const nxt = (i + 1) % N;
      const d1 = pts1[nxt].clone().add(pts1[i].clone().multiplyScalar(-1.0)).normalize();
      const l1 = this.addLine(p1Ids[i], this.addVector(this.addDirection(d1.x, d1.y, d1.z)));
      e1List.push(this.addEdgeCurve(vp1Ids[i], vp1Ids[nxt], l1));

      const d2 = pts2[nxt].clone().add(pts2[i].clone().multiplyScalar(-1.0)).normalize();
      const l2 = this.addLine(p2Ids[i], this.addVector(this.addDirection(d2.x, d2.y, d2.z)));
      e2List.push(this.addEdgeCurve(vp2Ids[i], vp2Ids[nxt], l2));

      const ds = pts2[i].clone().add(pts1[i].clone().multiplyScalar(-1.0)).normalize();
      const ls = this.addLine(p1Ids[i], this.addVector(this.addDirection(ds.x, ds.y, ds.z)));
      esList.push(this.addEdgeCurve(vp1Ids[i], vp2Ids[i], ls));
    }

    const faces: string[] = [];

    for (let i = 0; i < N; i++) {
      const nxt = (i + 1) % N;
      const oe1 = this.addOrientedEdge(e1List[i], true);
      const oesNxt = this.addOrientedEdge(esList[nxt], true);
      const oe2Rev = this.addOrientedEdge(e2List[i], false);
      const oesCurrRev = this.addOrientedEdge(esList[i], false);

      const loop = this.addEdgeLoop([oe1, oesNxt, oe2Rev, oesCurrRev]);
      const bound = this.addFaceOuterBound(loop);

      const vA = pts1[nxt].clone().add(pts1[i].clone().multiplyScalar(-1.0));
      const vB = pts2[i].clone().add(pts1[i].clone().multiplyScalar(-1.0));
      const fn = vA.cross(vB).normalize();
      const dirFn = this.addDirection(fn.x, fn.y, fn.z);
      const ap = this.addAxis2Placement3D(p1Ids[i], dirFn, this.addDirection(vA.x, vA.y, vA.z));
      faces.push(this.addAdvancedFace([bound], this.addPlane(ap), true));
    }

    // Cap 1 (reverse: CCW viewed from outside)
    const cap1Oe = [...e1List].reverse().map((e) => this.addOrientedEdge(e, false));
    const fn1 = cap1Normal
      ? cap1Normal.clone().normalize()
      : pts2[0].clone().add(pts1[0].clone().multiplyScalar(-1.0)).normalize().multiplyScalar(-1.0);
    const dirFn1 = this.addDirection(fn1.x, fn1.y, fn1.z);
    const refVec1 = Math.abs(fn1.y) < 0.9 ? new StepVector3(0, 1, 0) : new StepVector3(1, 0, 0);
    const ref1 = fn1.cross(refVec1).normalize();
    const dirRef1 = this.addDirection(ref1.x, ref1.y, ref1.z);
    const ap1 = this.addAxis2Placement3D(p1Ids[0], dirFn1, dirRef1);
    faces.push(this.addAdvancedFace([this.addFaceOuterBound(this.addEdgeLoop(cap1Oe))], this.addPlane(ap1), true));

    // Cap 2 (forward: CCW viewed from outside)
    const cap2Oe = e2List.map((e) => this.addOrientedEdge(e, true));
    const fn2 = cap2Normal
      ? cap2Normal.clone().normalize()
      : pts2[0].clone().add(pts1[0].clone().multiplyScalar(-1.0)).normalize();
    const dirFn2 = this.addDirection(fn2.x, fn2.y, fn2.z);
    const refVec2 = Math.abs(fn2.y) < 0.9 ? new StepVector3(0, 1, 0) : new StepVector3(1, 0, 0);
    const ref2 = fn2.cross(refVec2).normalize();
    const dirRef2 = this.addDirection(ref2.x, ref2.y, ref2.z);
    const ap2 = this.addAxis2Placement3D(p2Ids[0], dirFn2, dirRef2);
    faces.push(this.addAdvancedFace([this.addFaceOuterBound(this.addEdgeLoop(cap2Oe))], this.addPlane(ap2), true));

    const shell = this.addClosedShell(faces);
    const brep = this.addManifoldSolidBrep(name, shell);
    const styledItem = this.addStyledItem(brep, color);
    this.addStyledFaces(faces, color);
    return { brep, styledItem };
  }

  public generateStepString(): string {
    const timestamp = new Date().toISOString();
    const lines: string[] = [];
    lines.push('ISO-10303-21;');
    lines.push('HEADER;');
    lines.push("FILE_DESCRIPTION(('STEP AP214 Conveyor Assembly - Industrial Parametric CAD Solid'),'2;1');");
    lines.push(`FILE_NAME('${this.name}.step','${timestamp}',('ALUFLEX Engineering'),('ALUFLEX Systems'),'${this.name}','Parametric STEP Exporter v3.0',' ');`);
    lines.push("FILE_SCHEMA(('AUTOMOTIVE_DESIGN { 1 0 10303 214 1 1 1 1 }', 'AUTOMOTIVE_DESIGN'));");
    lines.push('ENDSEC;');
    lines.push('DATA;');
    for (const item of this.data) {
      lines.push(item);
    }
    lines.push('ENDSEC;');
    lines.push('END-ISO-10303-21;');
    return lines.join('\n');
  }
}

export function generateExactConveyorStep(config: ConveyorConfiguration): string {
  const trackWidth = config.width || 82.5;
  const conveyorLen = config.length || 3000;
  const step = new StepFileGenerator(`ALUFLEX_CONVEYOR_${int(trackWidth)}MM_${int(conveyorLen)}MM`);

  // Canonical path matching Three.js visualizer 100%
  const path = new ConveyorPath(config);

  const wh = config.workingHeight;
  const workingY = wh?.enabled && wh.type !== 'without-support' ? wh.height : 850.0;

  const solids: string[] = [];
  const styledItems: string[] = [];

  // Color definitions (Strictly matching client reference Images 1, 2, 3, 4)
  const chainColor: [number, number, number] = config.chainMaterial === 'plastic'
    ? [0.82, 0.73, 0.54]   // POM-D Acetal Authentic Tan / Khaki (Image 2)
    : config.chainMaterial === 'stainless-steel'
    ? [0.82, 0.85, 0.88]   // Polished AISI 304
    : [0.45, 0.48, 0.52];  // Carbon Steel

  const frameColor: [number, number, number] = [0.78, 0.80, 0.83];       // Anodized Aluminium 6063-T6 (Natural Silver)
  const wearColor: [number, number, number] = [0.15, 0.58, 0.25];        // UHMW Green Wear Strip Track
  const motorSilver: [number, number, number] = [0.86, 0.88, 0.90];      // Cast Aluminium Silver Motor & Gearbox (Image 1)
  const motorFlangeColor: [number, number, number] = [0.22, 0.24, 0.26]; // Dark Anthracite Intermediate Flange Ring (Image 1)
  const terminalBoxColor: [number, number, number] = [0.21, 0.23, 0.25]; // Dark Anthracite Terminal Box (Image 1)
  const motorFanColor: [number, number, number] = [0.80, 0.82, 0.85];   // Aluminium Silver Fan Cowl (Image 1 - NOT yellow)
  const supportColor: [number, number, number] = [0.75, 0.77, 0.80];     // Structural Aluminium Column Extrusion (Image 4)
  const hardwareColor: [number, number, number] = [0.74, 0.77, 0.80];    // Stainless Steel / Zinc Plated Hardware
  const guideColor: [number, number, number] = [0.12, 0.58, 0.28];       // Virgin UHMW Industrial Green Guide Rail (Image 4)
  const guideHornColor: [number, number, number] = [0.60, 0.65, 0.70];  // Molded Grey Entry/Exit Guide Horns (Image 4)
  const stainlessBracketColor: [number, number, number] = [0.80, 0.82, 0.85]; // Stainless Steel Sheet / C-Channel Backing (Image 4)
  const knobBlackColor: [number, number, number] = [0.10, 0.10, 0.12];  // Matte Black Phenolic Clamp Levers & Rubber Pads (Image 4)

  // Profile & Chain Dimensions
  const halfTrack = trackWidth / 2.0;
  const profileWidth = 24.0;   // 24 mm standard extrusion profile
  const profileHeight = 92.0;  // 92 mm profile height (strictly matching client spec & 804-85)
  const frameOffset = halfTrack + profileWidth / 2.0;

  // 1. AUTHENTIC 92x24 MM EXTRUDED PROFILE WITH T-SLOT GROOVE & SHOULDERS
  const rightProfilePts2d: [number, number][] = [
    [12.0, -46.0],
    [12.0, -8.0],
    [8.0, -8.0],
    [8.0, -11.0],
    [6.0, -11.0],
    [6.0, 11.0],
    [8.0, 11.0],
    [8.0, 8.0],
    [12.0, 8.0],
    [12.0, 42.0],
    [12.0, 46.0],
    [2.0, 46.0],
    [2.0, 42.0],
    [-10.0, 42.0],
    [-10.0, 46.0],
    [-12.0, 46.0],
    [-12.0, -18.0],
    [-8.0, -18.0],
    [-8.0, -28.0],
    [-12.0, -28.0],
    [-12.0, -46.0]
  ];
  const leftProfilePts2d: [number, number][] = rightProfilePts2d.slice().reverse().map(([x, y]) => [-x, y]);

  const rightWearPts2d: [number, number][] = [[-10.0, 42.0], [2.0, 42.0], [2.0, 48.0], [-10.0, 48.0]];
  const leftWearPts2d: [number, number][] = [[-2.0, 42.0], [10.0, 42.0], [10.0, 48.0], [-2.0, 48.0]];

  // 1. FRAME PROFILES & WEAR STRIPS
  for (const seg of path.segments) {
    if (seg.type === 'straight') {
      const tan = new StepVector3(seg.direction.x, 0, seg.direction.z).normalize();
      const norm = new StepVector3(-tan.z, 0, tan.x).normalize();

      // Left Profile Rail
      const lpStart = seg.startPoint.clone().add(norm.clone().multiplyScalar(-frameOffset));
      const lpEnd = seg.endPoint.clone().add(norm.clone().multiplyScalar(-frameOffset));
      const lp = step.addStraightExtrudedSolid(leftProfilePts2d, lpStart, lpEnd, norm, workingY, 'Left_Profile_Straight', frameColor);
      solids.push(lp.brep); styledItems.push(lp.styledItem);

      // Right Profile Rail
      const rpStart = seg.startPoint.clone().add(norm.clone().multiplyScalar(frameOffset));
      const rpEnd = seg.endPoint.clone().add(norm.clone().multiplyScalar(frameOffset));
      const rp = step.addStraightExtrudedSolid(rightProfilePts2d, rpStart, rpEnd, norm, workingY, 'Right_Profile_Straight', frameColor);
      solids.push(rp.brep); styledItems.push(rp.styledItem);

      // Left & Right Wear strips
      const lw = step.addStraightExtrudedSolid(leftWearPts2d, lpStart, lpEnd, norm, workingY, 'Wear_Strip_L_Straight', wearColor);
      solids.push(lw.brep); styledItems.push(lw.styledItem);
      const rw = step.addStraightExtrudedSolid(rightWearPts2d, rpStart, rpEnd, norm, workingY, 'Wear_Strip_R_Straight', wearColor);
      solids.push(rw.brep); styledItems.push(rw.styledItem);

    } else if (seg.type === 'curve') {
      const isLeft = seg.direction === 'left';
      const numSteps = Math.max(16, Math.round(seg.sweepAngle / (Math.PI / 20)));
      const rInner = seg.radius - frameOffset;
      const rOuter = seg.radius + frameOffset;
      const centerArc = new StepVector3(seg.center.x, 0, seg.center.z);

      const curvedLeft = step.addCurvedExtrudedSolid(
        isLeft ? leftProfilePts2d : rightProfilePts2d,
        centerArc,
        isLeft ? rInner : rOuter,
        seg.startAngle,
        seg.endAngle,
        isLeft,
        workingY,
        'Curved_Left_Frame_Rail',
        frameColor,
        numSteps
      );
      for (const item of curvedLeft) { solids.push(item.brep); styledItems.push(item.styledItem); }

      const curvedRight = step.addCurvedExtrudedSolid(
        isLeft ? rightProfilePts2d : leftProfilePts2d,
        centerArc,
        isLeft ? rOuter : rInner,
        seg.startAngle,
        seg.endAngle,
        isLeft,
        workingY,
        'Curved_Right_Frame_Rail',
        frameColor,
        numSteps
      );
      for (const item of curvedRight) { solids.push(item.brep); styledItems.push(item.styledItem); }

      // Wear strips curved
      const wearLeft = step.addCurvedExtrudedSolid(
        isLeft ? leftWearPts2d : rightWearPts2d,
        centerArc,
        isLeft ? rInner : rOuter,
        seg.startAngle,
        seg.endAngle,
        isLeft,
        workingY,
        'Curved_Wear_Strip_L',
        wearColor,
        numSteps
      );
      for (const item of wearLeft) { solids.push(item.brep); styledItems.push(item.styledItem); }

      const wearRight = step.addCurvedExtrudedSolid(
        isLeft ? rightWearPts2d : leftWearPts2d,
        centerArc,
        isLeft ? rOuter : rInner,
        seg.startAngle,
        seg.endAngle,
        isLeft,
        workingY,
        'Curved_Wear_Strip_R',
        wearColor,
        numSteps
      );
      for (const item of wearRight) { solids.push(item.brep); styledItems.push(item.styledItem); }

      // Under-curve radial cross-brace spacers
      for (const frac of [0.25, 0.50, 0.75]) {
        const ang = seg.startAngle + frac * (seg.endAngle - seg.startAngle);
        const midR = (rInner + rOuter) / 2.0;
        const radPos = new StepVector3(seg.center.x + midR * Math.cos(ang), workingY - 20.0, seg.center.z + midR * Math.sin(ang));
        const radTan = new StepVector3(-Math.sin(ang), 0.0, Math.cos(ang)).normalize();
        const radNorm = new StepVector3(Math.cos(ang), 0.0, Math.sin(ang)).normalize();

        const spacer = step.addSolidBox(radPos, radTan, radNorm, 15.0, (rOuter - rInner - profileWidth) / 2.0, 15.0, `Curve_Cross_Spacer_${Math.round(frac * 100)}`, supportColor);
        solids.push(spacer.brep); styledItems.push(spacer.styledItem);
      }
    }
  }

  // 2. CROSS-TIE STRUCTURAL BEAMS
  const numCross = Math.max(2, Math.floor(path.totalLength / 600.0));
  for (let c = 0; c <= numCross; c++) {
    const dist = Math.max(50.0, Math.min(path.totalLength - 50.0, (c / numCross) * path.totalLength));
    const sample = path.getSampleAtDistance(dist);
    const cbCenter = new StepVector3(sample.point.x, workingY - 20.0, sample.point.z);
    const tan = new StepVector3(sample.tangent.x, sample.tangent.y, sample.tangent.z);
    const norm = new StepVector3(sample.normal.x, sample.normal.y, sample.normal.z);
    const cbW = trackWidth + profileWidth;
    const cb = step.addSolidBox(cbCenter, tan, norm, 20.0, cbW / 2.0, 20.0, `Frame_Cross_Beam_${c + 1}`, supportColor);
    solids.push(cb.brep); styledItems.push(cb.styledItem);
  }

  // 3. MODULAR SLAT CHAIN (Pitch = 38.1 mm - conveyor-modular-chain-link.png & Image 2)
  const pitch = (trackWidth > 63.0 && trackWidth <= 114.3) || trackWidth === 82.5 ? 38.1 : (trackWidth <= 63.0 ? 25.4 : 50.8);
  const numLinks = Math.max(2, Math.floor(path.totalLength / pitch));
  const chainTopY = workingY + 48.0;

  for (let l = 0; l < numLinks; l++) {
    const dLink = (l + 0.5) * pitch;
    if (dLink > path.totalLength - 10.0) break;
    const sample = path.getSampleAtDistance(dLink);
    const slatCenter = new StepVector3(sample.point.x, chainTopY + 2.25, sample.point.z);
    const tan = new StepVector3(sample.tangent.x, sample.tangent.y, sample.tangent.z);
    const norm = new StepVector3(sample.normal.x, sample.normal.y, sample.normal.z);

    // 3A. Slat Main Top Carrying Plate (Image 2)
    const slat = step.addSolidBox(slatCenter, tan, norm, 12.5, halfTrack - 0.75, 2.25, `Chain_Slat_Plate_${l + 1}`, chainColor);
    solids.push(slat.brep); styledItems.push(slat.styledItem);

    // 3B. Forward Interlocking Knuckle Pair (Image 2: two outer barrels at leading edge)
    const fwdKnuckleC = slatCenter.clone().add(tan.clone().multiplyScalar(14.0));
    fwdKnuckleC.y -= 1.0;
    const knuckleSpacing = (halfTrack - 4.0) * 0.55;
    for (const [kSign, kName] of [[-1.0, 'L'], [1.0, 'R']] as const) {
      const kPos = fwdKnuckleC.clone().add(norm.clone().multiplyScalar(kSign * knuckleSpacing));
      const kn = step.addSolidBox(kPos, tan, norm, 4.0, 7.0, 2.75, `Chain_Fwd_Knuckle_${kName}_${l + 1}`, chainColor);
      solids.push(kn.brep); styledItems.push(kn.styledItem);
    }

    // 3C. Trailing Central Interlocking Knuckle (Image 2: single center barrel at trailing edge)
    const trailKnuckleC = slatCenter.clone().add(tan.clone().multiplyScalar(-14.0));
    trailKnuckleC.y -= 1.0;
    const tkn = step.addSolidBox(trailKnuckleC, tan, norm, 4.0, 10.0, 2.75, `Chain_Trail_Knuckle_${l + 1}`, chainColor);
    solids.push(tkn.brep); styledItems.push(tkn.styledItem);

    // 3D. Stainless Steel Slat Connecting Hinge Pin
    const pin = step.addSolidCylinder(fwdKnuckleC.clone(), norm, 3.0, trackWidth - 8.0, `Chain_Hinge_Pin_${l + 1}`, hardwareColor, 12);
    solids.push(pin.brep); styledItems.push(pin.styledItem);

    // 3E. Underside Curve Retention Tabs (Image 2: L-shaped guide tabs)
    for (const [tabSign, tabName] of [[-1.0, 'L'], [1.0, 'R']] as const) {
      const tabC = slatCenter.clone().add(norm.clone().multiplyScalar(tabSign * (halfTrack - 14.0)));
      tabC.y -= 6.0;
      const tab = step.addSolidBox(tabC, tan, norm, 8.0, 3.5, 4.0, `Chain_Guide_Tab_${tabName}_${l + 1}`, chainColor);
      solids.push(tab.brep); styledItems.push(tab.styledItem);
    }
  }

  // Terminal Sprocket & Shaft Geometry Constants
  const terminalSprocketR = 48.0;  // Authentic ALUFLEX terminal sprocket radius (pitch line tangent to wear strip at working_y + 46.0 mm)
  const terminalShaftFwd = 50.0;   // Centers sprocket 50 mm beyond profile rail cut face (leaves 2.0 mm clear space between sprocket and frame)
  const terminalShaftY = workingY - 2.0; // Sprocket top at working_y + 46.0 mm, bottom at working_y - 50.0 mm

  // Return run underneath conveyor (aligned with bottom of sprockets at workingY - 52.25 mm)
  const numReturnLinks = Math.max(2, Math.floor(path.totalLength / (pitch * 3.0)));
  for (let r = 0; r < numReturnLinks; r++) {
    const dRet = (r + 0.5) * (pitch * 3.0);
    if (dRet > path.totalLength - 10.0) break;
    const sample = path.getSampleAtDistance(dRet);
    const retCenter = new StepVector3(sample.point.x, workingY - 52.25, sample.point.z);
    const tan = new StepVector3(sample.tangent.x, sample.tangent.y, sample.tangent.z);
    const norm = new StepVector3(sample.normal.x, sample.normal.y, sample.normal.z);
    const ret = step.addSolidBox(retCenter, tan, norm, (pitch * 3.0) / 2.0, halfTrack * 0.9, 1.25, `Return_Chain_${r + 1}`, chainColor);
    solids.push(ret.brep); styledItems.push(ret.styledItem);
  }

  // 3F. Sprocket Wrap-Around Chain Links (tangentially hugging the sprockets with zero interpenetration)
  const wrapR = terminalSprocketR + 1.25;

  // Discharge end wrap
  const dEndSample = path.samples[path.samples.length - 1];
  const dEndTan = new StepVector3(dEndSample.tangent.x, dEndSample.tangent.y, dEndSample.tangent.z);
  const dEndNorm = new StepVector3(dEndSample.normal.x, dEndSample.normal.y, dEndSample.normal.z);
  const driveShaftWrapPt = new StepVector3(dEndSample.point.x, 0, dEndSample.point.z).add(dEndTan.clone().multiplyScalar(terminalShaftFwd));
  driveShaftWrapPt.y = terminalShaftY;
  for (let wI = 0; wI < 5; wI++) {
    const wAng = (wI + 0.5) * (Math.PI / 5.0);
    const uWrap = dEndTan.clone().multiplyScalar(Math.sin(wAng)).add(new StepVector3(0, Math.cos(wAng), 0)).normalize();
    const tWrap = dEndTan.clone().multiplyScalar(Math.cos(wAng)).add(new StepVector3(0, -Math.sin(wAng), 0)).normalize();
    const wPos = driveShaftWrapPt.clone().add(uWrap.clone().multiplyScalar(wrapR));
    const cw = step.addSolidBox(wPos, tWrap, dEndNorm, 12.0, halfTrack - 1.0, 1.25, `Chain_End_Wrap_${wI + 1}`, chainColor, uWrap);
    solids.push(cw.brep); styledItems.push(cw.styledItem);
  }

  // Infeed idler wrap
  const dStartSample = path.samples[0];
  const dStartTan = new StepVector3(dStartSample.tangent.x, dStartSample.tangent.y, dStartSample.tangent.z);
  const dStartNorm = new StepVector3(dStartSample.normal.x, dStartSample.normal.y, dStartSample.normal.z);
  const idlerShaftWrapPt = new StepVector3(dStartSample.point.x, 0, dStartSample.point.z).add(dStartTan.clone().multiplyScalar(-terminalShaftFwd));
  idlerShaftWrapPt.y = terminalShaftY;
  for (let wI = 0; wI < 5; wI++) {
    const wAng = (wI + 0.5) * (Math.PI / 5.0);
    const uInfeed = dStartTan.clone().multiplyScalar(-Math.sin(wAng)).add(new StepVector3(0, Math.cos(wAng), 0)).normalize();
    const tInfeed = dStartTan.clone().multiplyScalar(-Math.cos(wAng)).add(new StepVector3(0, -Math.sin(wAng), 0)).normalize();
    const wPos = idlerShaftWrapPt.clone().add(uInfeed.clone().multiplyScalar(wrapR));
    const cw = step.addSolidBox(wPos, tInfeed, dStartNorm, 12.0, halfTrack - 1.0, 1.25, `Chain_Start_Wrap_${wI + 1}`, chainColor, uInfeed);
    solids.push(cw.brep); styledItems.push(cw.styledItem);
  }

  // 4. SIDE GUIDE SYSTEM WITH STAINLESS BACKING & ANGLED LOCKING LEVER HANDLES
  if (config.sideGuides && config.sideGuides.length > 0) {
    const sg = config.sideGuides[0];
    const guideDist = sg.widthBetweenGuides || 100.0;
    const guideH = sg.heightAboveChain || 60.0;
    const guideOffset = guideDist / 2.0;
    const guideY = chainTopY + guideH;

    const guidePts2d: [number, number][] = [[-6.0, 10.0], [6.0, 10.0], [6.0, -10.0], [-6.0, -10.0]];

    for (const seg of path.segments) {
      if (seg.type === 'straight') {
        const tan = new StepVector3(seg.direction.x, 0, seg.direction.z).normalize();
        const norm = new StepVector3(-tan.z, 0, tan.x).normalize();
        const midX = (seg.startPoint.x + seg.endPoint.x) / 2.0;
        const midZ = (seg.startPoint.z + seg.endPoint.z) / 2.0;
        const segMid = new StepVector3(midX, guideY, midZ);

        // Left Guide Rail + Stainless Backing Channel
        const lgCenter = segMid.clone().add(norm.clone().multiplyScalar(-guideOffset));
        const lg = step.addSolidBox(lgCenter, tan, norm, seg.length / 2.0, 6.0, 10.0, 'Left_Side_Guide_Straight', guideColor);
        solids.push(lg.brep); styledItems.push(lg.styledItem);
        const lgbCenter = lgCenter.clone().add(norm.clone().multiplyScalar(-7.25));
        const lgb = step.addSolidBox(lgbCenter, tan, norm, seg.length / 2.0, 1.25, 12.0, 'Left_Guide_Stainless_Backing', stainlessBracketColor);
        solids.push(lgb.brep); styledItems.push(lgb.styledItem);

        // Right Guide Rail + Stainless Backing Channel
        const rgCenter = segMid.clone().add(norm.clone().multiplyScalar(guideOffset));
        const rg = step.addSolidBox(rgCenter, tan, norm, seg.length / 2.0, 6.0, 10.0, 'Right_Side_Guide_Straight', guideColor);
        solids.push(rg.brep); styledItems.push(rg.styledItem);
        const rgbCenter = rgCenter.clone().add(norm.clone().multiplyScalar(7.25));
        const rgb = step.addSolidBox(rgbCenter, tan, norm, seg.length / 2.0, 1.25, 12.0, 'Right_Guide_Stainless_Backing', stainlessBracketColor);
        solids.push(rgb.brep); styledItems.push(rgb.styledItem);

      } else if (seg.type === 'curve') {
        const isLeft = seg.direction === 'left';
        const numGuideSteps = Math.max(16, Math.round(seg.sweepAngle / (Math.PI / 20)));
        const rIn = seg.radius - guideOffset;
        const rOut = seg.radius + guideOffset;
        const centerArc = new StepVector3(seg.center.x, 0, seg.center.z);

        const cgLeft = step.addCurvedExtrudedSolid(
          guidePts2d,
          centerArc,
          isLeft ? rIn : rOut,
          seg.startAngle,
          seg.endAngle,
          isLeft,
          guideY,
          'Curved_Left_Side_Guide',
          guideColor,
          numGuideSteps
        );
        for (const item of cgLeft) { solids.push(item.brep); styledItems.push(item.styledItem); }

        const cgRight = step.addCurvedExtrudedSolid(
          guidePts2d,
          centerArc,
          isLeft ? rOut : rIn,
          seg.startAngle,
          seg.endAngle,
          isLeft,
          guideY,
          'Curved_Right_Side_Guide',
          guideColor,
          numGuideSteps
        );
        for (const item of cgRight) { solids.push(item.brep); styledItems.push(item.styledItem); }
      }
    }

    // Flared horns at infeed and outfeed
    for (const [sampleD, flareSign, fName] of [[20.0, -1.0, 'Infeed'], [path.totalLength - 20.0, 1.0, 'Outfeed']] as const) {
      const sFlare = path.getSampleAtDistance(sampleD);
      const tan = new StepVector3(sFlare.tangent.x, sFlare.tangent.y, sFlare.tangent.z);
      const norm = new StepVector3(sFlare.normal.x, sFlare.normal.y, sFlare.normal.z);
      for (const [sideSign, sName] of [[-1.0, 'Left'], [1.0, 'Right']] as const) {
        const hornCenter = new StepVector3(sFlare.point.x, guideY, sFlare.point.z).add(norm.clone().multiplyScalar(sideSign * (guideOffset + 18.0)));
        const horn = step.addSolidBox(hornCenter, tan, norm, 35.0, 5.0, 10.0, `Guide_Flare_Horn_${fName}_${sName}`, guideHornColor);
        solids.push(horn.brep); styledItems.push(horn.styledItem);
      }
    }

    // Guide brackets every ~450 mm
    const numBrackets = Math.max(3, Math.floor(path.totalLength / 450.0));
    for (let b = 0; b <= numBrackets; b++) {
      const dist = Math.max(30.0, Math.min(path.totalLength - 30.0, (b / numBrackets) * path.totalLength));
      const sample = path.getSampleAtDistance(dist);
      const tan = new StepVector3(sample.tangent.x, sample.tangent.y, sample.tangent.z);
      const norm = new StepVector3(sample.normal.x, sample.normal.y, sample.normal.z);
      const sPt = new StepVector3(sample.point.x, 0, sample.point.z);

      for (const [sideSign, sName] of [[-1.0, 'L'], [1.0, 'R']] as const) {
        // Frame clamp block
        const clampCenter = sPt.clone().add(norm.clone().multiplyScalar(sideSign * (frameOffset + 12.0)));
        clampCenter.y = workingY;
        const cl = step.addSolidBox(clampCenter, tan, norm, 14.0, 12.0, 10.0, `Guide_Frame_Clamp_${sName}_${b + 1}`, hardwareColor);
        solids.push(cl.brep); styledItems.push(cl.styledItem);

        // Vertical post (12 mm dia)
        const rodH = (guideY - workingY) + 35.0;
        const rodCenter = clampCenter.clone(); rodCenter.y = workingY + rodH / 2.0 - 10.0;
        const vr = step.addSolidCylinder(rodCenter, new StepVector3(0, 1, 0), 6.0, rodH, `Guide_Vertical_Post_${sName}_${b + 1}`, hardwareColor, 12);
        solids.push(vr.brep); styledItems.push(vr.styledItem);

        // Dual-bore Cross Clamp
        const upClamp = clampCenter.clone(); upClamp.y = guideY;
        const uc = step.addSolidBox(upClamp, tan, norm, 14.0, 14.0, 16.0, `Guide_Cross_Clamp_${sName}_${b + 1}`, hardwareColor);
        solids.push(uc.brep); styledItems.push(uc.styledItem);

        // Angled Rotary Locking Lever Handle
        const leverStemDir = norm.clone().multiplyScalar(sideSign * 0.707).add(new StepVector3(0.0, -0.707, 0.0)).normalize();
        const leverStemCenter = upClamp.clone().add(leverStemDir.clone().multiplyScalar(30.0));
        const lStem = step.addSolidCylinder(leverStemCenter, leverStemDir, 3.5, 60.0, `Guide_Lever_Stem_${sName}_${b + 1}`, hardwareColor, 12);
        solids.push(lStem.brep); styledItems.push(lStem.styledItem);
        const knobCenter = upClamp.clone().add(leverStemDir.clone().multiplyScalar(60.0));
        const knob = step.addSolidCylinder(knobCenter, leverStemDir, 8.0, 20.0, `Guide_Lever_Knob_${sName}_${b + 1}`, knobBlackColor, 16);
        solids.push(knob.brep); styledItems.push(knob.styledItem);

        // Horizontal cross arm
        const rodArmLen = Math.abs((frameOffset + 12.0) - (guideOffset + 8.0)) + 20.0;
        const horizRodCenter = sPt.clone().add(norm.clone().multiplyScalar(sideSign * ((frameOffset + 12.0 + guideOffset + 8.0) / 2.0)));
        horizRodCenter.y = guideY;
        const hr = step.addSolidCylinder(horizRodCenter, norm, 6.0, rodArmLen, `Guide_Horiz_Arm_${sName}_${b + 1}`, hardwareColor, 12);
        solids.push(hr.brep); styledItems.push(hr.styledItem);

        // Rail Clamp Shoe
        const shoeCenter = sPt.clone().add(norm.clone().multiplyScalar(sideSign * (guideOffset + 8.0)));
        shoeCenter.y = guideY;
        const shoe = step.addSolidBox(shoeCenter, tan, norm, 10.0, 5.0, 12.0, `Guide_Rail_Shoe_${sName}_${b + 1}`, hardwareColor);
        solids.push(shoe.brep); styledItems.push(shoe.styledItem);
      }
    }
  }

  // 5. SUPPORT STANDS (4 Stands strictly matching media_1790878744985.png)
  if (wh?.enabled && wh.type !== 'without-support') {
    const footType = wh.footType || 'adjustable';
    const isWheel = footType === 'wheel-without-brake' || footType === 'wheel-with-brake';
    const footClearance = isWheel ? 76.0 : (footType === 'fixed' || footType === 'base-plate' ? 16.0 : 30.0);

    const topBeamW = trackWidth + profileWidth * 2.0 + 20.0;
    const colH = Math.max(100.0, workingY - 40.0 - 40.0 - footClearance);
    const baseBeamW = 460.0;
    const feetSpacingHalf = 190.0;

    const curveSegs = path.segments.filter((s) => s.type === 'curve');
    let standDists: number[] = [];
    const maxSpan = 2000.0;
    if (curveSegs.length === 0) {
      // Linear straight conveyor
      const totalLen = path.totalLength;
      if (totalLen <= 600) {
        standDists = [totalLen / 2];
      } else {
        const infeedPos = Math.min(250.0, totalLen * 0.2);
        const drivePos = Math.max(infeedPos + 300.0, totalLen - 280.0);
        const middleSpan = drivePos - infeedPos;
        standDists.push(infeedPos);
        if (middleSpan > maxSpan) {
          const numInter = Math.floor(middleSpan / maxSpan);
          const step = middleSpan / (numInter + 1);
          for (let k = 1; k <= numInter; k++) {
            standDists.push(infeedPos + k * step);
          }
        }
        standDists.push(drivePos);
      }
    } else {
      // Multi-segment curved conveyor
      for (let sIdx = 0; sIdx < path.segments.length; sIdx++) {
        const seg = path.segments[sIdx];
        const isFirst = sIdx === 0;
        const isLast = sIdx === path.segments.length - 1;

        if (seg.type === 'straight') {
          const segLen = seg.length;
          let startStand: number;
          let endStand: number;

          if (isFirst) {
            startStand = seg.startDistance + Math.min(250.0, segLen * 0.25);
            endStand = seg.endDistance - Math.min(120.0, segLen * 0.15);
          } else if (isLast) {
            startStand = seg.startDistance + Math.min(120.0, segLen * 0.15);
            endStand = seg.endDistance - Math.min(280.0, segLen * 0.25);
          } else {
            startStand = seg.startDistance + Math.min(120.0, segLen * 0.15);
            endStand = seg.endDistance - Math.min(120.0, segLen * 0.15);
          }

          if (endStand - startStand >= 300.0) {
            standDists.push(startStand);
            const span = endStand - startStand;
            if (span > maxSpan) {
              const numInter = Math.floor(span / maxSpan);
              const step = span / (numInter + 1);
              for (let k = 1; k <= numInter; k++) {
                standDists.push(startStand + k * step);
              }
            }
            standDists.push(endStand);
          } else {
            standDists.push((seg.startDistance + seg.endDistance) / 2);
          }
        }
      }
    }

    standDists.sort((a, b) => a - b);
    const filteredStands: number[] = [];
    for (const d of standDists) {
      if (filteredStands.length === 0 || d - filteredStands[filteredStands.length - 1] >= 200.0) {
        filteredStands.push(Math.round(d));
      }
    }
    standDists = filteredStands.map((d) => Math.max(40.0, Math.min(path.totalLength - 40.0, d)));

    for (let s = 0; s < standDists.length; s++) {
      const targetD = standDists[s];
      const sample = path.getSampleAtDistance(targetD);
      const tan = new StepVector3(sample.tangent.x, sample.tangent.y, sample.tangent.z);
      const norm = new StepVector3(sample.normal.x, sample.normal.y, sample.normal.z);
      const sPt = new StepVector3(sample.point.x, 0, sample.point.z);

      // 5A. Black Side Profile Mounting Bracket Clamps (Strictly matching Image 4, 5 & bracket-support.png)
      for (const [sideSign, sName] of [[-1.0, 'L'], [1.0, 'R']] as const) {
        const brkC = sPt.clone().add(norm.clone().multiplyScalar(sideSign * frameOffset));
        brkC.y = workingY - 30.0;
        const brk = step.addSolidBox(brkC, tan, norm, 45.0, 16.0, 30.0, `Support_Bracket_${sName}_${s + 1}`, knobBlackColor);
        solids.push(brk.brep); styledItems.push(brk.styledItem);
      }

      // 5A. U-Cradle Mounting Bracket clamping 92 mm profile (Image Mechanical Adjustable leg.png)
      const uBaseC = sPt.clone();
      uBaseC.y = workingY - 50.0; // Directly under 92 mm profile bottom (workingY - 46.0)
      const uW = (trackWidth + profileWidth * 2.0 + 8.0) / 2.0;
      const uBase = step.addSolidBox(uBaseC, tan, norm, 45.0, uW, 8.0, `Support_U_Cradle_Base_${s + 1}`, knobBlackColor);
      solids.push(uBase.brep); styledItems.push(uBase.styledItem);

      // Left and Right vertical clamping ears of U-cradle with T-slot clamp bolts
      for (const [sideSign, sName] of [[-1.0, 'L'], [1.0, 'R']] as const) {
        const earC = sPt.clone().add(norm.clone().multiplyScalar(sideSign * (uW - 4.0)));
        earC.y = workingY - 20.0;
        const ear = step.addSolidBox(earC, tan, norm, 45.0, 4.0, 30.0, `Support_U_Ear_${sName}_${s + 1}`, knobBlackColor);
        solids.push(ear.brep); styledItems.push(ear.styledItem);

        // Clamping bolts into frame T-slot (2 per ear)
        const boltC = earC.clone().add(norm.clone().multiplyScalar(sideSign * 5.0));
        boltC.y = workingY - 10.0;
        const bTop = step.addSolidCylinder(boltC, norm, 6.0, 8.0, `Support_Clamp_Bolt_Top_${sName}_${s + 1}`, hardwareColor, 10);
        solids.push(bTop.brep); styledItems.push(bTop.styledItem);
        const boltC2 = boltC.clone(); boltC2.y = workingY - 30.0;
        const bBtm = step.addSolidCylinder(boltC2, norm, 6.0, 8.0, `Support_Clamp_Bolt_Btm_${sName}_${s + 1}`, hardwareColor, 10);
        solids.push(bBtm.brep); styledItems.push(bBtm.styledItem);
      }

      // 5B. Top Mount Head Plate connecting U-cradle to column
      const topCollarC = sPt.clone();
      topCollarC.y = workingY - 58.0;
      const topCollar = step.addSolidBox(topCollarC, tan, norm, 60.0, 50.0, 8.0, `Support_Top_Collar_${s + 1}`, supportColor);
      solids.push(topCollar.brep); styledItems.push(topCollar.styledItem);

      // 5C. Column Assembly: Authentic Linak DL5 Motorized Electric Column or Telescoping Mechanical Stand
      const isElectric = wh.type === 'electrically-adjustable';
      if (isElectric) {
        // Authentic Linak DL5 Motorized Electric Telescopic Column (Image 1, 2, 3: 804-125-Linak_DL5)
        // Outer Lower Sleeve (50x80 mm dark anthracite profile)
        const outerH = colH * 0.65;
        const outerC = sPt.clone();
        outerC.y = (footClearance + 90.0) + outerH / 2.0;
        const oSleeve = step.addSolidBox(outerC, tan, norm, 25.0, 40.0, outerH / 2.0, `Linak_DL5_Outer_Sleeve_${s + 1}`, [0.20, 0.22, 0.24]);
        solids.push(oSleeve.brep); styledItems.push(oSleeve.styledItem);

        // Inner Upper Telescoping Column (44x74 mm)
        const innerH = colH * 0.55;
        const innerC = sPt.clone();
        innerC.y = workingY - 65.0 - innerH / 2.0;
        const iTube = step.addSolidBox(innerC, tan, norm, 22.0, 37.0, innerH / 2.0, `Linak_DL5_Inner_Tube_${s + 1}`, [0.32, 0.35, 0.38]);
        solids.push(iTube.brep); styledItems.push(iTube.styledItem);

        // Telescopic Collar Ring at joint
        const collarC = sPt.clone(); collarC.y = outerC.y + outerH / 2.0 - 10.0;
        const collar = step.addSolidBox(collarC, tan, norm, 28.0, 43.0, 10.0, `Linak_DL5_Collar_${s + 1}`, knobBlackColor);
        solids.push(collar.brep); styledItems.push(collar.styledItem);

        // Top Angled Steel Mounting Bracket (clamping to conveyor frame with M8 bolts)
        const brkC = sPt.clone(); brkC.y = workingY - 35.0;
        const brk = step.addSolidBox(brkC, tan, norm, 35.0, (trackWidth + 50.0) / 2.0, 4.0, `Linak_Mount_Plate_${s + 1}`, [0.12, 0.12, 0.14]);
        solids.push(brk.brep); styledItems.push(brk.styledItem);

        // Linak CBD6s Motor Control Box clamped to the column (150x85x36 mm black box)
        const boxC = outerC.clone().add(norm.clone().multiplyScalar(58.0));
        boxC.y = outerC.y + 20.0;
        const cbox = step.addSolidBox(boxC, tan, norm, 42.0, 18.0, 75.0, `Linak_CBD6s_Control_Box_${s + 1}`, [0.08, 0.08, 0.09]);
        solids.push(cbox.brep); styledItems.push(cbox.styledItem);

        // Linak DPA Rocker Switch on column
        const switchC = outerC.clone().add(norm.clone().multiplyScalar(-48.0));
        switchC.y = outerC.y + outerH / 2.0 - 25.0;
        const dpa = step.addSolidBox(switchC, tan, norm, 20.0, 10.0, 15.0, `Linak_DPA_Switch_${s + 1}`, [0.15, 0.15, 0.16]);
        solids.push(dpa.brep); styledItems.push(dpa.styledItem);
      } else {
        // Telescoping Vertical Structural Extrusion Column (Image Mechanical Adjustable leg.png)
        const colColor: [number, number, number] = [0.75, 0.77, 0.80];
        const innerColH = colH * 0.55;
        const innerColC = sPt.clone();
        innerColC.y = (workingY - 62.0) - innerColH / 2.0;
        const innerCol = step.addSolidBox(innerColC, tan, norm, 40.0, 25.0, innerColH / 2.0, `Support_Inner_Column_${s + 1}`, supportColor);
        solids.push(innerCol.brep); styledItems.push(innerCol.styledItem);

        // Lower outer column tube (80x50 sleeve resting directly on foot beam at Y=90)
        const outerColH = Math.max(80.0, workingY - 62.0 - 90.0);
        const outerColC = sPt.clone();
        outerColC.y = 90.0 + outerColH / 2.0;
        const outerCol = step.addSolidBox(outerColC, tan, norm, 55.0, 38.0, outerColH / 2.0, `Support_Outer_Column_${s + 1}`, colColor);
        solids.push(outerCol.brep); styledItems.push(outerCol.styledItem);

        // Clamping sleeve collar with 4 socket bolts at telescoping joint
        const clampSleeveC = sPt.clone();
        clampSleeveC.y = outerColC.y + outerColH / 2.0 - 15.0;
        const clampSleeve = step.addSolidBox(clampSleeveC, tan, norm, 60.0, 42.0, 25.0, `Support_Clamp_Sleeve_${s + 1}`, supportColor);
        solids.push(clampSleeve.brep); styledItems.push(clampSleeve.styledItem);

        for (const [bYOff, bN] of [[-8.0, 'Btm'], [8.0, 'Top']] as const) {
          for (const [bS, bSN] of [[-1.0, 'L'], [1.0, 'R']] as const) {
            const bPos = clampSleeveC.clone().add(norm.clone().multiplyScalar(bS * 25.0));
            bPos.y += bYOff;
            const slvB = step.addSolidCylinder(bPos, norm, 5.0, 10.0, `Support_Sleeve_Bolt_${bN}_${bSN}_${s + 1}`, hardwareColor, 10);
            solids.push(slvB.brep); styledItems.push(slvB.styledItem);
          }
        }

        // 2 Base mounting bolts into foot beam (Image 3)
        for (const [bYPos, bN] of [[110.0, 'Lower'], [135.0, 'Upper']] as const) {
          const bSide = sPt.clone().add(norm.clone().multiplyScalar(22.0));
          bSide.y = bYPos;
          const bMesh = step.addSolidCylinder(bSide, norm, 5.0, 8.0, `Support_Base_Bolt_${bN}_${s + 1}`, hardwareColor, 10);
          solids.push(bMesh.brep); styledItems.push(bMesh.styledItem);
        }
      }

      // 5D. Base Support Structure: Heavy-Duty 45x90 Profile Mobile Tripod Base or Base Beam
      if (isWheel) {
        // Authentic Alutec Heavy-Duty 45x90 Base Frame (Images 1, 2, 3: 804-125-30-noha)
        const baseY = 65.0;
        const bbCenter = sPt.clone(); bbCenter.y = baseY;
        const bb = step.addSolidBox(bbCenter, tan, norm, 22.5, baseBeamW / 2.0, 45.0, `Support_45x90_Base_Beam_${s + 1}`, supportColor);
        solids.push(bb.brep); styledItems.push(bb.styledItem);

        // Forward Cantilever Foot Beam (45x90 profile extending 220 mm forward for tip stability)
        const cantCenter = sPt.clone().add(tan.clone().multiplyScalar(110.0));
        cantCenter.y = baseY;
        const cant = step.addSolidBox(cantCenter, tan, norm, 110.0, 22.5, 45.0, `Support_45x90_Cantilever_Foot_${s + 1}`, supportColor);
        solids.push(cant.brep); styledItems.push(cant.styledItem);

        // Diagonal Gusset Brackets (black steel corner reinforcement)
        for (const [gSign, gName] of [[-1.0, 'Left'], [1.0, 'Right']] as const) {
          const gussetC = sPt.clone().add(norm.clone().multiplyScalar(gSign * 55.0));
          gussetC.y = baseY + 45.0 + 20.0;
          const gusset = step.addSolidBox(gussetC, tan, norm, 20.0, 8.0, 20.0, `Base_Gusset_${gName}_${s + 1}`, knobBlackColor);
          solids.push(gusset.brep); styledItems.push(gusset.styledItem);
        }

        // 3 Heavy-Duty Swivel Braked Castor Wheels (517508 with brake pedals)
        const castorPositions: Array<[StepVector3, string]> = [
          [sPt.clone().add(norm.clone().multiplyScalar(-feetSpacingHalf)), 'Rear_Left'],
          [sPt.clone().add(norm.clone().multiplyScalar(feetSpacingHalf)), 'Rear_Right'],
          [sPt.clone().add(tan.clone().multiplyScalar(200.0)), 'Front_Center']
        ];

        for (const [cPos, cName] of castorPositions) {
          // Swivel Top Flange Plate
          const cTop = cPos.clone(); cTop.y = 54.0;
          const flg = step.addSolidBox(cTop, tan, norm, 28.0, 28.0, 3.0, `Castor_Flange_${cName}_${s + 1}`, hardwareColor);
          solids.push(flg.brep); styledItems.push(flg.styledItem);

          // Swivel Fork Bracket Housing
          const forkC = cPos.clone(); forkC.y = 38.0;
          const fork = step.addSolidBox(forkC, tan, norm, 18.0, 22.0, 16.0, `Castor_Fork_${cName}_${s + 1}`, [0.85, 0.87, 0.90]);
          solids.push(fork.brep); styledItems.push(fork.styledItem);

          // Polyurethane Tyre / Rubber Wheel (Ø75 mm)
          const whlC = cPos.clone(); whlC.y = 24.0;
          const whl = step.addSolidCylinder(whlC, norm, 37.5, 32.0, `Castor_Wheel_${cName}_${s + 1}`, [0.12, 0.12, 0.14], 18);
          solids.push(whl.brep); styledItems.push(whl.styledItem);

          // Integrated Brake Step Pedal (angled zinc-plated stamping)
          const pedalC = cPos.clone().add(tan.clone().multiplyScalar(28.0));
          pedalC.y = 32.0;
          const pedal = step.addSolidBox(pedalC, tan, norm, 14.0, 12.0, 4.0, `Castor_Brake_Pedal_${cName}_${s + 1}`, hardwareColor);
          solids.push(pedal.brep); styledItems.push(pedal.styledItem);
        }
      } else {
        // Base Horizontal Foot Profile Beam (80 x 40 mm profile resting above floor level: Y=50 to 90 mm)
        const bbCenter = sPt.clone(); bbCenter.y = 70.0;
        const bb = step.addSolidBox(bbCenter, tan, norm, 40.0, baseBeamW / 2.0, 20.0, `Support_Base_Foot_Beam_${s + 1}`, supportColor);
        solids.push(bb.brep); styledItems.push(bb.styledItem);

        // Black Plastic End Caps on base beam ends (Image 4 & 5)
        for (const [capSign, capName] of [[-1.0, 'L'], [1.0, 'R']] as const) {
          const capC = sPt.clone().add(norm.clone().multiplyScalar(capSign * (baseBeamW / 2.0 + 2.0)));
          capC.y = 70.0;
          const cap = step.addSolidBox(capC, tan, norm, 42.0, 2.0, 21.0, `Support_Foot_Cap_${capName}_${s + 1}`, knobBlackColor);
          solids.push(cap.brep); styledItems.push(cap.styledItem);
        }

        // Two Leveling Feet at ends of base foot beam
        for (const [fSign, fName] of [[-1.0, 'Left'], [1.0, 'Right']] as const) {
          const footX = sPt.clone().add(norm.clone().multiplyScalar(fSign * feetSpacingHalf));

          // Foot mounting plate clamped to underside of base profile
          const fplateC = footX.clone(); fplateC.y = 47.0;
          const fpl = step.addSolidBox(fplateC, tan, norm, 25.0, 15.0, 3.0, `Leveling_Foot_Mount_Plate_${fName}_${s + 1}`, supportColor);
          solids.push(fpl.brep); styledItems.push(fpl.styledItem);

          // Articulated Leveling Foot: pad resting on floor Y=0 to 12 mm
          const padCenter = footX.clone(); padCenter.y = 6.0;
          const pad = step.addSolidCylinder(padCenter, new StepVector3(0, 1, 0), 35.0, 12.0, `Leveling_Foot_Pad_${fName}_${s + 1}`, knobBlackColor, 18);
          solids.push(pad.brep); styledItems.push(pad.styledItem);

          for (const [hSign, hN] of [[-1.0, 'Fwd'], [1.0, 'Aft']] as const) {
            const earHoleC = padCenter.clone().add(tan.clone().multiplyScalar(hSign * 25.0));
            earHoleC.y = 8.0;
            const eh = step.addSolidCylinder(earHoleC, new StepVector3(0, 1, 0), 5.0, 8.0, `Leveling_Anchor_Ear_${hN}_${fName}_${s + 1}`, knobBlackColor, 10);
            solids.push(eh.brep); styledItems.push(eh.styledItem);
          }

          // Hex Nut on spindle
          const nutCenter = footX.clone(); nutCenter.y = 16.0;
          const nut = step.addSolidCylinder(nutCenter, new StepVector3(0, 1, 0), 11.0, 8.0, `Leveling_Hex_Nut_${fName}_${s + 1}`, hardwareColor, 6);
          solids.push(nut.brep); styledItems.push(nut.styledItem);

          // Threaded Spindle stud connecting pad to base beam
          const spindleCenter = footX.clone(); spindleCenter.y = 30.0;
          const sp = step.addSolidCylinder(spindleCenter, new StepVector3(0, 1, 0), 8.0, 40.0, `Leveling_Spindle_${fName}_${s + 1}`, hardwareColor, 12);
          solids.push(sp.brep); styledItems.push(sp.styledItem);
        }
      }
    }
  }

  // 6. DRIVE UNIT & MOTOR ASSEMBLY (Strictly matching client reference Image 1 & Image 4)
  const drivePos = config.drivePosition || 'left';
  const isStart = drivePos.startsWith('start') || drivePos === 'below-belt-start' || drivePos === 'beginning';
  const driveSample = isStart ? path.samples[0] : path.samples[path.samples.length - 1];
  const idlerSample = isStart ? path.samples[path.samples.length - 1] : path.samples[0];

  const dTan = new StepVector3(driveSample.tangent.x, driveSample.tangent.y, driveSample.tangent.z);
  const dNorm = new StepVector3(driveSample.normal.x, driveSample.normal.y, driveSample.normal.z);
  const dPt = new StepVector3(driveSample.point.x, 0, driveSample.point.z);

  // Drive Shaft Center (tangentially offset so sprocket clears the 92 mm profile end by 2 mm)
  const driveTanSign = isStart ? -1.0 : 1.0;
  const driveShaftBase = dPt.clone().add(dTan.clone().multiplyScalar(driveTanSign * terminalShaftFwd));
  driveShaftBase.y = terminalShaftY;

  const isLeftDrive = drivePos.includes('left') || drivePos === 'left';
  const driveSideSign = isLeftDrive ? -1.0 : 1.0;
  const shaftLen = (trackWidth + profileWidth * 2.0 + 16.0) + 22.0;
  const shaftCenter = driveShaftBase.clone().add(dNorm.clone().multiplyScalar(driveSideSign * 11.0));
  const sh = step.addSolidCylinder(shaftCenter, dNorm, 12.5, shaftLen, 'Drive_Main_Shaft', hardwareColor, 16);
  solids.push(sh.brep); styledItems.push(sh.styledItem);

  // Drive Sprocket Wheel (diameter 96 mm, width 35 mm, 48 mm radius perfectly tangential to chain)
  const dsp = step.addSolidCylinder(driveShaftBase, dNorm, terminalSprocketR, 35.0, 'Drive_Sprocket_Wheel', [0.22, 0.25, 0.28], 19);
  solids.push(dsp.brep); styledItems.push(dsp.styledItem);

  // White UHMW Cheek Plates flanking the drive sprocket (Image 1, 2, 4)
  for (const [sign, chkName] of [[-1.0, 'Left'], [1.0, 'Right']] as const) {
    const chkC = driveShaftBase.clone().add(dTan.clone().multiplyScalar(-driveTanSign * 15.0));
    chkC.add(dNorm.clone().multiplyScalar(sign * (halfTrack + profileWidth / 2.0 + 3.0)));
    const cp = step.addSolidBox(chkC, dTan, dNorm, 35.0, 6.0, 48.0, `Drive_${chkName}_Cheek_Plate`, [0.93, 0.94, 0.96]);
    solids.push(cp.brep); styledItems.push(cp.styledItem);
    const chkNose = driveShaftBase.clone().add(dNorm.clone().multiplyScalar(sign * (halfTrack + profileWidth / 2.0 + 3.0)));
    const cNose = step.addSolidCylinder(chkNose, dNorm, 54.0, 6.0, `Drive_${chkName}_Cheek_Nose`, [0.93, 0.94, 0.96], 18);
    solids.push(cNose.brep); styledItems.push(cNose.styledItem);
  }

  const isBelowBelt = drivePos.includes('below-belt') || drivePos.startsWith('below');
  if (isBelowBelt) {
    // Underslung / below-belt drive
    for (const [sign, brkName] of [[-1.0, 'Left'], [1.0, 'Right']] as const) {
      const ubrkC = driveShaftBase.clone().add(dNorm.clone().multiplyScalar(sign * (halfTrack + profileWidth / 2.0)));
      ubrkC.y = workingY - 55.0;
      const ubrk = step.addSolidBox(ubrkC, dTan, dNorm, 60.0, 6.0, 45.0, `Under_Mount_Bracket_${brkName}`, [0.15, 0.16, 0.18]);
      solids.push(ubrk.brep); styledItems.push(ubrk.styledItem);
    }

    const xbarC = driveShaftBase.clone(); xbarC.y = workingY - 75.0;
    const xbar = step.addSolidBox(xbarC, dTan, dNorm, 30.0, trackWidth + profileWidth * 2.0, 15.0, 'Under_Drive_Cross_Bar', [0.15, 0.16, 0.18]);
    solids.push(xbar.brep); styledItems.push(xbar.styledItem);

    const gbCenter = driveShaftBase.clone(); gbCenter.y = workingY - 100.0;
    const gb = step.addSolidBox(gbCenter, dTan, dNorm, 55.0, 60.0, 48.0, 'Motor_Gearbox_Housing', motorSilver);
    solids.push(gb.brep); styledItems.push(gb.styledItem);

    const hubCenter = gbCenter.clone(); hubCenter.y += 18.0;
    const hub = step.addSolidCylinder(hubCenter, new StepVector3(0, 1, 0), 22.0, 24.0, 'Gearbox_Drive_Hub', hardwareColor, 16);
    solids.push(hub.brep); styledItems.push(hub.styledItem);

    const interC = gbCenter.clone(); interC.y -= (24.0 + 7.0);
    const interRing = step.addSolidCylinder(interC, new StepVector3(0.0, -1.0, 0.0), 57.0, 14.0, 'Motor_Intermediate_Flange', motorFlangeColor, 18);
    solids.push(interRing.brep); styledItems.push(interRing.styledItem);

    const motorBodyCenter = interC.clone(); motorBodyCenter.y -= (7.0 + 65.0);
    const mb = step.addSolidCylinder(motorBodyCenter, new StepVector3(0.0, -1.0, 0.0), 56.0, 130.0, 'Motor_Stator_Body', motorSilver, 18);
    solids.push(mb.brep); styledItems.push(mb.styledItem);

    for (let finI = 0; finI < 10; finI++) {
      const finAng = (2.0 * Math.PI * finI) / 10.0;
      const finOffset = new StepVector3(Math.cos(finAng) * 58.0, 0.0, Math.sin(finAng) * 58.0);
      const finC = motorBodyCenter.clone().add(finOffset);
      const fin = step.addSolidBox(finC, dTan, dNorm, 2.5, 2.5, 60.0, `Motor_Cooling_Fin_${finI + 1}`, motorSilver);
      solids.push(fin.brep); styledItems.push(fin.styledItem);
    }

    const juncCenter = motorBodyCenter.clone().add(dNorm.clone().multiplyScalar(60.0));
    const tBox = step.addSolidBox(juncCenter, dTan, dNorm, 28.0, 18.0, 24.0, 'Motor_Terminal_Box', terminalBoxColor);
    solids.push(tBox.brep); styledItems.push(tBox.styledItem);

    const plugC = motorBodyCenter.clone().add(dNorm.clone().multiplyScalar(56.0)).add(dTan.clone().multiplyScalar(28.0));
    const sPlug = step.addSolidCylinder(plugC, dTan, 11.0, 4.0, 'Motor_Side_Access_Plug', knobBlackColor, 12);
    solids.push(sPlug.brep); styledItems.push(sPlug.styledItem);

    const fanCenter = motorBodyCenter.clone(); fanCenter.y -= (65.0 + 26.0);
    const fan = step.addSolidCylinder(fanCenter, new StepVector3(0.0, -1.0, 0.0), 57.5, 52.0, 'Motor_Fan_Shroud', motorFanColor, 18);
    solids.push(fan.brep); styledItems.push(fan.styledItem);

  } else {
    // Side Drive (Left or Right)
    for (const [sSide, sName] of [[-1.0, 'Left'], [1.0, 'Right']] as const) {
      const pOffset = sSide * (halfTrack + profileWidth + 8.0);
      const pCenter = driveShaftBase.clone().add(dTan.clone().multiplyScalar(-driveTanSign * 35.0));
      pCenter.add(dNorm.clone().multiplyScalar(pOffset));
      pCenter.y = workingY - 20.0;
      const dmpBody = step.addSolidBox(pCenter, dTan, dNorm, 55.0, 4.0, 65.0, `Drive_${sName}_Mounting_Plate_Body`, [0.15, 0.16, 0.18]);
      solids.push(dmpBody.brep); styledItems.push(dmpBody.styledItem);
      const pNose = driveShaftBase.clone().add(dNorm.clone().multiplyScalar(pOffset));
      const nose = step.addSolidCylinder(pNose, dNorm, 70.0, 8.0, `Drive_${sName}_Mounting_Plate_Contour`, [0.15, 0.16, 0.18], 18);
      solids.push(nose.brep); styledItems.push(nose.styledItem);

      // Rear Connecting Plate attaching drive plate to 92 mm profile
      const dConnC = dPt.clone().add(dNorm.clone().multiplyScalar(pOffset));
      dConnC.add(dTan.clone().multiplyScalar(-driveTanSign * 40.0));
      dConnC.y = workingY - 20.0;
      const dConn = step.addSolidBox(dConnC, dTan, dNorm, 28.0, 4.0, 35.0, `Drive_${sName}_Conn_Plate`, [0.93, 0.94, 0.96]);
      solids.push(dConn.brep); styledItems.push(dConn.styledItem);

      // 4 Button-head clamp bolts on drive plate
      for (const [dbY, dbN] of [[-12.0, 'Top'], [-32.0, 'Btm']] as const) {
        for (const [dbX, dbXN] of [[-25.0, 'Rear'], [15.0, 'Mid']] as const) {
          const dbC = pCenter.clone().add(dTan.clone().multiplyScalar(dbX));
          dbC.add(dNorm.clone().multiplyScalar(sSide * 3.0));
          dbC.y = workingY + dbY;
          const dBolt = step.addSolidCylinder(dbC, dNorm, 5.0, 6.0, `Drive_${sName}_Bolt_${dbN}_${dbXN}`, hardwareColor, 10);
          solids.push(dBolt.brep); styledItems.push(dBolt.styledItem);
        }
      }
    }

    // Flanged Bearing Housing Boss on opposite side of motor
    const oppSide = -driveSideSign;
    const bossOffset = oppSide * (halfTrack + profileWidth + 8.0) + oppSide * 8.0;
    const bossCenter = driveShaftBase.clone().add(dNorm.clone().multiplyScalar(bossOffset));
    const boss = step.addSolidCylinder(bossCenter, dNorm, 37.5, 14.0, 'Drive_Bearing_Housing_Boss', [0.25, 0.28, 0.32], 16);
    solids.push(boss.brep); styledItems.push(boss.styledItem);

    // Gearbox Output Flange
    const plateOffset = driveSideSign * (halfTrack + profileWidth + 8.0);
    const flangeOffset = plateOffset + driveSideSign * 22.0;
    const flangeCenter = driveShaftBase.clone().add(dNorm.clone().multiplyScalar(flangeOffset));
    const gbFlange = step.addSolidCylinder(flangeCenter, dNorm, 58.0, 12.0, 'Gearbox_Output_Mounting_Flange', motorSilver, 18);
    solids.push(gbFlange.brep); styledItems.push(gbFlange.styledItem);

    const pcdR = 42.5;
    for (const [bAng, bName] of [[0.0, 'Top'], [Math.PI / 2, 'Front'], [Math.PI, 'Bottom'], [3 * Math.PI / 2, 'Back']] as const) {
      const bOffset = dTan.clone().multiplyScalar(Math.sin(bAng) * pcdR);
      bOffset.y += Math.cos(bAng) * pcdR;
      const bossHoleC = flangeCenter.clone().add(bOffset);
      const bHole = step.addSolidCylinder(bossHoleC, dNorm, 7.5, 14.0, `Gearbox_Bolt_Boss_${bName}`, motorSilver, 10);
      solids.push(bHole.brep); styledItems.push(bHole.styledItem);
    }

    for (const [gAng, gName] of [[Math.PI / 4, 'TF'], [3 * Math.PI / 4, 'BF'], [5 * Math.PI / 4, 'BB'], [7 * Math.PI / 4, 'TB']] as const) {
      const gDir = dTan.clone().multiplyScalar(Math.sin(gAng) * 32.0);
      gDir.y += Math.cos(gAng) * 32.0;
      const gussetRfC = flangeCenter.clone().add(gDir);
      const gRf = step.addSolidBox(gussetRfC, dTan, dNorm, 6.0, 5.0, 6.0, `Gearbox_Gusset_${gName}`, motorSilver);
      solids.push(gRf.brep); styledItems.push(gRf.styledItem);
    }

    const motorOffset = plateOffset + driveSideSign * 65.0;
    const motorBasePt = driveShaftBase.clone().add(dNorm.clone().multiplyScalar(motorOffset));
    const gbCenter = motorBasePt.clone();
    const gb = step.addSolidBox(gbCenter, dTan, dNorm, 50.0, 38.0, 44.0, 'Motor_Gearbox_Housing', motorSilver);
    solids.push(gb.brep); styledItems.push(gb.styledItem);

    for (let rI = 0; rI < 4; rI++) {
      const ribC = gbCenter.clone(); ribC.y += 45.0 + rI * 3.5;
      const gbRib = step.addSolidBox(ribC, dTan, dNorm, 42.0, 32.0, 1.25, `Gearbox_Cooling_Rib_${rI + 1}`, motorSilver);
      solids.push(gbRib.brep); styledItems.push(gbRib.styledItem);
    }

    const breatherC = gbCenter.clone(); breatherC.y += 62.0;
    const brCap = step.addSolidCylinder(breatherC, new StepVector3(0, 1, 0), 9.0, 18.0, 'Gearbox_Breather_Plug', motorSilver, 12);
    solids.push(brCap.brep); styledItems.push(brCap.styledItem);

    const interC = gbCenter.clone(); interC.y -= (44.0 + 7.0);
    const interRing = step.addSolidCylinder(interC, new StepVector3(0.0, -1.0, 0.0), 57.0, 14.0, 'Motor_Intermediate_Flange', motorFlangeColor, 18);
    solids.push(interRing.brep); styledItems.push(interRing.styledItem);

    const motorBodyCenter = interC.clone(); motorBodyCenter.y -= (7.0 + 65.0);
    const mb = step.addSolidCylinder(motorBodyCenter, new StepVector3(0.0, -1.0, 0.0), 56.0, 130.0, 'Motor_Stator_Body', motorSilver, 18);
    solids.push(mb.brep); styledItems.push(mb.styledItem);

    for (let finI = 0; finI < 10; finI++) {
      const finAng = (2.0 * Math.PI * finI) / 10.0;
      const finOffset = new StepVector3(Math.cos(finAng) * 58.0, 0.0, Math.sin(finAng) * 58.0);
      const finC = motorBodyCenter.clone().add(finOffset);
      const fin = step.addSolidBox(finC, dTan, dNorm, 2.5, 2.5, 60.0, `Motor_Cooling_Fin_${finI + 1}`, motorSilver);
      solids.push(fin.brep); styledItems.push(fin.styledItem);
    }

    const juncCenter = motorBodyCenter.clone().add(dNorm.clone().multiplyScalar(driveSideSign * 62.0));
    const tBox = step.addSolidBox(juncCenter, dTan, dNorm, 28.0, 18.0, 24.0, 'Motor_Terminal_Box', terminalBoxColor);
    solids.push(tBox.brep); styledItems.push(tBox.styledItem);

    const plugC = motorBodyCenter.clone().add(dNorm.clone().multiplyScalar(driveSideSign * 57.0)).add(dTan.clone().multiplyScalar(28.0));
    const sPlug = step.addSolidCylinder(plugC, dTan, 11.0, 4.0, 'Motor_Side_Access_Plug', knobBlackColor, 12);
    solids.push(sPlug.brep); styledItems.push(sPlug.styledItem);

    const fanCenter = motorBodyCenter.clone(); fanCenter.y -= (65.0 + 26.0);
    const fan = step.addSolidCylinder(fanCenter, new StepVector3(0.0, -1.0, 0.0), 57.5, 52.0, 'Motor_Fan_Shroud', motorFanColor, 18);
    solids.push(fan.brep); styledItems.push(fan.styledItem);
  }

  // 7. INFEED IDLER RETURN TERMINAL UNIT (Strictly matching Image 3: conveyor-idler-end-bracket.png and 82.5 Non Motor side head.png)
  const iTan = new StepVector3(idlerSample.tangent.x, idlerSample.tangent.y, idlerSample.tangent.z);
  const iNorm = new StepVector3(idlerSample.normal.x, idlerSample.normal.y, idlerSample.normal.z);
  const iPt = new StepVector3(idlerSample.point.x, 0, idlerSample.point.z);

  const idlerTanSign = isStart ? 1.0 : -1.0;
  const idlerShaftCenter = iPt.clone().add(iTan.clone().multiplyScalar(idlerTanSign * terminalShaftFwd));
  idlerShaftCenter.y = terminalShaftY;

  for (const [sign, bName] of [[-1.0, 'Left'], [1.0, 'Right']] as const) {
    const chkC = idlerShaftCenter.clone().add(iTan.clone().multiplyScalar(-idlerTanSign * 15.0));
    chkC.add(iNorm.clone().multiplyScalar(sign * (halfTrack + profileWidth / 2.0 + 2.0)));
    const cp = step.addSolidBox(chkC, iTan, iNorm, 35.0, 6.0, 45.0, `Idler_${bName}_Cheek_Plate`, [0.93, 0.94, 0.96]);
    solids.push(cp.brep); styledItems.push(cp.styledItem);
    const chkNose = idlerShaftCenter.clone().add(iNorm.clone().multiplyScalar(sign * (halfTrack + profileWidth / 2.0 + 2.0)));
    const cNose = step.addSolidCylinder(chkNose, iNorm, 54.0, 6.0, `Idler_${bName}_Cheek_Nose`, [0.93, 0.94, 0.96], 18);
    solids.push(cNose.brep); styledItems.push(cNose.styledItem);

    const ibrkC = iPt.clone().add(iTan.clone().multiplyScalar(-idlerTanSign * 10.0));
    ibrkC.add(iNorm.clone().multiplyScalar(sign * (halfTrack + profileWidth / 2.0 + 6.0)));
    ibrkC.y = workingY - 22.0;
    const ib = step.addSolidBox(ibrkC, iTan, iNorm, 45.0, 3.5, 38.0, `Idler_${bName}_L_Bracket`, hardwareColor);
    solids.push(ib.brep); styledItems.push(ib.styledItem);

    for (const [sbY, sbN] of [[-10.0, 'Top'], [-30.0, 'Btm']] as const) {
      const sbC = ibrkC.clone().add(iNorm.clone().multiplyScalar(sign * 4.0));
      sbC.y = workingY + sbY;
      const sb = step.addSolidCylinder(sbC, iNorm, 5.0, 6.0, `Idler_Bolt_${sbN}_${bName}`, hardwareColor, 10);
      solids.push(sb.brep); styledItems.push(sb.styledItem);
    }

    const connC = iPt.clone().add(iNorm.clone().multiplyScalar(sign * (halfTrack + profileWidth / 2.0 + 3.0)));
    connC.add(iTan.clone().multiplyScalar(-idlerTanSign * 35.0));
    connC.y = workingY - 20.0;
    const conn = step.addSolidBox(connC, iTan, iNorm, 25.0, 4.0, 35.0, `Idler_Conn_Plate_${bName}`, [0.93, 0.94, 0.96]);
    solids.push(conn.brep); styledItems.push(conn.styledItem);
  }

  const ish = step.addSolidCylinder(idlerShaftCenter, iNorm, 12.5, trackWidth + profileWidth * 2.0, 'Idler_Return_Shaft', hardwareColor, 16);
  solids.push(ish.brep); styledItems.push(ish.styledItem);

  const ir = step.addSolidCylinder(idlerShaftCenter, iNorm, terminalSprocketR, trackWidth - 6.0, 'Idler_Return_Sprocket', [0.35, 0.38, 0.42], 19);
  solids.push(ir.brep); styledItems.push(ir.styledItem);

  // Context & representations
  const geomCtx = step.addGeometricRepresentationContext();
  step.addShapeDefinitionRepresentation(`ALUFLEX_CONVEYOR_${int(trackWidth)}MM`, solids, geomCtx);
  step.addMechanicalDesignGeometricPresentationRepresentation(step.styledItems, geomCtx);

  return step.generateStepString();
}

function int(val: number): number {
  return Math.round(val);
}
