"""
Composes customised conveyors from the client's *exact* CAD parts (frontend/public/reference-model/804-125.stp).

Instead of re-modelling approximations, the reference assembly is edited:
  * rigid parts are moved (lead-in / exit length changes),
  * long prismatic bars (frame profiles, wear strips, side-guide rails) are lengthened by shifting every
    point on one side of a cut plane that lies in a vertex-free stretch of the extrusion,
  * stands and guide posts are repeated (new placements of the same part) where the longer conveyor needs them,
  * the electric stands are lengthened for a different working height.

`build_layout` describes those edits in reference-world millimetres; the same layout is applied to the STEP
(`compose_step`) and, by the frontend, to the converted GLB so the 3D view shows exactly the exported parts.
"""

import math
import os
import re
from dataclasses import dataclass, field
from functools import lru_cache
from typing import Any, Dict, List, Optional, Tuple

import numpy as np

from app.step_assembly import Assembly, Instance, _floats, load_assembly, split_args

# The client's reference model; in Docker it is mounted read-only and located through REFERENCE_STEP.
REFERENCE_STEP = os.environ.get(
    "REFERENCE_STEP",
    os.path.join(os.path.dirname(__file__), "..", "..", "frontend", "public", "reference-model", "804-125.stp"),
)

# --- the reference conveyor: DD82,5-400+ZP90+500_1100-1300mm -------------------------------------------------
REF_LEAD_IN = 400.0   # mm, lead-in before the ZP90 wheel bend (= length of the 904516A-200-400 guides)
REF_EXIT = 500.0      # mm, exit after the bend (= length of the 904516A-780-1-500 guides)
REF_HEIGHT = 1100.0   # mm, working height of the reference stands
MIN_HEIGHT, MAX_HEIGHT = 700.0, 2000.0   # the Linak column tube lengthens freely and shortens by about 420 mm
MIN_LEAD_IN, MIN_EXIT = 300.0, 350.0
MAX_SECTION = 12000.0

S1_CUT = 28.0    # lead-in cut plane, along D1 (inside the 150 mm frame profile and every lead-in bar)
S2_CUT = 730.0   # exit cut plane, along D2 (inside the 250 mm exit profile and every exit bar)
Z_CUT = -400.0   # stand cut plane (inside the Linak DL5 tube)
MAX_STAND_SPAN = 2000.0
END_STAND_MARGIN = 700.0
POST_SPACING = 450.0
EPS_STUB = 10.0       # mm, short bar stub that meets the neighbouring bend's piece at a joint
LEG_OFFSET = 47.0     # mm, the reference bend stand sits this far past the bend entry plane
MAX_BENDS = 8
MIN_STRAIGHT = 700.0  # shortest straight conveyor (start unit + drive end + frame profile)
CONTROL_PREFIXES = {"ISO 7094 AL ST 6 - 100 HV", "DIN 912 M6 x 50", "623025 623025", "804-125-Linak_CBD6s",
                    "804-125-Linak_DPA", "DIN 7991 200416.4", "Matice s pružinou 45 210402"}
# One straight prism per bent bar product (cut from the client's own solids by tools/make_straight_bars.py);
# every bent bar below maps to one of them by its product.
STRAIGHT_BAR_SOURCES = ("804-125-901020-150-1-500:1", "804-125-901020-150-2-500:2",
                        "804-125-904516B-780-1-500:2", "804-125-904516B-780-500:1")
STRAIGHT_BARS_STEP = os.path.join(os.path.dirname(__file__), "assets", "straight_bars.stp")
A_LEAD = ("804-125-904516A-200-400:1", "804-125-904516A-200-400:2")          # straight guide rails (400 mm)
A_EXIT = ("804-125-904516A-780-1-500:3", "804-125-904516A-780-1-500:4")      # straight guide rails at the exit

# Bars that are stretched; value = which cuts apply ("lead", "exit") and the zone the part sits in.
LEAD_PROFILE = "804-125_108692_15-150:1"
EXIT_PROFILE = "804-125_108692_16-250:1"
BARS: Dict[str, Tuple[Tuple[str, ...], int]] = {
    LEAD_PROFILE: (("lead",), 0),
    EXIT_PROFILE: (("exit",), 1),
    "804-125-901020-150-2-500:2": (("lead", "exit"), 0),
    "804-125-901020-150-2-500:3": (("lead", "exit"), 0),
    "804-125-901020-150-1-500:1": (("lead", "exit"), 0),
    "804-125-901020-150-1-500:2": (("lead", "exit"), 0),
    "804-125-904516B-780-1-500:2": (("lead", "exit"), 0),
    "804-125-904516B-780-500:1": (("lead", "exit"), 0),
    "804-125-904516A-200-400:1": (("lead",), 0),
    "804-125-904516A-200-400:2": (("lead",), 0),
    "804-125-904516A-780-1-500:3": (("exit",), 1),
    "804-125-904516A-780-1-500:4": (("exit",), 1),
}
LEG_NAMES = ("804-125-30-noha-1:1", "804-125-30-noha-1:2")
LEG_PRODUCT_DL5 = "804-125-Linak_DL5_with_bracket:1"
# Posts that stay together as a pair across the lead-in end (their centroids straddle the cut plane).
FORCE_ZONE1 = {"804-125-7:3", "804-125-7:4"}
LEAD_POSTS = ("804-125-7:4", "804-125-7:3")   # guide-rod posts at the lead-in / curve junction
EXIT_POSTS = ("804-125-8:1", "804-125-7:1")   # guide-rod posts at the curve / exit junction


GUIDE_HEIGHT_REF = 60.0
GUIDE_PARTS = ("804-125-904516B-780-1-500:2", "804-125-904516B-780-500:1", *A_LEAD, *A_EXIT)


def _is_guide_part(name: str) -> bool:
    """Side-guide rails and the posts that carry the guide rods (they follow the guide height)."""
    return name in GUIDE_PARTS or name.startswith(("804-125-7:", "804-125-8:", "804-125-904516A-25-25"))


@dataclass(frozen=True)
class Params:
    """A conveyor path made of the client's parts: straights (mm) joined by 90 degree ZP90 wheel bends."""
    bends: Tuple[str, ...] = ("L",)                 # one entry per 90 degree bend: "L" (left) or "R" (right)
    straights: Tuple[float, ...] = (REF_LEAD_IN, REF_EXIT)   # len(bends) + 1 lengths
    height: float = REF_HEIGHT
    guide_height: float = GUIDE_HEIGHT_REF           # side-guide height above the chain (mm)
    guides: bool = True                              # side guides fitted
    supports: bool = True                            # stands fitted ("no support" = a table / gantry mounting)
    drive_at_start: bool = False                     # motor head at the infeed end instead of the discharge end

    @staticmethod
    def single(lead_in: float = REF_LEAD_IN, exit_len: float = REF_EXIT, height: float = REF_HEIGHT) -> "Params":
        return Params(("L",), (float(lead_in), float(exit_len)), float(height))

    @property
    def lead_in(self) -> float:
        return self.straights[0]

    @property
    def exit_len(self) -> float:
        return self.straights[-1]

    @property
    def dh(self) -> float:
        return self.height - REF_HEIGHT


@dataclass
class Layout:
    params: Params
    moves: List[Dict[str, Any]] = field(default_factory=list)      # {path:[names], matrix:[16]}  (reference world -> new world)
    stretches: List[Dict[str, Any]] = field(default_factory=list)  # {path:[names], cuts:[{n,c,d}]}
    clones: List[Dict[str, Any]] = field(default_factory=list)     # {source, name, matrix:[16], cuts:[...]}
    hidden: List[List[str]] = field(default_factory=list)          # parts of the reference that are not used
    legs: int = 2
    max_span: float = 750.0   # largest distance between neighbouring stands (mm, along the path)

    def to_json(self) -> Dict[str, Any]:
        return {
            "params": {"bends": list(self.params.bends), "straights": list(self.params.straights), "height": self.params.height,
                       "guideHeight": self.params.guide_height, "guides": self.params.guides,
                       "supports": self.params.supports, "driveAtStart": self.params.drive_at_start},
            "moves": self.moves, "stretches": self.stretches, "clones": self.clones, "hidden": self.hidden,
            "legs": self.legs, "maxSpan": round(self.max_span, 1),
        }


# ---------------------------------------------------------------------------------------------------------
# reference model (parsed once)
# ---------------------------------------------------------------------------------------------------------
class ReferenceModel:
    def __init__(self, path: str = REFERENCE_STEP):
        self.asm: Assembly = load_assembly(path)
        top = {i.name: i for i in self.asm.children[self.asm.root_pd]}
        self.tops = top
        aru = top["804-125-ARU12086S:1"].transform
        self.D1 = aru[:3, 1] / np.linalg.norm(aru[:3, 1])        # lead-in direction (plan)
        self.D2 = aru[:3, 0] / np.linalg.norm(aru[:3, 0])        # exit direction (the bend turns D1 into D2)
        self._vert_cache: Dict[int, np.ndarray] = {}
        self.leaf_bounds: Dict[Tuple[str, ...], Tuple[float, ...]] = {}
        self.top_bounds: Dict[str, Tuple[float, ...]] = {}
        self._compute_bounds()

        # key points of the reference centre line (plan, z = 0): bend entry E, bend exit X, start S, end F
        lp, ep = self.leaf_bounds[(LEAD_PROFILE,)], self.leaf_bounds[(EXIT_PROFILE,)]
        self.E_s1, self.lane = lp[1], (lp[2] + lp[3]) / 2
        self.X_s1, self.X_s2 = (ep[0] + ep[1]) / 2, ep[2]
        self.E = self.xy(self.E_s1, self.lane)
        self.X = self.xy(self.X_s1, self.X_s2)
        self.S = self.xy(self.E_s1 - REF_LEAD_IN, self.lane)
        self.F = self.xy(self.X_s1, self.X_s2 + REF_EXIT)
        self.lead_profile_start = self.xy(lp[0], self.lane)
        # how far each bar's end cap lies from the bend entry / exit plane in the reference
        self.stub_in = {n: self.E_s1 - self.top_bounds[n][0] for n in BARS}
        self.stub_out = {n: self.top_bounds[n][3] - self.X_s2 for n in BARS}

        names = list(top)
        non_bar = [n for n in names if n not in BARS and n in self.top_bounds]
        self.control = [n for n in non_bar if n.split(":")[0] in CONTROL_PREFIXES]
        self.start_parts = [n for n in non_bar if n not in self.control and self.zone(n) == 0]
        self.end_parts = [n for n in non_bar if n not in self.control and self.zone(n) == 2]
        self.bend_parts = [n for n in non_bar if n not in self.control and self.zone(n) == 1]
        # parts without geometry of their own (none expected) are ignored

    def xy(self, s1: float, s2: float) -> np.ndarray:
        return s1 * self.D1 + s2 * self.D2

    def vertices(self, pd: int) -> np.ndarray:
        if pd not in self._vert_cache:
            pts = []
            for e in self.asm.part_entities(pd):
                if self.asm.entities[e].startswith("VERTEX_POINT"):
                    pid = int(self.asm.args(e)[1][1:])
                    pts.append(_floats(self.asm.entities[pid].split("(", 2)[2])[:3])
            self._vert_cache[pd] = np.array(pts) if pts else np.zeros((0, 3))
        return self._vert_cache[pd]

    def _bounds(self, W: np.ndarray) -> Tuple[float, ...]:
        s1, s2 = W @ self.D1, W @ self.D2
        return (s1.min(), s1.max(), s2.min(), s2.max(), W[:, 2].min(), W[:, 2].max())

    def _compute_bounds(self) -> None:
        asm = self.asm
        for top in asm.children[asm.root_pd]:
            all_w = []
            walk = [(top, top.transform, (top.name,))] + list(asm.walk(top.child_pd, top.transform, (top.name,)))
            for inst, world, path in walk:
                if inst.child_pd in asm.children:
                    continue
                P = self.vertices(inst.child_pd)
                if len(P) == 0:
                    continue
                W = (world @ np.c_[P, np.ones(len(P))].T).T[:, :3]
                self.leaf_bounds[path] = self._bounds(W)
                all_w.append(W)
            if all_w:
                self.top_bounds[top.name] = self._bounds(np.vstack(all_w))

    def zone(self, name: str) -> int:
        """0 = at the conveyor start, 1 = belongs to the bend, 2 = at the drive end."""
        if name in FORCE_ZONE1 or name in LEG_NAMES:
            return 1
        b = self.top_bounds[name]
        s1c, s2c = (b[0] + b[1]) / 2, (b[2] + b[3]) / 2
        if s2c > S2_CUT:
            return 2
        return 1 if s1c > S1_CUT else 0


@lru_cache(maxsize=1)
def reference_model() -> ReferenceModel:
    return ReferenceModel()


# ---------------------------------------------------------------------------------------------------------
# layout
# ---------------------------------------------------------------------------------------------------------
def _flat(m: np.ndarray) -> List[float]:
    return [round(float(x), 6) for x in m.reshape(-1)]


def _vec(v: np.ndarray) -> List[float]:
    return [round(float(x), 6) for x in v]


def _pose(p: np.ndarray, h: np.ndarray) -> np.ndarray:
    """Planar pose: origin p, x axis along the heading h, z up."""
    x = np.array([h[0], h[1], 0.0])
    x /= np.linalg.norm(x)
    z = np.array([0.0, 0.0, 1.0])
    m = np.eye(4)
    m[:3, 0], m[:3, 1], m[:3, 2], m[:3, 3] = x, np.cross(z, x), z, [p[0], p[1], 0.0]
    return m


def _stand_count(distance: float, margin: float) -> int:
    return max(0, math.ceil((distance - margin) / MAX_STAND_SPAN))


def _add_height_edits(lay: Layout, params: Params) -> None:
    """Lengthen the Linak columns for a different working height (shared by every stand, copies included)."""
    ref = reference_model()
    dh = params.dh
    if not dh:
        return
    asm = ref.asm
    drop = np.eye(4)
    drop[2, 3] = -dh

    def subtree_z(prefix: Tuple[str, ...]) -> Optional[Tuple[float, float]]:
        zs = [b for p, b in ref.leaf_bounds.items() if p[:len(prefix)] == prefix]
        return (min(b[4] for b in zs), max(b[5] for b in zs)) if zs else None

    def visit(path: Tuple[str, ...], inst: Instance) -> None:
        z = subtree_z(path)
        if z is None or z[0] >= Z_CUT:
            return                                     # above the cut: stays
        if z[1] <= Z_CUT:                              # whole subtree below the cut: drops with the foot
            lay.moves.append({"path": list(path), "matrix": _flat(drop)})
            return
        kids = asm.children.get(inst.child_pd)
        if kids:                                       # straddles: look inside
            for k in kids:
                visit(path + (k.name,), k)
        elif path[-1] == LEG_PRODUCT_DL5:              # the actuator tube itself is lengthened
            lay.stretches.append({"path": list(path), "cuts": [{"n": [0, 0, -1], "c": -Z_CUT, "d": [0, 0, -dh]}]})
        elif (z[0] + z[1]) / 2 < Z_CUT:
            lay.moves.append({"path": list(path), "matrix": _flat(drop)})

    for leg in LEG_NAMES:
        for k in asm.children[ref.tops[leg].child_pd]:
            visit((leg, k.name), k)


def _apply_guide_height(lay: Layout) -> None:
    """Raise / lower the side-guide rails and the guide-rod posts together (z shift in front of every placement)."""
    dg = lay.params.guide_height - GUIDE_HEIGHT_REF
    if abs(dg) < 1e-9:
        return
    up = _translate_matrix(np.array([0.0, 0.0, dg]))
    hidden = {tuple(h) for h in lay.hidden}
    moved = set()
    for mv in lay.moves:
        if len(mv["path"]) == 1 and _is_guide_part(mv["path"][0]):
            mv["matrix"] = _flat(up @ np.array(mv["matrix"]).reshape(4, 4))
            moved.add(mv["path"][0])
    for cl in lay.clones:
        if _is_guide_part(cl["source"]):
            cl["matrix"] = _flat(up @ np.array(cl["matrix"]).reshape(4, 4))
    for name in reference_model().tops:
        if _is_guide_part(name) and name not in moved and (name,) not in hidden:
            lay.moves.append({"path": [name], "matrix": _flat(up)})


def _strip_guides(lay: Layout) -> None:
    """Conveyor without side guides: leave out the client's guide rails and guide-rod posts."""
    ref = reference_model()
    lay.clones = [c for c in lay.clones if not _is_guide_part(c["source"])]
    lay.moves = [m for m in lay.moves if not (len(m["path"]) == 1 and _is_guide_part(m["path"][0]))]
    lay.stretches = [st_ for st_ in lay.stretches if not (len(st_["path"]) == 1 and _is_guide_part(st_["path"][0]))]
    already = {tuple(h) for h in lay.hidden}
    for name in ref.tops:
        if _is_guide_part(name) and (name,) not in already:
            lay.hidden.append([name])


def _place_end_units(lay: Layout, params: Params, end_p: np.ndarray, end_h: np.ndarray) -> None:
    """Idler unit + drive unit at the two ends of the path (drive at the discharge end, or swapped to the infeed)."""
    ref = reference_model()
    D1, D2 = ref.D1, ref.D2
    inv = np.linalg.inv
    if not params.drive_at_start:
        end_M = _pose(end_p, end_h) @ inv(_pose(ref.F, D2))
        if not np.allclose(end_M, np.eye(4), atol=1e-9):
            for name in ref.end_parts:
                lay.moves.append({"path": [name], "matrix": _flat(end_M)})
        return
    # swapped: the drive unit takes the start, the idler unit the end (each turned round to face the conveyor)
    drive_M = _pose(ref.S, -D1) @ inv(_pose(ref.F, D2))
    idler_M = _pose(end_p, -end_h) @ inv(_pose(ref.S, D1))
    for name in ref.end_parts:
        lay.moves.append({"path": [name], "matrix": _flat(drive_M)})
    for name in ref.start_parts:
        lay.moves.append({"path": [name], "matrix": _flat(idler_M)})


def _strip_supports(lay: Layout) -> None:
    """No support (table / gantry mounting): leave out the stands and the stand controller."""
    ref = reference_model()
    drop = set(LEG_NAMES) | set(ref.control)
    lay.clones = [c for c in lay.clones if c["source"] not in drop]
    lay.moves = [m for m in lay.moves if m["path"][0] not in drop]
    lay.stretches = [st_ for st_ in lay.stretches if st_["path"][0] not in drop]
    already = {tuple(h) for h in lay.hidden}
    for name in sorted(drop):
        if (name,) not in already:
            lay.hidden.append([name])
    lay.legs = 0


def _finish(lay: Layout) -> Layout:
    """Apply the guide / support settings, then drop no-op edits."""
    if not lay.params.supports:
        _strip_supports(lay)
    if not lay.params.guides:
        _strip_guides(lay)
    else:
        _apply_guide_height(lay)
    lay.moves = [m for m in lay.moves if not np.allclose(np.array(m["matrix"]).reshape(4, 4), np.eye(4), atol=1e-9)]
    lay.stretches = [st_ for st_ in lay.stretches if any(np.linalg.norm(c["d"]) > 1e-9 for c in st_["cuts"])]
    for cl in lay.clones:
        if cl.get("cuts") is not None:
            cl["cuts"] = [c for c in cl["cuts"] if np.linalg.norm(c["d"]) > 1e-9]
    return lay


def _build_straight_layout(params: Params, lay: Layout, new_name, cut_beyond) -> Layout:
    """A straight conveyor: start unit, one straight (frame profile, guides, strips, posts, stands), drive end."""
    ref = reference_model()
    D1, D2 = ref.D1, ref.D2
    inv = np.linalg.inv
    E_pose = _pose(ref.E, D1)
    L = params.straights[0]
    end_p = ref.S + L * D1

    # the bent strips / long guides do not exist as straight parts: use the straight prisms cut from them
    source_pd = {n: ref.tops[n].child_pd for n in STRAIGHT_BAR_SOURCES}
    for name in [n for n, (c, _z) in BARS.items() if c == ("lead", "exit")]:
        index = next(i for i, src in enumerate(STRAIGHT_BAR_SOURCES) if source_pd[src] == ref.tops[name].child_pd)
        off_in = REF_LEAD_IN - ref.stub_in[name]
        off_out = REF_EXIT - ref.stub_out[name]
        prism_len = S1_CUT - ref.top_bounds[name][0]
        lay.clones.append({"source": name, "name": new_name(name), "matrix": _flat(np.eye(4)), "prism": index,
                           "cuts": [cut_beyond(D1, S1_CUT - 1.0, (L - off_in - off_out) - prism_len)]})   # plane 1 mm inside the prism: its end face lies safely beyond it
        lay.hidden.append([name])

    # frame profile and straight guide rails: the originals, stretched
    lay.stretches.append({"path": [LEAD_PROFILE], "cuts": [cut_beyond(D1, S1_CUT, (L - 500.0) - 150.0)]})
    for name in A_LEAD:
        lay.stretches.append({"path": [name], "cuts": [cut_beyond(D1, S1_CUT, L - 400.0)]})
    lay.hidden.extend([[EXIT_PROFILE]] + [[n] for n in A_EXIT])

    # guide-rod posts
    n_posts = max(0, round(L / POST_SPACING) - 1)
    for k in range(1, n_posts + 1):
        P = ref.S + (k * L / (n_posts + 1)) * D1
        for src in LEAD_POSTS:
            lay.clones.append({"source": src, "name": new_name(src), "matrix": _flat(_pose(P, D1) @ inv(E_pose))})

    # stands: one near each end plus extras so no span exceeds 2000 mm (the bend stand 1 is reused at the start)
    a = min(447.0, 0.3 * L)
    lay.moves.append({"path": [LEG_NAMES[0]], "matrix": _flat(_translate_matrix((a - 447.0) * D1))})
    centres = [ref.S + a * D1, end_p - a * D1]
    span = L - 2 * a
    n = max(0, math.ceil(span / MAX_STAND_SPAN) - 1)
    step = span / (n + 1)
    centres = [centres[1]] + [centres[0] + j * step * D1 for j in range(1, n + 1)]
    for c in centres:
        lay.clones.append({"source": LEG_NAMES[0], "name": new_name(LEG_NAMES[0]),
                           "matrix": _flat(_pose(c - LEG_OFFSET * D1, D1) @ inv(E_pose))})
    lay.legs = 2 + n
    lay.max_span = step

    # controller and switch hang next to the drive-end stand, the way they sit next to the bend's exit stand
    ctrl_M = _pose(end_p - a * D1 + 40.0 * D1, D1) @ inv(_pose(ref.X, D2))
    for name in ref.control:
        lay.moves.append({"path": [name], "matrix": _flat(ctrl_M)})

    _place_end_units(lay, params, end_p, D1)

    # everything that belongs to the bend (and the second stand) is not part of a straight conveyor
    for name in ref.bend_parts:
        if name != LEG_NAMES[0]:
            lay.hidden.append([name])
    _add_height_edits(lay, params)
    return _finish(lay)


def _translate_matrix(v: np.ndarray) -> np.ndarray:
    m = np.eye(4)
    m[:3, 3] = v
    return m


def build_layout(params: Params) -> Layout:
    """Arrange the client's parts for a path of straights and 90 degree bends (reference-world mm)."""
    ref = reference_model()
    D1, D2 = ref.D1, ref.D2
    bends, st = params.bends, params.straights
    n_bends = len(bends)
    lay = Layout(params=params)
    counter = [500]

    def new_name(src: str) -> str:
        counter[0] += 1
        return f"{src.split(':')[0]}:{counter[0]}"

    def cut_beyond(direction: np.ndarray, plane: float, delta: float) -> Dict[str, Any]:
        return {"n": _vec(direction), "c": plane, "d": _vec(delta * direction)}

    def cut_before_lead(delta: float) -> Dict[str, Any]:     # points before the lead plane move by -delta
        return {"n": _vec(-D1), "c": -S1_CUT, "d": _vec(-delta * D1)}

    E_pose, X_rev_pose = _pose(ref.E, D1), _pose(ref.X, -D2)
    inv = np.linalg.inv

    if n_bends == 0:
        return _build_straight_layout(params, lay, new_name, cut_beyond)

    # --- path: straights and bend placements --------------------------------------------------------------
    cur_p, cur_h = ref.S.copy(), D1.copy()
    starts: List[Tuple[np.ndarray, np.ndarray]] = []
    mods: List[Dict[str, Any]] = []
    for i, b in enumerate(bends):
        starts.append((cur_p.copy(), cur_h.copy()))
        entry = cur_p + st[i] * cur_h
        if b == "L":
            M = _pose(entry, cur_h) @ inv(E_pose)
            nxt_p, nxt_h = (M @ np.append(ref.X, 1.0))[:3], M[:3, :3] @ D2
        else:  # a right-hand bend is the same part traversed the other way round
            M = _pose(entry, cur_h) @ inv(X_rev_pose)
            nxt_p, nxt_h = (M @ np.append(ref.E, 1.0))[:3], M[:3, :3] @ (-D1)
        mods.append({"M": M, "left": b == "L", "entry": entry})
        cur_p, cur_h = nxt_p, nxt_h
    starts.append((cur_p.copy(), cur_h.copy()))
    end_p = cur_p + st[-1] * cur_h

    # --- bend modules: moved originals (first bend) and clones (further bends) -----------------------------
    bar_names = [n for n, (c, _z) in BARS.items() if c == ("lead", "exit")]
    for i, mod in enumerate(mods):
        M, left = mod["M"], mod["left"]
        incoming, outgoing = st[i], st[i + 1]
        first, last = i == 0, i == n_bends - 1
        # lengths of the straight attached to the bend's entry (E) and exit (X) end, and whether it is the
        # conveyor start / end (full length) or a joint with a neighbouring bend (a short stub meets the next piece)
        e_len, x_len = (incoming, outgoing) if left else (outgoing, incoming)
        e_term = (left and first) or (not left and last)
        x_term = (left and last) or (not left and first)
        e_is_incoming, x_is_incoming = left, not left

        def stub(side_terminal: bool, is_incoming: bool, length: float, ref_stub: float, ref_len: float) -> float:
            """New stretch of the bar stub on one side of the bend, relative to the reference."""
            if side_terminal:
                return length - ref_len
            target = EPS_STUB if is_incoming else max(EPS_STUB, length - EPS_STUB)
            return target - ref_stub

        module_parts = ref.bend_parts + (ref.control if first else [])
        for name in module_parts:
            if first:
                lay.moves.append({"path": [name], "matrix": _flat(M)})
            else:
                lay.clones.append({"source": name, "name": new_name(name), "matrix": _flat(M)})
        for name in bar_names:
            d_e = stub(e_term, e_is_incoming, e_len, ref.stub_in[name], REF_LEAD_IN)
            d_x = stub(x_term, x_is_incoming, x_len, ref.stub_out[name], REF_EXIT)
            cuts = []
            if abs(d_e) > 1e-9:
                cuts.append(cut_before_lead(d_e))
            if abs(d_x) > 1e-9:
                cuts.append(cut_beyond(D2, S2_CUT, d_x))
            if first:
                if cuts:
                    lay.stretches.append({"path": [name], "cuts": cuts})
                lay.moves.append({"path": [name], "matrix": _flat(M)})
            else:
                lay.clones.append({"source": name, "name": new_name(name), "matrix": _flat(M), "cuts": cuts})

    # --- the part-specific stretches of each straight ------------------------------------------------------
    n_str = n_bends + 1
    last_left = mods[-1]["left"] if mods else True
    for i in range(n_str):
        st_p, st_h = starts[i]
        length = st[i]
        s_first, s_last = i == 0, i == n_str - 1
        # frame profile: ends meet the bend frames; start/end units cover 250 mm of the first / last straight
        prof_len = length - (250.0 if s_first else 0.0) - (250.0 if s_last else 0.0)
        if s_first:                                                   # original lead profile, anchored at the start
            lay.stretches.append({"path": [LEAD_PROFILE], "cuts": [cut_beyond(D1, S1_CUT, prof_len - 150.0)]})
        elif s_last and last_left:                                    # original exit profile follows the last bend
            M = mods[-1]["M"]
            lay.stretches.append({"path": [EXIT_PROFILE], "cuts": [cut_beyond(D2, S2_CUT, prof_len - 250.0)]})
            lay.moves.append({"path": [EXIT_PROFILE], "matrix": _flat(M)})
        else:                                                         # a further piece of the same profile
            ref_start = _pose(ref.lead_profile_start, D1)
            lay.clones.append({"source": LEAD_PROFILE, "name": new_name(LEAD_PROFILE),
                               "matrix": _flat(_pose(st_p, st_h) @ inv(ref_start)),
                               "cuts": [cut_beyond(D1, S1_CUT, prof_len - 150.0)]})
        # side-guide rails along the straight
        if s_first:
            for name in A_LEAD:
                lay.stretches.append({"path": [name], "cuts": [cut_beyond(D1, S1_CUT, length - 400.0)]})
        elif s_last and last_left:
            M = mods[-1]["M"]
            for name in A_EXIT:
                lay.stretches.append({"path": [name], "cuts": [cut_beyond(D2, S2_CUT, length - 500.0)]})
                lay.moves.append({"path": [name], "matrix": _flat(M)})
        else:
            for name in A_LEAD:
                ref_start = _pose(ref.xy(ref.top_bounds[name][0], ref.lane), D1)
                lay.clones.append({"source": name, "name": new_name(name),
                                   "matrix": _flat(_pose(st_p, st_h) @ inv(ref_start)),
                                   "cuts": [cut_beyond(D1, S1_CUT, length - 400.0)]})
        if s_last and not last_left:
            lay.hidden.extend([[n] for n in A_EXIT] + [[EXIT_PROFILE]])
        # guide-rod posts along long straights
        n_posts = max(0, round(length / POST_SPACING) - 1)
        for k in range(1, n_posts + 1):
            P = st_p + (k * length / (n_posts + 1)) * st_h
            for src in LEAD_POSTS:
                lay.clones.append({"source": src, "name": new_name(src),
                                   "matrix": _flat(_pose(P, st_h) @ inv(E_pose))})

    # --- stands -----------------------------------------------------------------------------------------------
    legs = 2 * n_bends
    spans = [750.0]       # the two stands flanking a bend are about 750 mm apart (measured on the reference)

    def extra_stands(centres: List[np.ndarray], h: np.ndarray) -> None:
        for c in centres:
            lay.clones.append({"source": LEG_NAMES[0], "name": new_name(LEG_NAMES[0]),
                               "matrix": _flat(_pose(c - LEG_OFFSET * h, h) @ inv(E_pose))})

    for i in range(n_str):
        st_p, st_h = starts[i]
        length = st[i]
        if i == 0:                                    # start end -> stand of the first bend
            first_c = mods[0]["entry"] + LEG_OFFSET * (st_h if mods[0]["left"] else st_h)
            dist = length + 36.0
            n = _stand_count(dist, END_STAND_MARGIN)
            step = dist / (n + 1)
            extra_stands([first_c - j * step * st_h for j in range(1, n + 1)], st_h)
            spans.append(step if n else 0.0)
        elif i == n_str - 1:                          # last bend's stand -> drive end
            dist = length + 20.0
            n = _stand_count(dist, END_STAND_MARGIN)
            step = dist / (n + 1)
            extra_stands([st_p - 40.0 * st_h + j * step * st_h for j in range(1, n + 1)], st_h)
            spans.append(step if n else 0.0)
        else:                                         # between two bends
            dist = length + 87.0
            n = max(0, math.ceil(dist / MAX_STAND_SPAN) - 1)
            step = dist / (n + 1)
            extra_stands([st_p - 40.0 * st_h + j * step * st_h for j in range(1, n + 1)], st_h)
            spans.append(step)
        legs += n
    lay.legs = legs
    lay.max_span = max(spans)

    # --- the two end units -------------------------------------------------------------------------------------
    _place_end_units(lay, params, end_p, cur_h)

    _add_height_edits(lay, params)
    return _finish(lay)


# ---------------------------------------------------------------------------------------------------------
# STEP writer
# ---------------------------------------------------------------------------------------------------------
def _fmt(x: float) -> str:
    s = repr(float(x))
    if "e" in s or "E" in s:
        mant, exp = re.split("[eE]", s)
        if "." not in mant:
            mant += "."
        return f"{mant}E{int(exp):+d}".replace("+", "")  # STEP: 1.E-5
    return s if "." in s else s + "."


_POINT_RE = re.compile(r"^CARTESIAN_POINT\(\s*('(?:[^']|'')*')\s*,\s*\(([^)]*)\)\s*\)\s*$", re.S)


class Composer:
    def __init__(self, asm: Assembly):
        self.asm = asm
        self.ent: Dict[int, str] = dict(asm.entities)
        self.next_id = max(self.ent) + 1
        self.inst_by_nauo = {i.nauo_id: i for i in asm.instances}
        self._rep_items_added: Dict[int, List[int]] = {}
        self._variants: Dict[int, list] = {}
        self._rev: Optional[Dict[int, List[int]]] = None
        self._styled_new: List[int] = []
        self._rebound: Dict[int, int] = {}

    # ---- entity helpers --------------------------------------------------------------------------------
    def new(self, body: str) -> int:
        eid = self.next_id
        self.next_id += 1
        self.ent[eid] = body
        return eid

    def new_point(self, p) -> int:
        return self.new("CARTESIAN_POINT('',(%s,%s,%s))" % tuple(_fmt(v) for v in p))

    def new_dir(self, v) -> int:
        return self.new("DIRECTION('',(%s,%s,%s))" % tuple(_fmt(x) for x in v))

    def axis_body(self, m: np.ndarray) -> str:
        return "AXIS2_PLACEMENT_3D('',#%d,#%d,#%d)" % (self.new_point(m[:3, 3]), self.new_dir(m[:3, 2]), self.new_dir(m[:3, 0]))

    # ---- placements ------------------------------------------------------------------------------------
    def set_transform(self, inst: Instance, new_transform: np.ndarray) -> None:
        """Re-place an existing occurrence (child frame -> parent frame)."""
        ia = split_args(self.ent[inst.idt_id])
        from_axis, to_axis = int(ia[2][1:]), int(ia[3][1:])
        m_from = self.asm.placement_matrix(from_axis, self.ent)
        self.ent[to_axis] = self.axis_body(new_transform @ m_from)

    def add_instance(self, like: Instance, name: str, transform: np.ndarray) -> Instance:
        """New occurrence of the same part (same child, same parent) with its own placement."""
        asm = self.asm
        ia = split_args(self.ent[like.idt_id])
        from_axis = int(ia[2][1:])
        m_from = asm.placement_matrix(from_axis, self.ent)
        rr_args = re.search(r"REPRESENTATION_RELATIONSHIP\(\$,\$,#(\d+),#(\d+)\)", self.ent[like.rep_rel_id])
        child_rep, parent_rep = int(rr_args.group(1)), int(rr_args.group(2))

        q = lambda s: "'" + s.replace("'", "''") + "'"
        nauo = self.new("NEXT_ASSEMBLY_USAGE_OCCURRENCE(%s,%s,%s,#%d,#%d,%s)" % (q(name), q(name), q(name), like.parent_pd, like.child_pd, q(name)))
        pds = self.new("PRODUCT_DEFINITION_SHAPE($,$,#%d)" % nauo)
        to_axis = self.new(self.axis_body(transform @ m_from))
        idt = self.new("ITEM_DEFINED_TRANSFORMATION($,$,#%d,#%d)" % (from_axis, to_axis))
        rr = self.new("( REPRESENTATION_RELATIONSHIP($,$,#%d,#%d) REPRESENTATION_RELATIONSHIP_WITH_TRANSFORMATION(#%d) SHAPE_REPRESENTATION_RELATIONSHIP() )" % (child_rep, parent_rep, idt))
        cdsr = self.new("CONTEXT_DEPENDENT_SHAPE_REPRESENTATION(#%d,#%d)" % (rr, pds))
        self._rep_items_added.setdefault(parent_rep, []).append(to_axis)
        return Instance(nauo, name, like.parent_pd, like.child_pd, transform, cdsr, rr, idt)

    @staticmethod
    @lru_cache(maxsize=1)
    def _prism_library() -> Tuple[Dict[int, str], List[int]]:
        with open(STRAIGHT_BARS_STEP, "r", encoding="latin-1") as fh:
            text = fh.read()
        data = text[text.index("DATA;") + 5: text.rindex("ENDSEC;")]
        ents = {int(m.group(1)): m.group(2) for m in re.finditer(r"#(\d+)\s*=\s*(.*?);\s*(?=#\d+\s*=|\Z)", data, re.S)}
        msbs = sorted(e for e, b in ents.items() if b.startswith("MANIFOLD_SOLID_BREP"))
        return ents, msbs

    def add_prism_instance(self, like: Instance, index: int, name: str, transform: np.ndarray,
                           world: np.ndarray, cuts: List[Dict[str, Any]]) -> Instance:
        """New part = straight prism `index` of the bar library, in the product frame of the bent bar `like`.

        The prism is stretched by the cuts exactly like any other bar (reference-world planes)."""
        asm = self.asm
        lib, msbs = self._prism_library()
        # closure of the library solid's shell (geometry and topology only)
        shell = int(re.findall(r"#(\d+)", lib[msbs[index]])[0])
        seen, stack = set(), [shell]
        while stack:
            e = stack.pop()
            if e in seen:
                continue
            seen.add(e)
            stack.extend(int(x) for x in re.findall(r"#(\d+)", lib[e]))
        mapping = {}
        for e in sorted(seen):
            mapping[e] = self.next_id
            self.next_id += 1
        for e in sorted(seen):
            self.ent[mapping[e]] = self._remap(lib[e], mapping)

        new_pd, pmap = self.clone_product(like.child_pd, "-S%d" % (index + 1))
        old_msb = next(e for e in asm.part_entities(like.child_pd) if asm.entities[e].startswith("MANIFOLD_SOLID_BREP"))
        args = split_args(self.ent[pmap[old_msb]])
        self.ent[pmap[old_msb]] = "MANIFOLD_SOLID_BREP(%s,#%d)" % (args[0], mapping[shell])

        new_inst = self.add_instance(like, name, transform)
        self._rebind(new_inst, new_pd, pmap)

        R = world[:3, :3]
        for eid in sorted(seen):
            m = _POINT_RE.match(self.ent[mapping[eid]])
            if not m:
                continue
            p = np.array([float(v) for v in m.group(2).split(",")])
            if len(p) != 3:
                continue                      # 2D parameter-space points of pcurves are not touched
            pw = R @ p + world[:3, 3]
            shift = np.zeros(3)
            for c in cuts:
                if float(np.dot(c["n"], pw)) > c["c"]:
                    shift += np.array(c["d"])
            if shift.any():
                q = p + R.T @ shift
                self.ent[mapping[eid]] = "CARTESIAN_POINT(%s,(%s,%s,%s))" % (m.group(1), _fmt(q[0]), _fmt(q[1]), _fmt(q[2]))
        return new_inst

    _PRODUCT_REFERRERS = ("PRODUCT_DEFINITION_SHAPE", "SHAPE_DEFINITION_REPRESENTATION", "PROPERTY_DEFINITION",
                          "PROPERTY_DEFINITION_REPRESENTATION", "APPLIED_DATE_AND_TIME_ASSIGNMENT")

    def remove_instance(self, inst: Instance) -> None:
        """Drop an occurrence; a part (and its sub-assembly) that is then unused disappears from the file entirely,
        otherwise CAD readers would treat it as a second top-level product."""
        for e, body in list(self.ent.items()):
            if body.startswith("PRODUCT_DEFINITION_SHAPE") and split_args(body)[2] == "#%d" % inst.nauo_id:
                del self.ent[e]
        for e in (inst.cdsr_id, inst.rep_rel_id, inst.idt_id, inst.nauo_id):
            self.ent.pop(e, None)
        pd = self._rebound.get(inst.nauo_id, inst.child_pd)
        still_used = any(b.startswith("NEXT_ASSEMBLY_USAGE_OCCURRENCE") and split_args(b)[4] == "#%d" % pd
                         for b in self.ent.values())
        if not still_used:
            self._drop_product(pd)

    def _drop_product(self, pd: int) -> None:
        asm, rev = self.asm, self._referrers()
        for child in asm.children.get(pd, []):          # its own sub-assembly placements go too
            if child.nauo_id in self.ent:
                self.remove_instance(child)
        doomed = {pd}
        frontier = [pd]
        while frontier:
            cur = frontier.pop()
            for e in rev.get(cur, []):
                body = self.ent.get(e)
                if body is None or e in doomed:
                    continue
                if any(body.startswith(k) for k in self._PRODUCT_REFERRERS):
                    doomed.add(e)
                    frontier.append(e)
        for e in doomed:
            self.ent.pop(e, None)

    def rename_instance(self, inst: Instance, new_name: str) -> None:
        q = "'" + new_name.replace("'", "''") + "'"
        a = split_args(self.ent[inst.nauo_id])
        a[0] = a[1] = a[2] = a[5] = q
        self.ent[inst.nauo_id] = "NEXT_ASSEMBLY_USAGE_OCCURRENCE(" + ",".join(a) + ")"

    # ---- geometry --------------------------------------------------------------------------------------
    def _remap(self, body: str, mapping: Dict[int, int]) -> str:
        return re.sub(r"#(\d+)", lambda m: "#%d" % mapping.get(int(m.group(1)), int(m.group(1))), body)

    def clone_product(self, pd: int, tag: str) -> Tuple[int, Dict[int, int]]:
        """Deep copy of a part (product records + geometry + styles) so one occurrence can have its own shape."""
        asm = self.asm
        formation = int(asm.args(pd)[2][1:])
        product = int(asm.args(formation)[2][1:])
        shape_rep = asm.pd_shape_rep[pd]
        ids = set(asm.part_entities(pd))
        # shape representation subtree (origin axis placement + its point/directions), contexts excluded
        stack, seen = [shape_rep], set()
        while stack:
            e = stack.pop()
            if e in seen or e not in asm.entities:
                continue
            body = asm.entities[e]
            if body.startswith("(") or body.startswith("GEOMETRIC_REPRESENTATION_CONTEXT"):
                continue
            seen.add(e)
            stack.extend(asm.refs(e))
        ids |= seen
        ids |= {product, formation, pd}
        for e, body in asm.entities.items():
            k = body[:40]
            if k.startswith("PRODUCT_DEFINITION_SHAPE") and asm.args(e)[2] == "#%d" % pd:
                ids.add(e)
            elif k.startswith("PRODUCT_RELATED_PRODUCT_CATEGORY") and "#%d" % product in body:
                ids.add(e)
        pds = [e for e in ids if asm.entities[e].startswith("PRODUCT_DEFINITION_SHAPE")][0]
        for e, body in asm.entities.items():
            if body.startswith("SHAPE_DEFINITION_REPRESENTATION") and asm.args(e)[0] == "#%d" % pds:
                ids.add(e)
            elif body.startswith("SHAPE_REPRESENTATION_RELATIONSHIP") and asm.args(e)[2:3] == ["#%d" % shape_rep]:
                ids.add(e)
        solids = {e for e in ids if asm.entities[e].startswith("MANIFOLD_SOLID_BREP")}
        styled = [e for e, body in asm.entities.items() if body.startswith("STYLED_ITEM") and int(asm.args(e)[-1][1:]) in solids]
        ids |= set(styled)

        mapping: Dict[int, int] = {}
        for e in sorted(ids):
            mapping[e] = self.next_id
            self.next_id += 1
        for e in sorted(ids):
            self.ent[mapping[e]] = self._remap(asm.entities[e], mapping)
        # unique part number for the stretched variant
        for src, kw in ((product, "PRODUCT"), (pd, "PRODUCT_DEFINITION")):
            a = split_args(self.ent[mapping[src]])
            a[0] = "'" + a[0].strip("'") + tag + "'"
            a[1] = "'" + a[1].strip("'") + tag + "'"
            self.ent[mapping[src]] = kw + "(" + ",".join(a) + ")"
        self._styled_new.extend(mapping[e] for e in styled)
        return mapping[pd], mapping

    def _rebind(self, inst: Instance, new_pd: int, mapping: Dict[int, int]) -> None:
        """Make an occurrence use a cloned part."""
        asm = self.asm
        a = split_args(self.ent[inst.nauo_id])
        a[4] = "#%d" % new_pd
        self.ent[inst.nauo_id] = "NEXT_ASSEMBLY_USAGE_OCCURRENCE(" + ",".join(a) + ")"
        old_sr = asm.pd_shape_rep[inst.child_pd]
        new_sr = mapping[old_sr]
        self.ent[inst.rep_rel_id] = self.ent[inst.rep_rel_id].replace(
            "REPRESENTATION_RELATIONSHIP($,$,#%d," % old_sr, "REPRESENTATION_RELATIONSHIP($,$,#%d," % new_sr, 1)
        ia = split_args(self.ent[inst.idt_id])
        from_axis = int(ia[2][1:])
        ia[2] = "#%d" % mapping.get(from_axis, from_axis)
        self.ent[inst.idt_id] = "ITEM_DEFINED_TRANSFORMATION(" + ",".join(ia) + ")"
        self._rebound[inst.nauo_id] = new_pd

    def _referrers(self) -> Dict[int, List[int]]:
        if self._rev is None:
            rev: Dict[int, List[int]] = {}
            for e, body in self.asm.entities.items():
                for r in set(int(x) for x in re.findall(r"#(\d+)", body)):
                    rev.setdefault(r, []).append(e)
            self._rev = rev
        return self._rev

    def _vertex_point_ids(self, start: int, skip: int) -> set:
        """CARTESIAN_POINT ids of the VERTEX_POINTs reachable from a face / edge (not crossing `skip`)."""
        asm, out, seen, stack = self.asm, set(), {skip}, [start]
        while stack:
            e = stack.pop()
            if e in seen or e not in asm.entities:
                continue
            seen.add(e)
            body = asm.entities[e]
            if body.startswith("VERTEX_POINT"):
                out.add(int(asm.args(e)[1][1:]))
                continue
            if body.startswith("ADVANCED_FACE") or body.startswith("EDGE_CURVE") or body.startswith(("FACE_", "EDGE_LOOP", "ORIENTED_EDGE")):
                stack.extend(asm.refs(e))
        return out

    def _keep_splines_rigid(self, pd: int, shifts: Dict[int, np.ndarray]) -> None:
        """A B-spline surface/curve must move as one block: if its control points would be shifted differently
        (the cut plane crosses its control net), shift all of them like the face/edge that uses it."""
        asm = self.asm
        rev = self._referrers()
        for e in asm.part_entities(pd):
            body = asm.entities[e]
            if not ("B_SPLINE_SURFACE" in body[:60] or "B_SPLINE_CURVE" in body[:60]):
                continue
            poles = [int(x) for x in re.findall(r"#(\d+)", body) if int(x) in shifts]
            if len(poles) < 2 or len({tuple(np.round(shifts[x], 6)) for x in poles}) == 1:
                continue
            vshifts = set()
            for user in rev.get(e, []):
                kw = asm.entities[user][:14]
                if kw.startswith("ADVANCED_FACE") or kw.startswith("EDGE_CURVE"):
                    for vp in self._vertex_point_ids(user, e):
                        if vp in shifts:
                            vshifts.add(tuple(np.round(shifts[vp], 6)))
            if len(vshifts) != 1:
                raise ValueError("the cut plane crosses a B-spline face; choose another cut position")
            target = np.array(next(iter(vshifts)))
            for x in poles:
                shifts[x] = target

    def stretch_instance(self, inst: Instance, world: np.ndarray, cuts: List[Dict[str, Any]], exclusive: bool) -> None:
        """Shift every point of the occurrence's part that lies beyond a cut plane (reference-world planes).

        Parts shared with occurrences that need a different edit (or none) are cloned first."""
        pd = inst.child_pd
        R = world[:3, :3]
        pts = self.asm.part_points(pd)
        shifts: Dict[int, np.ndarray] = {}
        for eid, p in pts.items():
            pw = R @ p + world[:3, 3]
            shift = np.zeros(3)
            for c in cuts:
                if float(np.dot(c["n"], pw)) > c["c"]:
                    shift += np.array(c["d"])
            shifts[eid] = shift
        self._keep_splines_rigid(pd, shifts)
        new_pts: Dict[int, Tuple[float, float, float]] = {}
        for eid, shift in shifts.items():
            if shift.any():
                q = pts[eid] + R.T @ shift
                new_pts[eid] = (float(q[0]), float(q[1]), float(q[2]))

        def same(x, y):
            return x.keys() == y.keys() and all(max(abs(x[k][i] - y[k][i]) for i in range(3)) < 1e-6 for k in x)

        variants = self._variants.setdefault(pd, [])
        for pts, bound, mapping in variants:
            if same(pts, new_pts):
                if bound != pd:
                    self._rebind(inst, bound, mapping)
                return
        if not variants and exclusive:
            bound, mapping = pd, {}
        else:
            bound, mapping = self.clone_product(pd, "-V%d" % (len(variants) + 1))
            self._rebind(inst, bound, mapping)
        variants.append((new_pts, bound, mapping))
        for eid, q in new_pts.items():
            tid = mapping.get(eid, eid)
            m = _POINT_RE.match(self.ent[tid])
            self.ent[tid] = "CARTESIAN_POINT(%s,(%s,%s,%s))" % (m.group(1), _fmt(q[0]), _fmt(q[1]), _fmt(q[2]))

    # ---- output ----------------------------------------------------------------------------------------
    def render(self, description: Optional[str] = None, name: Optional[str] = None) -> str:
        for rep, axes in self._rep_items_added.items():
            a = split_args(self.ent[rep])
            items = a[1].rstrip(")") + "," + ",".join("#%d" % x for x in axes) + ")"
            a[1] = items
            self.ent[rep] = re.match(r"\s*([A-Z_0-9]+)", self.ent[rep]).group(1) + "(" + ",".join(a) + ")"
        if self._styled_new:
            mdg = [e for e, b in self.asm.entities.items() if b.startswith("MECHANICAL_DESIGN_GEOMETRIC_PRESENTATION_REPRESENTATION")][0]
            a = split_args(self.ent[mdg])
            a[1] = a[1].rstrip(")") + "," + ",".join("#%d" % x for x in self._styled_new) + ")"
            self.ent[mdg] = "MECHANICAL_DESIGN_GEOMETRIC_PRESENTATION_REPRESENTATION(" + ",".join(a) + ")"
        header = self.asm.header
        if description:
            header = re.sub(r"\('DD82,5[^']*'\)", "('%s')" % description.replace("'", "''"), header, count=1)
        if name:
            header = header.replace("'804-125.stp'", "'%s'" % name.replace("'", "''"), 1)
        out = [header, "\n"]
        for eid in sorted(self.ent):
            out.append("#%d=%s;\n" % (eid, self.ent[eid].strip()))
        out.append("ENDSEC;\nEND-ISO-10303-21;\n")
        return "".join(out)


def _matrix(flat) -> np.ndarray:
    return np.array(flat, dtype=float).reshape(4, 4)


def compose_step(params: Params, layout: Optional[Layout] = None) -> str:
    """STEP text of the conveyor path, built from the client's exact parts."""
    ref = reference_model()
    asm = ref.asm
    layout = layout or build_layout(params)
    comp = Composer(asm)

    # reference-world pose of every occurrence, by path
    worlds: Dict[Tuple[str, ...], Tuple[Instance, np.ndarray, Instance]] = {}
    for top in asm.children[asm.root_pd]:
        worlds[(top.name,)] = (top, top.transform, top)
        for inst, world, path in asm.walk(top.child_pd, top.transform, (top.name,)):
            worlds[path] = (inst, world, top)

    def parent_world(path: Tuple[str, ...]) -> np.ndarray:
        return worlds[path[:-1]][1] if len(path) > 1 else np.eye(4)

    # 1. stretches; a part is edited in place only if every occurrence of it gets the same edit
    stretched = {worlds[tuple(st["path"])][0].nauo_id for st in layout.stretches}
    users: Dict[int, set] = {}
    for i in asm.instances:
        users.setdefault(i.child_pd, set()).add(i.nauo_id)
    for st in layout.stretches:
        inst, world, _ = worlds[tuple(st["path"])]
        comp.stretch_instance(inst, world, st["cuts"], exclusive=users[inst.child_pd] <= stretched)

    # 2. moves: new transform = parent_world^-1 * M * world
    moved_nauos: Dict[int, np.ndarray] = {}
    for mv in layout.moves:
        path = tuple(mv["path"])
        inst, world, _ = worlds[path]
        new_t = np.linalg.inv(parent_world(path)) @ _matrix(mv["matrix"]) @ world
        if inst.nauo_id in moved_nauos and not np.allclose(moved_nauos[inst.nauo_id], new_t, atol=1e-6):
            raise ValueError(f"occurrence {inst.name} is moved differently by two stands")
        moved_nauos[inst.nauo_id] = new_t
        comp.set_transform(inst, new_t)

    # 3. repeated parts: new placements of the same part, each with its own stretch if it needs one
    for cl in layout.clones:
        src, world, _ = worlds[(cl["source"],)]
        if cl.get("prism") is not None:
            comp.add_prism_instance(src, cl["prism"], cl["name"], _matrix(cl["matrix"]) @ world, world, cl.get("cuts") or [])
            continue
        new_inst = comp.add_instance(src, cl["name"], _matrix(cl["matrix"]) @ world)
        if cl.get("cuts") is not None:
            comp.stretch_instance(new_inst, world, cl["cuts"], exclusive=False)

    # 4. reference parts this layout does not use
    for path in layout.hidden:
        comp.remove_instance(worlds[tuple(path)][0])

    if params == Params():
        return comp.render()        # the unmodified reference: keep the client's own header
    desc = "ALUFLEX %s %s_%dmm" % ("".join(params.bends) or "STRAIGHT", "+".join("%d" % round(x) for x in params.straights), round(params.height))
    return comp.render(description=desc, name="ALUFLEX_%s.stp" % "_".join("%d" % round(x) for x in params.straights))


# ---------------------------------------------------------------------------------------------------------
# configuration -> the client's parts
# ---------------------------------------------------------------------------------------------------------
def plan_params(config: Any) -> Tuple[Params, List[str]]:
    """Map any configuration onto the client's parts. Always returns a Params; `notes` lists the options the client's
    CAD has no part for (the client's part is shown for them) and values limited to what the parts allow."""
    g = lambda o, k, d=None: (o.get(k, d) if isinstance(o, dict) else getattr(o, k, d))
    notes: List[str] = []

    width = float(g(config, "width", 82.5))
    if abs(width - 82.5) > 0.01:
        notes.append("chain width %g mm (the client CAD has the 82.5 mm chain)" % width)
    material = g(config, "chainMaterial")
    if material not in (None, "plastic"):
        notes.append("%s chain (the client CAD has the plastic POM chain)" % material)

    # drive: the client's drive is the direct motor head, left side, at the discharge end
    drive_pos = str(g(config, "drivePosition", "left") or "left")
    drive_at_start = drive_pos in ("start-left", "start-right", "below-belt-start", "beginning")
    if g(config, "driveKind", "normal") not in (None, "normal"):
        notes.append("%s drive (the client CAD has the direct motor head)" % g(config, "driveKind"))
    if "right" in drive_pos or "below" in drive_pos:
        notes.append("motor position '%s' (the client CAD has the motor on the left)" % drive_pos)

    # side guides
    guides = g(config, "sideGuides", None) or []
    guide_height = GUIDE_HEIGHT_REF
    if guides:
        first = guides[0]
        if str(g(first, "type")) != "904516":
            notes.append("double-rail guide profile 904515 (the client CAD has the 904516 rail)")
        spacing = float(g(first, "widthBetweenGuides", 100))
        if abs(spacing - 100) > 15:
            notes.append("guide spacing %g mm (the client rails are fixed at about 100 mm)" % spacing)
        guide_height = float(g(first, "heightAboveChain", GUIDE_HEIGHT_REF)) + (float(g(first, "bottomClearanceGap", 15) or 15) - 15.0)
        if not (20.0 <= guide_height <= 300.0):
            notes.append("guide height limited to 20-300 mm")
            guide_height = min(300.0, max(20.0, guide_height))

    # stands
    wh = g(config, "workingHeight", None)
    height = float(g(wh, "height", REF_HEIGHT)) if wh is not None else REF_HEIGHT
    supports = True
    if wh is not None:
        stand = g(wh, "type")
        if stand == "without-support" or g(wh, "enabled", True) is False:
            supports = False
        elif stand != "electrically-adjustable":
            notes.append("%s stands (the client CAD has the electric Linak stands)" % stand)
        if g(wh, "footType") not in (None, "wheel-with-brake"):
            notes.append("feet '%s' (the client CAD has braked castor wheels)" % g(wh, "footType"))
    if not (MIN_HEIGHT <= height <= MAX_HEIGHT):
        notes.append("working height limited to %d-%d mm" % (MIN_HEIGHT, MAX_HEIGHT))
        height = min(MAX_HEIGHT, max(MIN_HEIGHT, height))

    # path: curves sorted by position, as the 3D path is built; every bend is the client's ZP90 wheel bend
    curves = sorted((g(config, "curves", None) or []) if g(config, "shape") == "curved" else [], key=lambda c: float(g(c, "offset", 0)))
    bends: List[str] = []
    straights: List[float] = []
    last_offset = 0.0
    odd_type = odd_radius = odd_angle = False
    for i, c in enumerate(curves):
        odd_type |= g(c, "curveType") != "wheelband"
        radius = float(g(c, "radius", 400) or 400)
        odd_radius |= abs(radius - 400) > 0.5
        angle = float(g(c, "angle", 90))
        parts = 1 if angle <= 135.0 else 2
        odd_angle |= abs(angle - 90) > 0.01 and abs(angle - 180) > 0.01
        side = "L" if g(c, "direction") == "left" else "R"
        if i == 0:
            straight = float(g(c, "offset", REF_LEAD_IN) or REF_LEAD_IN)
        else:
            dist = g(c, "distanceFromPrevious", None)
            straight = float(dist) if dist is not None else max(200.0, float(g(c, "offset", 0)) - last_offset)
        straights.append(max(150.0, straight))
        bends.extend([side] * parts)
        straights.extend([0.0] * (parts - 1))
        last_offset = float(g(c, "offset", 0)) + math.pi * radius * (angle / 180.0)
    if odd_type:
        notes.append("bend type other than the ZP90 wheel bend (the client CAD only has the ZP90)")
    if odd_radius:
        notes.append("bend radius other than 400 mm (the ZP90 has R400)")
    if odd_angle:
        notes.append("bend angle other than 90 / 180 degrees (snapped to the nearest ZP90 bend)")
    length = float(g(config, "length", 3000))
    if not bends:
        straights = [min(MAX_SECTION, max(MIN_STRAIGHT, length))]
        if straights[0] != length:
            notes.append("conveyor length limited to %d-%d mm" % (MIN_STRAIGHT, MAX_SECTION))
    else:
        if len(bends) > MAX_BENDS:
            notes.append("at most %d bends (extra bends left out)" % MAX_BENDS)
            bends, straights = bends[:MAX_BENDS], straights[:MAX_BENDS]
        exit_len = g(config, "endHorizontalPathLength", None)
        exit_len = max(200.0, float(exit_len) if exit_len is not None else max(400.0, length * 0.35))
        straights.append(exit_len)
        if straights[0] < MIN_LEAD_IN:
            notes.append("lead-in limited to the 300 mm the client parts need")
            straights[0] = MIN_LEAD_IN
        if straights[-1] < MIN_EXIT:
            notes.append("exit limited to the 350 mm the client parts need")
            straights[-1] = MIN_EXIT
        straights = [min(MAX_SECTION, x) for x in straights]
    return Params(tuple(bends), tuple(straights), height, guide_height, bool(guides), supports, drive_at_start), notes


def family_params(config: Any) -> Tuple[Params, List[str]]:
    """(params, notes): every configuration now maps onto the client's parts."""
    return plan_params(config)
