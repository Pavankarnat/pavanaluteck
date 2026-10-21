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
from app.step_width import WidthModel, warp_displacement

# The client's reference model; in Docker it is mounted read-only and located through REFERENCE_STEP.
_BUNDLED_STEP = os.path.join(os.path.dirname(__file__), "assets", "804-125.stp")     # ships with the backend (deployments)
REFERENCE_STEP = os.environ.get(
    "REFERENCE_STEP",
    _BUNDLED_STEP if os.path.exists(_BUNDLED_STEP)
    else os.path.join(os.path.dirname(__file__), "..", "..", "frontend", "public", "reference-model", "804-125.stp"),
)

# --- the reference conveyor: DD82,5-400+ZP90+500_1100-1300mm -------------------------------------------------
REF_LEAD_IN = 400.0   # mm, lead-in before the ZP90 wheel bend (= length of the 904516A-200-400 guides)
REF_EXIT = 500.0      # mm, exit after the bend (= length of the 904516A-780-1-500 guides)
REF_HEIGHT = 1100.0   # mm, working height of the reference stands
REF_WIDTH = 82.5      # mm, chain width of the reference conveyor
MIN_WIDTH, MAX_WIDTH = 40.0, 400.0
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
JOINT_STAND_MERGE = 900.0   # mm: between two bends closer than this, the two flanking stands are replaced by one
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
GUIDE_CAP_PREFIX = "224516 224516:"     # end caps of the guide rails: they ride on the rails
DOUBLE_RAIL_PITCH = 55.0               # mm between the two rails of the double-rail guide (rail 40 mm + 15 mm gap)
GUIDE_PARTS = ("804-125-904516B-780-1-500:2", "804-125-904516B-780-500:1", *A_LEAD, *A_EXIT)


def _is_guide_part(name: str) -> bool:
    """Side-guide rails and the posts that carry the guide rods (they follow the guide height)."""
    return name in GUIDE_PARTS or name.startswith(("804-125-7:", "804-125-8:", "804-125-904516A-25-25", GUIDE_CAP_PREFIX))


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
    motor_side: str = "left"                         # "left" (client CAD), "right" or "bottom"
    width: float = 82.5                              # chain width (mm); the client CAD is the 82.5 mm conveyor
    double_guide: bool = False                       # double-rail guide (904515): a second rail above the first
    foot: str = "brake"                              # "brake" (client CAD castors), "nobrake" (brake lever left off), "none" (no castors)

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
    warps: List[Dict[str, Any]] = field(default_factory=list)      # {path:[names], spec:{...}}  chain-width warp of curved parts
    legs: int = 2
    max_span: float = 750.0   # largest distance between neighbouring stands (mm, along the path)

    def to_json(self) -> Dict[str, Any]:
        return {
            "params": {"bends": list(self.params.bends), "straights": list(self.params.straights), "height": self.params.height,
                       "guideHeight": self.params.guide_height, "guides": self.params.guides,
                       "supports": self.params.supports, "driveAtStart": self.params.drive_at_start,
                       "motorSide": self.params.motor_side, "width": self.params.width, "foot": self.params.foot,
                       "doubleGuide": self.params.double_guide},
            "moves": self.moves, "stretches": self.stretches, "clones": self.clones, "hidden": self.hidden, "warps": self.warps,
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
        self.worlds: Dict[Tuple[str, ...], Tuple[Instance, np.ndarray]] = {}   # every node: occurrence + reference world pose
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
                self.worlds[path] = (inst, world)
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


POST_STEM_PREFIX = "804-125-731110"   # the vertical stem of a guide-rod post
POST_CUT_Z = 260.0                    # above this the post carries the guide clamp and rod; below it is bolted to the frame


def _is_post(name: str) -> bool:
    return name.startswith(("804-125-7:", "804-125-8:"))


def _apply_guide_height(lay: Layout) -> None:
    """Raise / lower the side-guide rails; the guide-rod posts keep their frame clamps and carry the rod higher
    (stem lengthened, upper clamp and rod moved)."""
    dg = lay.params.guide_height - GUIDE_HEIGHT_REF
    if abs(dg) < 1e-9:
        return
    ref = reference_model()
    up = _translate_matrix(np.array([0.0, 0.0, dg]))
    hidden = {tuple(h) for h in lay.hidden}

    # rails: whole parts move up
    moved = set()
    for mv in lay.moves:
        if len(mv["path"]) == 1 and _is_guide_part(mv["path"][0]) and not _is_post(mv["path"][0]):
            mv["matrix"] = _flat(up @ np.array(mv["matrix"]).reshape(4, 4))
            moved.add(mv["path"][0])
    for cl in lay.clones:
        if _is_guide_part(cl["source"]) and not _is_post(cl["source"]):
            cl["matrix"] = _flat(up @ np.array(cl["matrix"]).reshape(4, 4))
    for name in ref.tops:
        if _is_guide_part(name) and not _is_post(name) and name not in moved and (name,) not in hidden:
            lay.moves.append({"path": [name], "matrix": _flat(up)})

    # posts: edit the parts inside every post (copies of a post share these edits)
    for name in ref.tops:
        if not _is_post(name):
            continue
        for path, b in ref.leaf_bounds.items():
            if path[0] != name or len(path) != 2:
                continue
            leaf = path[1]
            if leaf.startswith(POST_STEM_PREFIX):
                lay.stretches.append({"path": list(path), "cuts": [{"n": [0, 0, 1], "c": POST_CUT_Z, "d": [0, 0, dg]}]})
            elif (b[4] + b[5]) / 2 > POST_CUT_Z:
                lay.moves.append({"path": list(path), "matrix": _flat(up)})


@lru_cache(maxsize=1)
def _width_model() -> WidthModel:
    return WidthModel(reference_model())


def _is_chain_part(path: Tuple[str, ...]) -> bool:
    """The chain pieces (straight chain, the links round the idler) are widened with the chain."""
    return any("108692" in x or "6 12 041" in x for x in path)


def _part_centre(wm: WidthModel, path: Tuple[str, ...]) -> np.ndarray:
    """Bend axis of one curved part: the commonest location of its vertical-axis circles / cylinders / tori."""
    ref = reference_model()
    inst, world = ref.worlds[path]
    asm = ref.asm
    counts: Dict[Tuple[float, float], int] = {}
    for e in asm.part_entities(inst.child_pd):
        kw = asm.entities[e].split("(", 1)[0]
        if kw in ("CYLINDRICAL_SURFACE", "TOROIDAL_SURFACE", "CIRCLE"):
            m = world @ asm.placement_matrix(int(asm.args(e)[1][1:]))
            if abs(abs(m[2, 2]) - 1.0) < 1e-3:
                p = m[:3, 3]
                if np.hypot(*(p[:2] - wm.ref.xy(wm.C_s1, wm.C_s2)[:2])) < 40.0:     # near the bend centre
                    key = (round(float(p[0]), 1), round(float(p[1]), 1))
                    counts[key] = counts.get(key, 0) + 1
    if not counts:
        return wm.ref.xy(wm.C_s1, wm.C_s2)
    x, y = max(counts, key=counts.get)
    return np.array([x, y, 0.0])


def _apply_width(lay: Layout) -> None:
    """Widen / narrow the client's parts for another chain width (see step_width.py)."""
    dw = lay.params.width - REF_WIDTH
    if abs(dw) < 0.05:
        return
    h = dw / 2.0
    ref = reference_model()
    wm = _width_model()
    asm = ref.asm

    def leaves_under(path: Tuple[str, ...]) -> List[Tuple[str, ...]]:
        return [p for p in ref.leaf_bounds if p[:len(path)] == path]

    def forced_region(path: Tuple[str, ...]) -> Optional[str]:
        """The stands stand on one straight leg of the path: their lateral axis is that leg's, whatever the bend does."""
        return {LEG_NAMES[0]: "lead", LEG_NAMES[1]: "exit"}.get(path[0])

    def stats(path: Tuple[str, ...]):
        """Lateral range and region mix of everything under a node, from the real vertices."""
        lat, regs, bounds = [], [], []
        for lp in leaves_under(path):
            inst, world = ref.worlds[lp]
            P = ref.vertices(inst.child_pd)
            if not len(P):
                continue
            W = (world @ np.c_[P, np.ones(len(P))].T).T[:, :3]
            S1, S2 = W @ ref.D1, W @ ref.D2
            fr = forced_region(lp)
            if fr == "lead":                                # a stand: one frame for the whole part, however far it reaches
                lat.append(S2 - wm.lane); regs.append(np.zeros(len(S1), dtype=int))
            elif fr == "exit":
                lat.append(-(S1 - wm.exit_lane)); regs.append(np.full(len(S1), 2))
            else:
                lat.append(wm.lateral_array(S1, S2))
                regs.append(wm.region_array(S1, S2))
            bounds.append((S1.min(), S1.max(), S2.min(), S2.max()))
        if not lat:
            return None
        lat = np.concatenate(lat)
        regs = np.concatenate(regs)
        b = (min(x[0] for x in bounds), max(x[1] for x in bounds), min(x[2] for x in bounds), max(x[3] for x in bounds))
        return float(lat.min()), float(lat.max()), [int((regs == r).sum()) for r in (0, 1, 2)], b

    def to_flat(m: np.ndarray) -> List[float]:
        return _flat(m)

    def emit_move(path: Tuple[str, ...], E: np.ndarray) -> None:
        if len(path) > 1:
            lay.moves.append({"path": list(path), "matrix": to_flat(E)})
            return
        name = path[0]
        done = False
        for mv in lay.moves:
            if mv["path"] == [name]:
                mv["matrix"] = to_flat(np.array(mv["matrix"]).reshape(4, 4) @ E)
                done = True
        if not done:
            lay.moves.append({"path": [name], "matrix": to_flat(E)})
        for cl in lay.clones:
            if cl["source"] == name:
                cl["matrix"] = to_flat(np.array(cl["matrix"]).reshape(4, 4) @ E)

    def emit_cuts(path: Tuple[str, ...], cuts: List[Dict[str, Any]]) -> None:
        if len(path) > 1:
            lay.stretches.append({"path": list(path), "cuts": cuts})
            return
        name = path[0]
        for st_ in lay.stretches:
            if st_["path"] == [name]:
                st_["cuts"] = st_["cuts"] + cuts
                break
        else:
            lay.stretches.append({"path": [name], "cuts": cuts})
        for cl in lay.clones:
            if cl["source"] == name:
                cl["cuts"] = (cl.get("cuts") or []) + cuts

    checker = Composer(asm)
    curved_cache: Dict[Tuple[str, ...], bool] = {}

    def follows_bend(path: Tuple[str, ...]) -> bool:
        """True for parts built from circles / cylinders / tori about the bend axis (plates, strips, guide rails)."""
        if path not in curved_cache:
            inst, world = ref.worlds[path]
            c = ref.xy(wm.C_s1, wm.C_s2)
            n = 0
            for e in asm.part_entities(inst.child_pd):
                if asm.entities[e].split("(", 1)[0] in ("CYLINDRICAL_SURFACE", "TOROIDAL_SURFACE", "CIRCLE"):
                    m = world @ asm.placement_matrix(int(asm.args(e)[1][1:]))
                    if abs(abs(m[2, 2]) - 1.0) < 1e-3 and np.hypot(*(m[:2, 3] - c[:2])) < 40.0:
                        n += 1
                        if n >= 2:
                            break
            curved_cache[path] = n >= 2
        return curved_cache[path]

    def follow_part_axis(path: Tuple[str, ...], cuts: List[Dict[str, Any]], h: float) -> List[Dict[str, Any]]:
        """A part that is slightly turned (the tilted stands) must be stretched along its own axis, otherwise its holes and
        arcs are pulled off their axes: take the mean direction of the part's circles whose axes lie close to the lane
        axis, and run the cut plane through the centre of the part."""
        inst, world = ref.worlds[path]
        n0 = np.array(cuts[0]["n"])
        axes = []
        for e in asm.part_entities(inst.child_pd):
            if asm.entities[e].split("(", 1)[0] == "CIRCLE":
                ax = (world @ asm.placement_matrix(int(split_args(asm.entities[e])[1][1:])))[:3, 2]
                d = float(ax @ n0)
                if abs(d) > 0.985:
                    axes.append(ax * np.sign(d))
        if not axes:
            return cuts
        n1 = np.mean(axes, axis=0)
        n1 = n1 / np.linalg.norm(n1)
        if float(n1 @ n0) > 0.99999:
            return cuts
        P = ref.vertices(inst.child_pd)
        q = (world @ np.r_[P.mean(axis=0), 1.0])[:3]
        q = q + (cuts[0]["c"] - float(n0 @ q)) * n0          # on the nominal centre line
        c1 = float(n1 @ q)
        r = [round(float(x), 6) for x in n1]
        return [{"n": r, "c": c1, "d": [round(float(x * h), 6) for x in n1]},
                {"n": [-x for x in r], "c": -c1, "d": [round(float(-x * h), 6) for x in n1]}]

    def free_offset(path: Tuple[str, ...], cut: Dict[str, Any]) -> Optional[float]:
        """Offset of the centre-line cut plane (mm along its normal) nearest the centre that crosses no circle of the
        part (holes, arcs), so the stretch cannot tear them; None when the part has no such place."""
        inst, world = ref.worlds[path]
        n = np.array(cut["n"])
        spans = []
        for e in asm.part_entities(inst.child_pd):
            if asm.entities[e].split("(", 1)[0] != "CIRCLE":
                continue
            a = split_args(asm.entities[e])
            m = world @ asm.placement_matrix(int(a[1][1:]))
            half = float(a[2]) * float(np.sqrt(max(0.0, 1.0 - float(n @ m[:3, 2]) ** 2)))
            if half > 1e-6:
                s0 = float(n @ m[:3, 3]) - cut["c"]
                spans.append((s0 - half, s0 + half))
        verts = None
        if h < 0:       # narrowing: the two halves move towards each other, so no vertex may lie within |h| of the plane
            P = ref.vertices(inst.child_pd)
            verts = ((world @ np.c_[P, np.ones(len(P))].T).T[:, :3] @ n) - cut["c"] if len(P) else np.zeros(0)
        cands = {0.0} | {x + d for lo_, hi_ in spans for x, d in ((lo_, -0.5), (hi_, 0.5))}
        if verts is not None:
            cands |= {float(v) + sgn * abs(h) for v in verts if abs(v) < 160.0 for sgn in (-1.0, 1.0)}
        for t in sorted(cands, key=abs):
            if all(not (lo_ - 0.2 < t < hi_ + 0.2) for lo_, hi_ in spans) and (
                    verts is None or not np.any(np.abs(verts - t) < abs(h) - 0.05)):
                return t if abs(t) < 150.0 else None
        return None

    def cut_is_valid(path: Tuple[str, ...], cuts: List[Dict[str, Any]]) -> bool:
        """A centre-line stretch must not tear free-form (B-spline) faces."""
        inst, world = ref.worlds[path]
        R = world[:3, :3]
        shifts = {}
        for eid, pnt in asm.part_points(inst.child_pd).items():
            pw = R @ pnt + world[:3, 3]
            sh = np.zeros(3)
            for c in cuts:
                if float(np.dot(c["n"], pw)) > c["c"]:
                    sh += np.array(c["d"])
            shifts[eid] = sh
        try:
            checker._keep_splines_rigid(inst.child_pd, shifts)
        except ValueError:
            return False
        return True

    def emit_warp(path: Tuple[str, ...], sigma: int) -> None:
        spec = wm.warp_spec(sigma, h, _part_centre(wm, path))
        lay.warps.append({"path": list(path), "spec": spec})
        if len(path) == 1:
            for cl in lay.clones:
                if cl["source"] == path[0]:
                    cl["warp"] = spec

    stay_boxes: Dict[str, List[Tuple[np.ndarray, np.ndarray]]] = {}
    deferred: List[Tuple[Tuple[str, ...], int, float, float, Tuple[float, ...], str]] = []

    def world_box(path: Tuple[str, ...]) -> Optional[Tuple[np.ndarray, np.ndarray]]:
        inst, world = ref.worlds[path]
        P = ref.vertices(inst.child_pd)
        if not len(P):
            return None
        W = (world @ np.c_[P, np.ones(len(P))].T).T[:, :3]
        return W.min(axis=0), W.max(axis=0)

    def subtree_box(path: Tuple[str, ...]) -> Optional[Tuple[np.ndarray, np.ndarray]]:
        boxes = [world_box(lp) for lp in leaves_under(path)]
        boxes = [x for x in boxes if x is not None]
        if not boxes:
            return None
        return np.min([x[0] for x in boxes], axis=0), np.max([x[1] for x in boxes], axis=0)

    def stays(path: Tuple[str, ...]) -> None:
        box = world_box(path)
        if box is not None:
            stay_boxes.setdefault(path[0], []).append(box)

    def move_side(path: Tuple[str, ...], sigma: int, b: Tuple[float, ...]) -> None:
        m = np.eye(4)
        fr = forced_region(path)
        m[:3, 3] = sigma * h * (ref.D2 if fr == "lead" else -ref.D1 if fr == "exit"
                                else wm.right_vector((b[0] + b[1]) / 2, (b[2] + b[3]) / 2))
        emit_move(path, m)

    def resolve_deferred() -> None:
        """A side part that touches a part which stays put (the stand's central bar, its foot plate) stays with it; a
        small fitting (bolt, nut, clamp) that touches one follows it, so it is not left behind in the air. The rest
        moves out with its side."""
        items = []
        deferred_range = {path: (lo, hi) for path, sigma, lo, hi, b, reg in deferred}
        deferred_reg = {path: reg for path, sigma, lo, hi, b, reg in deferred}
        for path, sigma, lo, hi, b, reg in deferred:
            kids_here = bool(asm.children.get(ref.worlds[path][0].child_pd))
            box = subtree_box(path) if kids_here else world_box(path)
            if box is None:
                items.append((path, sigma, b, None, False, False))
                continue
            small = float(np.max(box[1] - box[0])) <= SMALL_FITTING_
            items.append((path, sigma, b, box, small, hi - lo >= 40.0 or kids_here))
        stayed = [False] * len(items)
        grown: Dict[str, List[Tuple[np.ndarray, np.ndarray]]] = {}      # boxes of parts that stayed here (small fittings follow them)

        def touches(box, boxes) -> bool:
            return any(np.all(box[0] <= sb[1] + 1.5) and np.all(sb[0] <= box[1] + 1.5) for sb in boxes)

        changed = True
        while changed:
            changed = False
            for k, (path, sigma, b, box, small, big) in enumerate(items):
                if stayed[k] or box is None:
                    continue
                base = stay_boxes.get(path[0], [])
                if (big and touches(box, base)) or (small and touches(box, base + grown.get(path[0], []))):
                    stayed[k] = True
                    grown.setdefault(path[0], []).append(box)
                    changed = True
        for k, (path, sigma, b, box, small, big) in enumerate(items):
            if path[-1].startswith(BRIDGING_CLAMPS) and len(path) > 1:
                lo_, hi_ = deferred_range[path]
                cut = dict(follow_part_axis(path, wm.straddle_cuts(b, h, deferred_reg[path]), h)[0 if sigma > 0 else 1])
                cut["c"] = cut["c"] + ((lo_ if sigma > 0 else -hi_) + 4.0)       # just outside the stationary part it sits on
                t = free_offset(path, cut)
                if t is not None and abs(t) < 12.0:
                    cut["c"] = cut["c"] + t
                    if cut_is_valid(path, [cut]):
                        emit_cuts(path, [cut])
                        stayed[k] = True
                        continue
            if not stayed[k]:
                move_side(path, sigma, b)
        deferred.clear()

    def visit(path: Tuple[str, ...]) -> None:
        st_ = stats(path)
        if st_ is None:
            return
        lo, hi, mix, b = st_
        inst, _world = ref.worlds[path]
        kids = asm.children.get(inst.child_pd)
        spans = sum(1 for n in mix if n > 2) >= 2
        extent = max(b[1] - b[0], b[3] - b[2])
        in_bend = mix[1] > 2
        if (kids and hi - lo < SMALL_WIDTH_ and abs((lo + hi) / 2) < 60.0 and extent < 200.0
                and lo < -SIDE_TOL_ and not _is_chain_part(path)):
            stays(path)                                     # a compact fitting on the centre line (castor): never split
            return
        if kids and ((spans and extent > BEND_LONG) or (lo < -SIDE_TOL_ and hi > SIDE_TOL_)):
            for k in kids:                                  # mixed assembly: decide part by part
                visit(path + (k.name,))
            return
        if hi <= SIDE_TOL_ or lo >= -SIDE_TOL_:             # entirely on one side
            sigma = -1 if hi <= SIDE_TOL_ else +1
            if not kids and (in_bend or spans) and extent > BEND_LONG and follows_bend(path):
                emit_warp(path, sigma)                      # long part following the bend: widen it radially
            elif True:
                reg = forced_region(path) or ("lead" if mix[0] >= max(mix[1], mix[2]) else "exit")
                deferred.append((path, sigma, lo, hi, b, reg))   # stretched instead if it touches a part that stays
            else:
                move_side(path, sigma, b)
            return
        # crosses the centre line
        if kids:
            for k in kids:
                visit(path + (k.name,))
            return
        if extent < SMALL_PART_ and abs((lo + hi) / 2) < 60.0 and not _is_chain_part(path):
            stays(path)                                     # small centred part (sprocket, hub): stays
            return
        if hi - lo < SMALL_WIDTH_ and abs((lo + hi) / 2) < 60.0 and not _is_chain_part(path):
            stays(path)                                     # narrow centred bar along the conveyor (stand rail): stays
            return
        reg = forced_region(path) or ("lead" if mix[0] >= max(mix[1], mix[2]) else "exit")
        cuts = wm.straddle_cuts(b, h, reg)
        cuts = follow_part_axis(path, cuts, h)
        t = free_offset(path, cuts[0])
        if t is None:
            stays(path)
            return
        if t:
            cuts = [dict(cuts[0], c=cuts[0]["c"] + t), dict(cuts[1], c=cuts[1]["c"] - t)]
        n_splines = sum(1 for e in asm.part_entities(ref.worlds[path][0].child_pd) if "B_SPLINE" in asm.entities[e][:60])
        if n_splines <= 100 and cut_is_valid(path, cuts):       # free-form parts (the Linak column) are never stretched
            emit_cuts(path, cuts)
        else:
            stays(path)

    # Copies of one shared part (the two stands): the edits are worked out once and carried over to the other copy by
    # moving them with the copy, so that both copies receive the same edit of their shared parts.
    done_inner: Dict[int, Tuple[str, np.ndarray, int, int, int]] = {}
    for name in list(ref.tops):
        inst, world = ref.worlds[(name,)]
        pd = inst.child_pd
        if pd in done_inner:
            first, w_first, i_m, i_s, i_w = done_inner[pd]
            G = world @ np.linalg.inv(w_first)
            Rg, tg = G[:3, :3], G[:3, 3]
            for mv in lay.moves[i_m[0]:i_m[1]]:
                E = np.array(mv["matrix"]).reshape(4, 4)
                lay.moves.append({"path": [name] + mv["path"][1:], "matrix": to_flat(G @ E @ np.linalg.inv(G))})
            for st_ in lay.stretches[i_s[0]:i_s[1]]:
                cuts = []
                for c in st_["cuts"]:
                    n2 = Rg @ np.array(c["n"])
                    cuts.append({"n": [round(float(x), 6) for x in n2], "c": float(c["c"] + n2 @ tg),
                                 "d": [round(float(x), 6) for x in Rg @ np.array(c["d"])]})
                lay.stretches.append({"path": [name] + st_["path"][1:], "cuts": cuts})
            continue
        n_m, n_s, n_w = len(lay.moves), len(lay.stretches), len(lay.warps)
        visit((name,))
        resolve_deferred()
        inner_m = [m for m in lay.moves[n_m:] if len(m["path"]) > 1]
        inner_s = [x for x in lay.stretches[n_s:] if len(x["path"]) > 1]
        if inner_m or inner_s:
            # remember just this top's inner edits (they are contiguous at the end of the lists)
            first_m = n_m + next(i for i, m in enumerate(lay.moves[n_m:]) if len(m["path"]) > 1) if inner_m else len(lay.moves)
            first_s = n_s + next(i for i, x in enumerate(lay.stretches[n_s:]) if len(x["path"]) > 1) if inner_s else len(lay.stretches)
            done_inner[pd] = (name, world, (first_m, len(lay.moves)), (first_s, len(lay.stretches)), 0)


A_GUIDE_TRIM = 175.0   # mm: how far the straight conveyor's grey guide rails are shorter than the bend model's
SIDE_TOL_ = 5.0
SMALL_PART_ = 130.0
SMALL_WIDTH_ = 100.0
BRIDGING_CLAMPS = ("221845 ", "350027")   # small brackets that tie the column bracket to the frame arms: lengthened with the width
SMALL_FITTING_ = 60.0   # mm: parts up to this size follow the stationary part they touch
BEND_LONG = 150.0


def _strip_guides(lay: Layout) -> None:
    """Conveyor without side guides: leave out the client's guide rails and guide-rod posts."""
    ref = reference_model()
    lay.clones = [c for c in lay.clones if not _is_guide_part(c["source"])]
    lay.moves = [m for m in lay.moves if not (len(m["path"]) == 1 and _is_guide_part(m["path"][0]))]
    lay.stretches = [st_ for st_ in lay.stretches if not (len(st_["path"]) == 1 and _is_guide_part(st_["path"][0]))]
    lay.warps = [w for w in lay.warps if not (len(w["path"]) == 1 and _is_guide_part(w["path"][0]))]
    already = {tuple(h) for h in lay.hidden}
    for name in ref.tops:
        if _is_guide_part(name) and (name,) not in already:
            lay.hidden.append([name])


MOTOR_PARTS = ("804-125-pohon_F1:1", "DIN 6885 A Alutec A8x7x70:1")      # gear motor and its shaft key
DRIVE_SHAFT = ("804-125-ATS12086S:1", "ATU30086:1")                         # the shaft the motor sits on
SHAFT_S2 = 965.0                                                            # along-conveyor position of the motor shaft (reference)


def _motor_edits(lay: Layout, params: Params) -> None:
    """Motor on the other side / underneath: the client's motor and shaft, placed (in the reference pose, before the
    drive unit itself is placed)."""
    if params.motor_side == "left":
        return
    ref = reference_model()
    D1 = ref.D1
    if params.motor_side == "right":
        # turn motor, key and shaft half a turn about the vertical axis through the conveyor centre line at the shaft
        P = ref.xy(ref.X_s1, SHAFT_S2)
        rot = np.eye(4)
        rot[0, 0] = rot[1, 1] = -1.0
        edit = _translate_matrix(P) @ rot @ _translate_matrix(-P)
        shaft_edit = edit
    else:  # bottom: motor under the drive unit, shaft centred
        motor = ref.top_bounds[MOTOR_PARTS[0]]
        edit = _translate_matrix((ref.X_s1 - (motor[0] + motor[1]) / 2) * D1 + np.array([0.0, 0.0, -230.0]))
        shaft = ref.leaf_bounds[DRIVE_SHAFT]
        shaft_edit = _translate_matrix((ref.X_s1 - (shaft[0] + shaft[1]) / 2) * D1)
    for name in MOTOR_PARTS:
        lay.moves.append({"path": [name], "matrix": _flat(edit), "edit": True})
    lay.moves.append({"path": list(DRIVE_SHAFT), "matrix": _flat(shaft_edit)})


def _place_end_units(lay: Layout, params: Params, end_p: np.ndarray, end_h: np.ndarray) -> None:
    """Idler unit + drive unit at the two ends of the path (drive at the discharge end, or swapped to the infeed)."""
    ref = reference_model()
    D1, D2 = ref.D1, ref.D2
    inv = np.linalg.inv
    n_before = len(lay.moves)
    if not params.drive_at_start:
        end_M = _pose(end_p, end_h) @ inv(_pose(ref.F, D2))
        if not np.allclose(end_M, np.eye(4), atol=1e-9):
            for name in ref.end_parts:
                lay.moves.append({"path": [name], "matrix": _flat(end_M)})
        _merge_motor_edits(lay, params, n_before)
        return
    # swapped: the drive unit takes the start, the idler unit the end (each turned round to face the conveyor)
    drive_M = _pose(ref.S, -D1) @ inv(_pose(ref.F, D2))
    idler_M = _pose(end_p, -end_h) @ inv(_pose(ref.S, D1))
    for name in ref.end_parts:
        lay.moves.append({"path": [name], "matrix": _flat(drive_M)})
    for name in ref.start_parts:
        lay.moves.append({"path": [name], "matrix": _flat(idler_M)})
    _merge_motor_edits(lay, params, n_before)


def _merge_motor_edits(lay: Layout, params: Params, n_before: int) -> None:
    """Add the motor-side edit; for the top-level motor parts it is applied first, then the drive unit's placement."""
    pending = Layout(params=params)
    _motor_edits(pending, params)
    placed = {tuple(m["path"]): np.array(m["matrix"]).reshape(4, 4) for m in lay.moves[n_before:]}
    for m in pending.moves:
        path = tuple(m["path"])
        edit = np.array(m["matrix"]).reshape(4, 4)
        if m.get("edit") and path in placed:                 # unit placement after the motor edit
            lay.moves = [x for x in lay.moves if tuple(x["path"]) != path or lay.moves.index(x) < n_before]
            lay.moves.append({"path": list(path), "matrix": _flat(placed[path] @ edit)})
        else:
            lay.moves.append({"path": list(path), "matrix": _flat(edit)})


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


def _double_guides(lay: Layout) -> None:
    """Double-rail guide: every guide rail and cap is repeated one rail pitch higher (same edits as the original)."""
    if not lay.params.double_guide or not lay.params.guides:
        return
    ref = reference_model()
    up = _translate_matrix(np.array([0.0, 0.0, DOUBLE_RAIL_PITCH]))
    hidden = {tuple(h) for h in lay.hidden}
    extra: List[Dict[str, Any]] = []
    for cl in lay.clones:                                   # rails that are copies / straight prisms
        if _is_guide_part(cl["source"]) and not _is_post(cl["source"]):
            dup = dict(cl)
            dup["name"] = cl["name"] + "-R2"
            dup["matrix"] = _flat(up @ np.array(cl["matrix"]).reshape(4, 4))
            extra.append(dup)
    for name in ref.tops:
        if not _is_guide_part(name) or _is_post(name) or (name,) in hidden:
            continue
        M = np.eye(4)
        for mv in lay.moves:
            if mv["path"] == [name]:
                M = np.array(mv["matrix"]).reshape(4, 4)
        cuts = [c for st_ in lay.stretches if st_["path"] == [name] for c in st_["cuts"]]
        dup = {"source": name, "name": name + "-R2", "matrix": _flat(up @ M), "cuts": cuts}
        for wp in lay.warps:
            if wp["path"] == [name]:
                dup["warp"] = wp["spec"]
        extra.append(dup)
    lay.clones.extend(extra)


def _merge_moves(lay: Layout) -> None:
    """Several edits can move the same part (height, width, guide height): they are all measured from the reference
    pose, so they combine into one move; two entries for one part would make the later overwrite the earlier."""
    merged: Dict[Tuple[str, ...], np.ndarray] = {}
    order: List[Tuple[str, ...]] = []
    for mv in lay.moves:
        key = tuple(mv["path"])
        M = np.array(mv["matrix"]).reshape(4, 4)
        if key in merged:
            merged[key] = M @ merged[key]
        else:
            merged[key] = M
            order.append(key)
    lay.moves = [{"path": list(k), "matrix": _flat(merged[k])} for k in order]


def _apply_foot(lay: Layout) -> None:
    """Footing: the client's stands run on braked castors. Without brake the brake lever of each castor is left off;
    with anchor / adjustable feet the castors are left off (the client has no such foot part)."""
    foot = lay.params.foot
    if foot == "brake" or not lay.params.supports:
        return
    ref = reference_model()
    already = {tuple(h) for h in lay.hidden}
    for stand in LEG_NAMES:
        inst = ref.tops[stand]
        for child in ref.asm.children.get(inst.child_pd, []):
            if not child.name.startswith("517508:"):
                continue
            targets = [(stand, child.name)] if foot == "none" else [
                (stand, child.name, k.name) for k in ref.asm.children.get(child.child_pd, []) if k.name.startswith("517508-brzda")]
            for t in targets:
                if t not in already:
                    lay.hidden.append(list(t))


def _finish(lay: Layout) -> Layout:
    """Apply the guide / support settings, then drop no-op edits."""
    if not lay.params.supports:
        _strip_supports(lay)
    if not lay.params.guides:
        _strip_guides(lay)
    else:
        _apply_guide_height(lay)
    _apply_width(lay)
    _apply_foot(lay)
    _double_guides(lay)
    _merge_moves(lay)
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
    for name in A_LEAD:                 # the grey guide rails end where the green guide ends (in the bend they run on round it)
        lay.stretches.append({"path": [name], "cuts": [cut_beyond(D1, S1_CUT, L - 400.0 - A_GUIDE_TRIM)]})
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
    # (the same fit the controller has on the bend's exit stand, carried over to the drive-end stand)
    W1, W2 = ref.worlds[(LEG_NAMES[0],)][1], ref.worlds[(LEG_NAMES[1],)][1]
    M_end = _pose(end_p - a * D1 - LEG_OFFSET * D1, D1) @ inv(E_pose)
    ctrl_M = M_end @ W1 @ inv(W2)
    U, _sv, Vt = np.linalg.svd(ctrl_M[:3, :3])          # keep it a pure rotation (the stands are a few arc-minutes off square)
    ctrl_M[:3, :3] = U @ Vt
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
    dropped_stands = 0
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
        if not first and incoming < JOINT_STAND_MERGE:
            # a short straight between two bends: the neighbouring bend's stand already carries it, one stand is enough
            joint_stand = LEG_NAMES[0] if left else LEG_NAMES[1]
            module_parts = [n for n in module_parts if n != joint_stand]
            dropped_stands += 1
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
    legs = 2 * n_bends - dropped_stands
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
        self._variants: Dict[int, list] = {}   # pd -> [(point edits, radius edits, bound pd, id mapping)]
        self._rev: Optional[Dict[int, List[int]]] = None
        self._styled_new: List[int] = []
        self._styled_removed: set = set()
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
                           world: np.ndarray, cuts: List[Dict[str, Any]], warp: Optional[Dict[str, Any]] = None) -> Instance:
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

        styled_before = len(self._styled_new)
        new_pd, pmap = self.clone_product(like.child_pd, "-S%d" % (index + 1))
        old_geometry = asm.part_entities(like.child_pd)
        old_msb = next(e for e in old_geometry if asm.entities[e].startswith("MANIFOLD_SOLID_BREP"))
        args = split_args(self.ent[pmap[old_msb]])
        self.ent[pmap[old_msb]] = "MANIFOLD_SOLID_BREP(%s,#%d)" % (args[0], mapping[shell])
        # the copied faces of the bent bar and their colours are not part of the prism: remove them so no viewer
        # can draw them as loose surfaces
        keep = {old_msb, asm.pd_brep_rep[like.child_pd]}
        for e in old_geometry:
            if e not in keep:
                self.ent.pop(pmap[e], None)
        new_styled = self._styled_new[styled_before:]
        for sid in new_styled:
            target = int(split_args(self.ent[sid])[-1][1:]) if sid in self.ent else None
            if target is not None and target not in self.ent:
                self.ent.pop(sid, None)
        self._styled_new = self._styled_new[:styled_before] + [x for x in new_styled if x in self.ent]

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
            if warp:
                shift += warp_displacement(warp, pw)
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
        # the part's geometry goes too: leftover solids and their colour entries would still be drawn by CAD programs
        # (at the origin, untransformed) even though no product uses them any more
        geometry = set(asm.part_entities(pd))
        brep_rep = asm.pd_brep_rep.get(pd)
        solids = {e for e in geometry if asm.entities[e].startswith("MANIFOLD_SOLID_BREP")}
        shape_rep = asm.pd_shape_rep.get(pd)
        for e, body in asm.entities.items():
            if body.startswith("STYLED_ITEM") and int(asm.args(e)[-1][1:]) in geometry:   # solid or single-face colour
                doomed.add(e)
                self._styled_removed.add(e)
            elif body.startswith("SHAPE_REPRESENTATION_RELATIONSHIP") and shape_rep is not None                     and asm.args(e)[2:3] == ["#%d" % shape_rep]:
                doomed.add(e)
        doomed |= geometry
        if shape_rep is not None:
            doomed.add(shape_rep)
            stack = [shape_rep]
            while stack:
                e = stack.pop()
                for r in asm.refs(e):
                    body = asm.entities.get(r, "")
                    if r not in doomed and (body.startswith(("AXIS2_PLACEMENT_3D", "CARTESIAN_POINT", "DIRECTION"))):
                        doomed.add(r)
                        stack.append(r)
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
                continue        # a face that runs across the cut plane (an extruded profile): its poles stretch with it
            target = np.array(next(iter(vshifts)))
            for x in poles:
                shifts[x] = target

    _REVOLUTION = ("CYLINDRICAL_SURFACE", "TOROIDAL_SURFACE", "CONICAL_SURFACE", "CIRCLE")

    def _radius_edits(self, pd: int, world: np.ndarray, warp: Dict[str, Any]) -> Dict[int, str]:
        """New text of the circles / cylinders / tori / cones that turn about the bend axis: their radius changes by the
        same amount the warp moves the points on them (inner parts shrink, outer parts grow)."""
        asm = self.asm
        c = np.array(warp["c"])
        delta = -warp["sigma"] * warp["h"]
        edits: Dict[int, str] = {}
        for e in asm.part_entities(pd):
            body = asm.entities[e]
            kw = body.split("(", 1)[0]
            if kw not in self._REVOLUTION:
                continue
            a = split_args(body)
            m = world @ asm.placement_matrix(int(a[1][1:]))
            if abs(abs(m[2, 2]) - 1.0) > 1e-3 or np.linalg.norm((m[:3, 3] - c)[:2]) > 1.5:
                continue                                    # not turning about the bend axis
            a[2] = _fmt(float(a[2]) + delta)
            edits[e] = kw + "(" + ",".join(a) + ")"
        return edits

    def stretch_instance(self, inst: Instance, world: np.ndarray, cuts: List[Dict[str, Any]], exclusive: bool,
                         warp: Optional[Dict[str, Any]] = None) -> None:
        """Shift every point of the occurrence's part that lies beyond a cut plane, and apply the chain-width warp
        (reference-world planes / fields). Parts shared with occurrences that need a different edit (or none) are
        cloned first."""
        pd = inst.child_pd
        R = world[:3, :3]
        pts = self.asm.part_points(pd)
        shifts: Dict[int, np.ndarray] = {}
        warp_shift: Dict[int, np.ndarray] = {}
        for eid, p in pts.items():
            pw = R @ p + world[:3, 3]
            shift = np.zeros(3)
            for c in cuts:
                if float(np.dot(c["n"], pw)) > c["c"]:
                    shift += np.array(c["d"])
            shifts[eid] = shift
            if warp:
                warp_shift[eid] = warp_displacement(warp, pw)
        if cuts:
            self._keep_splines_rigid(pd, shifts)
        for eid, w_ in warp_shift.items():
            shifts[eid] = shifts[eid] + w_
        new_pts: Dict[int, Tuple[float, float, float]] = {}
        for eid, shift in shifts.items():
            if shift.any():
                q = pts[eid] + R.T @ shift
                new_pts[eid] = (float(q[0]), float(q[1]), float(q[2]))
        param_edits = self._radius_edits(pd, world, warp) if warp else {}

        def same(x, y):
            return x.keys() == y.keys() and all(max(abs(x[k][i] - y[k][i]) for i in range(3)) < 1e-6 for k in x)

        variants = self._variants.setdefault(pd, [])
        for v_pts, v_params, bound, mapping in variants:
            if same(v_pts, new_pts) and v_params == param_edits:
                if bound != pd:
                    self._rebind(inst, bound, mapping)
                return
        if not variants and exclusive:
            bound, mapping = pd, {}
        else:
            bound, mapping = self.clone_product(pd, "-V%d" % (len(variants) + 1))
            self._rebind(inst, bound, mapping)
        variants.append((new_pts, param_edits, bound, mapping))
        for eid, q in new_pts.items():
            tid = mapping.get(eid, eid)
            m = _POINT_RE.match(self.ent[tid])
            self.ent[tid] = "CARTESIAN_POINT(%s,(%s,%s,%s))" % (m.group(1), _fmt(q[0]), _fmt(q[1]), _fmt(q[2]))
        for eid, text in param_edits.items():
            self.ent[mapping.get(eid, eid)] = self._remap(text, mapping)

    # ---- output ----------------------------------------------------------------------------------------
    def render(self, description: Optional[str] = None, name: Optional[str] = None) -> str:
        for rep, axes in self._rep_items_added.items():
            a = split_args(self.ent[rep])
            items = a[1].rstrip(")") + "," + ",".join("#%d" % x for x in axes) + ")"
            a[1] = items
            self.ent[rep] = re.match(r"\s*([A-Z_0-9]+)", self.ent[rep]).group(1) + "(" + ",".join(a) + ")"
        if self._styled_new or self._styled_removed:
            mdg = [e for e, b in self.asm.entities.items() if b.startswith("MECHANICAL_DESIGN_GEOMETRIC_PRESENTATION_REPRESENTATION")][0]
            a = split_args(self.ent[mdg])
            items = [x for x in re.findall(r"#(\d+)", a[1]) if int(x) not in self._styled_removed]
            items += [str(x) for x in self._styled_new]
            a[1] = "(" + ",".join("#" + x for x in items) + ")"
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

    # 1. stretches and width warps; a part is edited in place only if every occurrence of it gets the same edit
    edits: Dict[Tuple[str, ...], Dict[str, Any]] = {}
    for st in layout.stretches:
        edits.setdefault(tuple(st["path"]), {"cuts": [], "warp": None})["cuts"] += st["cuts"]
    for wp in layout.warps:
        edits.setdefault(tuple(wp["path"]), {"cuts": [], "warp": None})["warp"] = wp["spec"]
    stretched = {worlds[path][0].nauo_id for path in edits}
    users: Dict[int, set] = {}
    for i in asm.instances:
        users.setdefault(i.child_pd, set()).add(i.nauo_id)
    for path, ed in edits.items():
        inst, world, _ = worlds[path]
        comp.stretch_instance(inst, world, ed["cuts"], exclusive=users[inst.child_pd] <= stretched, warp=ed["warp"])

    # 2. moves: new transform = parent_world^-1 * M * world
    moved_nauos: Dict[int, np.ndarray] = {}
    for mv in layout.moves:
        path = tuple(mv["path"])
        inst, world, _ = worlds[path]
        new_t = np.linalg.inv(parent_world(path)) @ _matrix(mv["matrix"]) @ world
        if inst.nauo_id in moved_nauos and not np.allclose(moved_nauos[inst.nauo_id], new_t, atol=1.5):   # copies share one edit (a 0.3 deg tilted post differs by < 1 mm)
            raise ValueError(f"occurrence {inst.name} is moved differently by two stands")
        moved_nauos[inst.nauo_id] = new_t
        comp.set_transform(inst, new_t)

    # 3. repeated parts: new placements of the same part, each with its own stretch if it needs one
    for cl in layout.clones:
        src, world, _ = worlds[(cl["source"],)]
        if cl.get("prism") is not None:
            comp.add_prism_instance(src, cl["prism"], cl["name"], _matrix(cl["matrix"]) @ world, world, cl.get("cuts") or [],
                                    cl.get("warp"))
            continue
        new_inst = comp.add_instance(src, cl["name"], _matrix(cl["matrix"]) @ world)
        if cl.get("cuts") is not None or cl.get("warp") is not None:
            comp.stretch_instance(new_inst, world, cl.get("cuts") or [], exclusive=False, warp=cl.get("warp"))

    # 4. reference parts this layout does not use
    for path in layout.hidden:
        inst = worlds[tuple(path)][0]
        if inst.nauo_id in comp.ent:            # the two stands share one product: its inner parts go once
            comp.remove_instance(inst)

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

    width = float(g(config, "width", REF_WIDTH))
    if not (MIN_WIDTH <= width <= MAX_WIDTH):
        notes.append("chain width limited to %d-%d mm" % (MIN_WIDTH, MAX_WIDTH))
        width = min(MAX_WIDTH, max(MIN_WIDTH, width))
    material = g(config, "chainMaterial")
    if material not in (None, "plastic"):
        notes.append("%s chain (the client CAD has the plastic POM chain)" % material)

    # drive: the client's drive is the direct motor head, left side, at the discharge end
    drive_pos = str(g(config, "drivePosition", "left") or "left")
    drive_at_start = drive_pos in ("start-left", "start-right", "below-belt-start", "beginning")
    if g(config, "driveKind", "normal") not in (None, "normal"):
        notes.append("%s drive (the client CAD has the direct motor head)" % g(config, "driveKind"))
    motor_side = "right" if "right" in drive_pos else ("bottom" if "below" in drive_pos else "left")
    if motor_side == "bottom":
        notes.append("motor below the unit is the client motor moved under the drive unit (approximation)")

    # side guides
    guides = g(config, "sideGuides", None) or []
    guide_height = GUIDE_HEIGHT_REF
    double_guide = False
    if guides:
        first = guides[0]
        if str(g(first, "type")) != "904516":
            double_guide = True
            notes.append("double-rail guide profile 904515: the client's 904516 rail is repeated as a second rail above the first")
        spacing = float(g(first, "widthBetweenGuides", 100))
        if abs(spacing - (width + 17.5)) > 15:
            notes.append("guide spacing %g mm (the guides follow the chain width, %g mm in the client design)" % (spacing, width + 17.5))
        guide_height = float(g(first, "heightAboveChain", GUIDE_HEIGHT_REF)) + (float(g(first, "bottomClearanceGap", 15) or 15) - 15.0)
        if not (20.0 <= guide_height <= 300.0):
            notes.append("guide height limited to 20-300 mm")
            guide_height = min(300.0, max(20.0, guide_height))

    # stands
    wh = g(config, "workingHeight", None)
    height = float(g(wh, "height", REF_HEIGHT)) if wh is not None else REF_HEIGHT
    supports = True
    foot = "brake"
    if wh is not None:
        stand = g(wh, "type")
        if stand == "without-support" or g(wh, "enabled", True) is False:
            supports = False
        elif stand != "electrically-adjustable":
            notes.append("%s stands (the client CAD has the electric Linak stands)" % stand)
        foot_type = g(wh, "footType")
        if foot_type in ("wheel-without-brake", "fixed"):
            foot = "nobrake"
            notes.append("feet '%s': the client's castor without its brake lever (the client CAD has braked castors only)" % foot_type)
        elif foot_type not in (None, "wheel-with-brake"):
            foot = "none"
            notes.append("feet '%s': the client CAD has no such foot, the stand is shown without castors" % foot_type)
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
    return Params(tuple(bends), tuple(straights), height, guide_height, bool(guides), supports, drive_at_start, motor_side, width, bool(double_guide), foot), notes


def family_params(config: Any) -> Tuple[Params, List[str]]:
    """(params, notes): every configuration now maps onto the client's parts."""
    return plan_params(config)
