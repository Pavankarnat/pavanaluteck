"""
Reader for the client's reference STEP (804-125.stp, AP214 exported from Autodesk Inventor).

It exposes the real assembly: every part (PRODUCT_DEFINITION), every placement
(NEXT_ASSEMBLY_USAGE_OCCURRENCE) and the 4x4 transform of each placement, so that customised
conveyors can be composed from the client's *exact* parts instead of re-modelled approximations.
"""

import re
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Tuple

import numpy as np

_ENTITY_RE = re.compile(r"#(\d+)\s*=\s*(.*?);\s*(?=#\d+\s*=|\Z)", re.S)
_KEYWORD_RE = re.compile(r"\(?\s*([A-Z_0-9]+)")
_REF_RE = re.compile(r"#(\d+)")
_GEOMETRY_COMPLEX_RE = re.compile(r"\(\s*(BOUNDED_CURVE|BOUNDED_SURFACE|B_SPLINE|CURVE|SURFACE|GEOMETRIC_REPRESENTATION_ITEM|REPRESENTATION_ITEM)")


def decode_step_string(text: str) -> str:
    """Decode STEP \\X2\\....\\X0\\ unicode escapes (Inventor writes Czech names this way)."""

    def _x2(m: "re.Match[str]") -> str:
        hexs = m.group(1)
        return "".join(chr(int(hexs[i:i + 4], 16)) for i in range(0, len(hexs), 4))

    text = re.sub(r"\\X2\\([0-9A-F]+)\\X0\\", _x2, text)
    return re.sub(r"\\X\\([0-9A-F]{2})", lambda m: chr(int(m.group(1), 16)), text)  # ISO 8859-1 escapes


def split_args(body: str) -> List[str]:
    """Split the top-level arguments of 'KEYWORD(a,b,(c,d),'e')'."""
    start = body.index("(")
    depth = 0
    args: List[str] = []
    cur: List[str] = []
    in_str = False
    i = start + 1
    while i < len(body):
        ch = body[i]
        if in_str:
            cur.append(ch)
            if ch == "'":
                if i + 1 < len(body) and body[i + 1] == "'":
                    cur.append("'")
                    i += 1
                else:
                    in_str = False
        elif ch == "'":
            in_str = True
            cur.append(ch)
        elif ch == "(":
            depth += 1
            cur.append(ch)
        elif ch == ")":
            if depth == 0:
                args.append("".join(cur).strip())
                return args
            depth -= 1
            cur.append(ch)
        elif ch == "," and depth == 0:
            args.append("".join(cur).strip())
            cur = []
        else:
            cur.append(ch)
        i += 1
    args.append("".join(cur).strip())
    return args


def _floats(text: str) -> List[float]:
    return [float(x) for x in re.findall(r"-?\d+\.?\d*(?:[Ee][-+]?\d+)?", text)]


@dataclass
class Instance:
    """One placement of a part inside its parent assembly."""
    nauo_id: int
    name: str
    parent_pd: int
    child_pd: int
    transform: np.ndarray  # child frame -> parent frame (4x4, mm)
    cdsr_id: int = 0
    rep_rel_id: int = 0
    idt_id: int = 0


@dataclass
class Assembly:
    entities: Dict[int, str]
    header: str
    pd_names: Dict[int, str] = field(default_factory=dict)
    pd_shape_rep: Dict[int, int] = field(default_factory=dict)
    pd_brep_rep: Dict[int, int] = field(default_factory=dict)  # ADVANCED_BREP_SHAPE_REPRESENTATION holding the solids
    instances: List[Instance] = field(default_factory=list)
    children: Dict[int, List[Instance]] = field(default_factory=dict)
    root_pd: int = 0

    # ---- low level helpers -------------------------------------------------
    def kw(self, eid: int) -> str:
        m = _KEYWORD_RE.match(self.entities[eid])
        return m.group(1) if m else "?"

    def args(self, eid: int) -> List[str]:
        return split_args(self.entities[eid])

    def refs(self, eid: int) -> List[int]:
        return [int(x) for x in _REF_RE.findall(self.entities[eid])]

    def placement_matrix(self, axis_id: int, entities: Optional[Dict[int, str]] = None) -> np.ndarray:
        """AXIS2_PLACEMENT_3D -> 4x4 matrix (local frame expressed in its parent)."""
        ents = self.entities if entities is None else entities
        a = split_args(ents[axis_id])

        def vec(ref: str) -> np.ndarray:
            return np.array(_floats(ents[int(ref[1:])].split("(", 2)[2]))[:3]

        loc = vec(a[1])
        z = vec(a[2]) if a[2] != "$" else np.array([0.0, 0.0, 1.0])
        x = vec(a[3]) if a[3] != "$" else np.array([1.0, 0.0, 0.0])
        z = z / np.linalg.norm(z)
        x = x - z * float(np.dot(x, z))
        x = x / np.linalg.norm(x)
        y = np.cross(z, x)
        m = np.eye(4)
        m[:3, 0], m[:3, 1], m[:3, 2], m[:3, 3] = x, y, z, loc
        return m

    def part_entities(self, pd: int) -> set:
        """All entity ids reachable from the part's B-rep representation (geometry, topology, styles excluded)."""
        start = self.pd_brep_rep.get(pd)
        seen: set = set()
        if start is None:
            return seen
        stack = [start]
        stop = ("GEOMETRIC_REPRESENTATION_CONTEXT", "PRODUCT_DEFINITION", "UNCERTAINTY", "LENGTH_UNIT", "(")
        while stack:
            e = stack.pop()
            if e in seen or e not in self.entities:
                continue
            body = self.entities[e]
            if body.startswith("GEOMETRIC_REPRESENTATION_CONTEXT") or body.startswith("PRODUCT_DEFINITION"):
                continue
            # complex entities: rational B-splines are geometry; contexts / relationships are not
            if body.startswith("(") and not _GEOMETRY_COMPLEX_RE.match(body):
                continue
            seen.add(e)
            stack.extend(self.refs(e))
        return seen

    def part_points(self, pd: int) -> Dict[int, np.ndarray]:
        out = {}
        for e in self.part_entities(pd):
            if self.entities[e].startswith("CARTESIAN_POINT"):
                out[e] = np.array(_floats(self.entities[e].split("(", 2)[2])[:3])
        return out

    # ---- assembly queries --------------------------------------------------
    def walk(self, pd: Optional[int] = None, parent: Optional[np.ndarray] = None, path: Tuple[str, ...] = ()):
        """Yield (instance, world_transform, path_names) for every placement, depth first."""
        pd = self.root_pd if pd is None else pd
        parent = np.eye(4) if parent is None else parent
        for inst in self.children.get(pd, []):
            world = parent @ inst.transform
            yield inst, world, path + (inst.name,)
            yield from self.walk(inst.child_pd, world, path + (inst.name,))

    def leaf_parts(self):
        """(instance, world_transform, path) for placements whose child has geometry and no sub-assembly."""
        for inst, world, path in self.walk():
            if inst.child_pd not in self.children:
                yield inst, world, path


def load_assembly(path: str) -> Assembly:
    with open(path, "r", encoding="latin-1") as fh:
        text = fh.read()
    head_end = text.index("DATA;")
    header = text[: head_end + 5]
    data = text[head_end + 5: text.rindex("ENDSEC;")]
    entities: Dict[int, str] = {int(m.group(1)): m.group(2) for m in _ENTITY_RE.finditer(data)}
    asm = Assembly(entities=entities, header=header)

    by_kw: Dict[str, List[int]] = {}
    for eid, body in entities.items():
        m = _KEYWORD_RE.match(body)
        by_kw.setdefault(m.group(1) if m else "?", []).append(eid)

    # product definitions -> names
    for pd in by_kw.get("PRODUCT_DEFINITION", []):
        formation = int(asm.args(pd)[2][1:])
        product = int(asm.args(formation)[2][1:])
        asm.pd_names[pd] = decode_step_string(asm.args(product)[0].strip("'"))

    # product definition -> shape representation
    pds_to_pd: Dict[int, int] = {}
    for pds in by_kw.get("PRODUCT_DEFINITION_SHAPE", []):
        target = int(asm.args(pds)[2][1:])
        pds_to_pd[pds] = target
    for sdr in by_kw.get("SHAPE_DEFINITION_REPRESENTATION", []):
        a = asm.args(sdr)
        pd = pds_to_pd.get(int(a[0][1:]))
        if pd is not None:
            asm.pd_shape_rep[pd] = int(a[1][1:])

    # shape rep -> B-rep rep (SHAPE_REPRESENTATION_RELATIONSHIP('SRR','None',#shape_rep,#brep_rep))
    brep_of_shape: Dict[int, int] = {}
    for srr in by_kw.get("SHAPE_REPRESENTATION_RELATIONSHIP", []):
        a_ = asm.args(srr)
        if len(a_) == 4 and a_[0].startswith("'"):
            brep_of_shape[int(a_[2][1:])] = int(a_[3][1:])
    for pd, shape_rep in asm.pd_shape_rep.items():
        if shape_rep in brep_of_shape:
            asm.pd_brep_rep[pd] = brep_of_shape[shape_rep]

    # NAUO placements + their transform chain
    nauo_args = {n: asm.args(n) for n in by_kw.get("NEXT_ASSEMBLY_USAGE_OCCURRENCE", [])}
    pds_of_nauo = {t: p for p, t in pds_to_pd.items() if t in nauo_args}
    cdsr_of_pds = {int(asm.args(c)[1][1:]): c for c in by_kw.get("CONTEXT_DEPENDENT_SHAPE_REPRESENTATION", [])}
    for nauo, a in nauo_args.items():
        parent_pd, child_pd = int(a[3][1:]), int(a[4][1:])
        pds = pds_of_nauo[nauo]
        cdsr = cdsr_of_pds[pds]
        rep_rel = int(asm.args(cdsr)[0][1:])
        idt = int(re.search(r"REPRESENTATION_RELATIONSHIP_WITH_TRANSFORMATION\(#(\d+)\)", entities[rep_rel]).group(1))
        ia = asm.args(idt)
        m_from = asm.placement_matrix(int(ia[2][1:]))
        m_to = asm.placement_matrix(int(ia[3][1:]))
        # child frame -> parent frame: place the 'from' frame of the child onto the 'to' frame of the parent
        transform = m_to @ np.linalg.inv(m_from)
        inst = Instance(nauo, decode_step_string(a[1].strip("'")), parent_pd, child_pd, transform, cdsr, rep_rel, idt)
        asm.instances.append(inst)
        asm.children.setdefault(parent_pd, []).append(inst)

    child_pds = {i.child_pd for i in asm.instances}
    roots = [pd for pd in asm.children if pd not in child_pds]
    asm.root_pd = roots[0]
    return asm
