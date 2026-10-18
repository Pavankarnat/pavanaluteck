"""
Dev tool (needs `pip install cadquery-ocp`): cuts the straight lead-in stub out of the client's bent wear strips and
long side-guide rails, so straight conveyors can be composed from the client's exact cross-sections.

    python tools/make_straight_bars.py

Writes backend/app/assets/straight_bars.stp: one prism per bent bar product, in the part's own coordinate frame
(so the composer can place it exactly where the bent bar sits), cut at the plane s1 = S1_CUT.
"""
import os
import sys

import numpy as np

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from OCP.BRepAlgoAPI import BRepAlgoAPI_Common
from OCP.BRepBuilderAPI import BRepBuilderAPI_Transform
from OCP.BRepBndLib import BRepBndLib
from OCP.BRepPrimAPI import BRepPrimAPI_MakeBox
from OCP.Bnd import Bnd_Box
from OCP.BRep import BRep_Builder
from OCP.STEPControl import STEPControl_AsIs, STEPControl_Reader, STEPControl_Writer
from OCP.TopAbs import TopAbs_SOLID
from OCP.TopExp import TopExp_Explorer
from OCP.TopoDS import TopoDS, TopoDS_Compound
from OCP.gp import gp_Ax2, gp_Dir, gp_Pnt, gp_Trsf

from app.step_compose import REFERENCE_STEP, S1_CUT, STRAIGHT_BAR_SOURCES, reference_model

OUT = os.path.join(os.path.dirname(__file__), "..", "app", "assets", "straight_bars.stp")
GLB_OUT = os.path.join(os.path.dirname(__file__), "..", "..", "frontend", "public", "straight_bars.glb")


def mesh_triangles(shape):
    """Flat-shaded triangles (mm) of a solid."""
    from OCP.BRep import BRep_Tool
    from OCP.BRepMesh import BRepMesh_IncrementalMesh
    from OCP.TopAbs import TopAbs_FACE, TopAbs_REVERSED
    from OCP.TopLoc import TopLoc_Location

    BRepMesh_IncrementalMesh(shape, 0.2, False, 0.2, True)
    tris = []
    fx = TopExp_Explorer(shape, TopAbs_FACE)
    while fx.More():
        face = TopoDS.Face(fx.Current())
        loc = TopLoc_Location()
        tri = BRep_Tool.Triangulation_s(face, loc)
        if tri is not None:
            trsf = loc.Transformation()
            pts = []
            for i in range(1, tri.NbNodes() + 1):
                p = tri.Node(i).Transformed(trsf)
                pts.append((p.X(), p.Y(), p.Z()))
            rev = face.Orientation() == TopAbs_REVERSED
            for i in range(1, tri.NbTriangles() + 1):
                a, b, c = tri.Triangle(i).Get()
                tri_pts = [pts[a - 1], pts[b - 1], pts[c - 1]]
                tris.append(tri_pts[::-1] if rev else tri_pts)
        fx.Next()
    return np.array(tris, dtype=np.float32)  # (n, 3, 3)


def write_glb(path, meshes):
    """Minimal GLB: one named node per mesh, positions + flat normals, metres."""
    import json
    import struct

    buf, views, accessors, gl_meshes, nodes = bytearray(), [], [], [], []
    for i, tris in enumerate(meshes):
        pos = (tris.reshape(-1, 3) * 0.001).astype(np.float32)
        n = np.cross(tris[:, 1] - tris[:, 0], tris[:, 2] - tris[:, 0])
        n /= np.maximum(np.linalg.norm(n, axis=1, keepdims=True), 1e-12)
        nor = np.repeat(n, 3, axis=0).astype(np.float32)
        for arr, kind in ((pos, "POSITION"), (nor, "NORMAL")):
            views.append({"buffer": 0, "byteOffset": len(buf), "byteLength": arr.nbytes, "target": 34962})
            accessors.append({"bufferView": len(views) - 1, "componentType": 5126, "count": len(arr), "type": "VEC3",
                              **({"min": pos.min(0).tolist(), "max": pos.max(0).tolist()} if kind == "POSITION" else {})})
            buf += arr.tobytes()
        base = len(accessors) - 2
        gl_meshes.append({"name": f"prism{i}", "primitives": [{"attributes": {"POSITION": base, "NORMAL": base + 1}, "mode": 4}]})
        nodes.append({"name": f"prism{i}", "mesh": i})
    doc = {"asset": {"version": "2.0"}, "scene": 0, "scenes": [{"nodes": list(range(len(nodes)))}], "nodes": nodes,
           "meshes": gl_meshes, "accessors": accessors, "bufferViews": views, "buffers": [{"byteLength": len(buf)}]}
    js = json.dumps(doc).encode()
    js += b" " * (-len(js) % 4)
    buf += b"" * (-len(buf) % 4)
    total = 12 + 8 + len(js) + 8 + len(buf)
    with open(path, "wb") as fh:
        fh.write(struct.pack("<4sII", b"glTF", 2, total))
        fh.write(struct.pack("<I4s", len(js), b"JSON") + js)
        fh.write(struct.pack("<I4s", len(buf), b"BIN") + bytes(buf))


def main() -> None:
    ref = reference_model()
    D1, D2 = ref.D1, ref.D2

    reader = STEPControl_Reader()
    reader.ReadFile(REFERENCE_STEP)
    reader.TransferRoots()
    shape = reader.OneShape()

    solids = []
    ex = TopExp_Explorer(shape, TopAbs_SOLID)
    while ex.More():
        s = TopoDS.Solid(ex.Current())
        b = Bnd_Box()
        BRepBndLib.AddOptimal_s(s, b, False, False)
        solids.append((s, np.array([b.CornerMin().X(), b.CornerMin().Y(), b.CornerMin().Z()]),
                       np.array([b.CornerMax().X(), b.CornerMax().Y(), b.CornerMax().Z()])))
        ex.Next()
    print("solids in the reference:", len(solids))

    comp = TopoDS_Compound()
    BRep_Builder().MakeCompound(comp)
    meshes = []
    for top_name in STRAIGHT_BAR_SOURCES:
        inst = ref.tops[top_name]
        pts = ref.vertices(inst.child_pd)
        world = (inst.transform @ np.c_[pts, np.ones(len(pts))].T).T[:, :3]
        lo, hi = world.min(0), world.max(0)
        best = min(solids, key=lambda t: np.abs(t[1] - lo).sum() + np.abs(t[2] - hi).sum())
        err = np.abs(best[1] - lo).sum() + np.abs(best[2] - hi).sum()
        assert err < 6.0, f"{top_name}: no matching solid (bbox error {err:.1f} mm)"

        # half space s1 <= S1_CUT: a big box whose +x runs along D1
        p0 = (S1_CUT - 6000.0) * D1 + (6000.0) * D2 + np.array([0, 0, -6000.0])
        box = BRepPrimAPI_MakeBox(gp_Ax2(gp_Pnt(*p0), gp_Dir(0, 0, 1), gp_Dir(*D1)), 6000.0, 12000.0, 12000.0).Shape()
        piece = BRepAlgoAPI_Common(best[0], box).Shape()

        # into the part's own frame
        inv = np.linalg.inv(inst.transform)
        t = gp_Trsf()
        t.SetValues(*[float(inv[r, c]) for r in range(3) for c in range(4)])
        piece = BRepBuilderAPI_Transform(piece, t, True).Shape()
        BRep_Builder().Add(comp, piece)
        meshes.append(mesh_triangles(piece))
        print(f"{top_name}: cut at s1={S1_CUT}")

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    w = STEPControl_Writer()
    w.Transfer(comp, STEPControl_AsIs)
    w.Write(OUT)
    print("written", os.path.abspath(OUT))
    write_glb(GLB_OUT, meshes)
    print("written", os.path.abspath(GLB_OUT))


if __name__ == "__main__":
    main()
