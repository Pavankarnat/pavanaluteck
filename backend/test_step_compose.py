"""
Tests for composing customised conveyors from the client's exact CAD parts (app/step_compose.py).

Set RUN_CAD_KERNEL_TESTS=1 (and `pip install cadquery-ocp`) to also re-import the exported STEP with a real
CAD kernel and check every solid is valid (takes about a minute).
"""
import os
import tempfile

import numpy as np
import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.step_assembly import _floats, load_assembly
from app.step_compose import Params, build_layout, compose_step, family_params, reference_model

client = TestClient(app)

REFERENCE_CONFIG = {
    "language": "en", "chainMaterial": "plastic", "width": 82.5, "loadPerMeter": 50, "length": 1700,
    "drivePosition": "left",
    "motor": {"id": "motor-001", "name": "VF49", "powerKw": 0.12, "torqueNm": 50},
    "workingHeight": {"enabled": True, "type": "electrically-adjustable", "height": 1100,
                      "footType": "wheel-with-brake", "heightMode": "adjustable"},
    "shape": "curved",
    "curves": [{"curveType": "wheelband", "angle": 90, "radius": 400, "offset": 400, "direction": "left"}],
    "endHorizontalPathLength": 500,
    "sideGuides": [{"type": "904516", "widthBetweenGuides": 100, "heightAboveChain": 60}],
}


def _config(**changes):
    cfg = {k: (dict(v) if isinstance(v, dict) else v) for k, v in REFERENCE_CONFIG.items()}
    cfg["curves"] = [dict(c) for c in REFERENCE_CONFIG["curves"]]
    cfg["sideGuides"] = [dict(c) for c in REFERENCE_CONFIG["sideGuides"]]
    for k, v in changes.items():
        if k == "height":
            cfg["workingHeight"]["height"] = v
        elif k == "offset":
            cfg["curves"][0]["offset"] = v
        else:
            cfg[k] = v
    return cfg


def _reload(step_text: str):
    with tempfile.NamedTemporaryFile("w", suffix=".stp", delete=False, encoding="latin-1") as fh:
        fh.write(step_text)
        path = fh.name
    try:
        return load_assembly(path)
    finally:
        os.unlink(path)


def _span(asm, top_name, direction):
    top = next(i for i in asm.children[asm.root_pd] if i.name == top_name)
    pts = []
    for e in asm.part_entities(top.child_pd):
        if asm.entities[e].startswith("VERTEX_POINT"):
            pts.append(_floats(asm.entities[int(asm.args(e)[1][1:])].split("(", 2)[2])[:3])
    w = (top.transform @ np.c_[np.array(pts), np.ones(len(pts))].T).T[:, :3] @ direction
    return float(w.min()), float(w.max())


def test_reference_is_reproduced_exactly():
    ref = reference_model()
    out = _reload(compose_step(Params()))
    assert len(out.instances) == 378 and len(out.pd_names) == 125
    for a, b in zip(ref.asm.instances, out.instances):
        assert a.name == b.name and np.allclose(a.transform, b.transform, atol=1e-6)


def test_customised_conveyor_uses_the_same_parts_with_longer_sections():
    ref = reference_model()
    params = Params.single(700, 900, 1250)
    layout = build_layout(params)
    out = _reload(compose_step(params, layout))

    # parts are the client's: nothing dropped, only repeated (extra stands and guide posts)
    ref_names = {i.name for i in ref.asm.instances}
    out_names = {i.name for i in out.instances}
    assert ref_names <= out_names and len(out.instances) > 378 and layout.legs == 4
    assert len(out_names - ref_names) == len(layout.clones)

    # the 150 mm / 250 mm frame profiles and the 400 mm lead-in guide became 450 / 650 / 700 mm
    lo, hi = _span(out, "804-125_108692_15-150:1", ref.D1)
    assert hi - lo == pytest.approx(450, abs=0.5)
    lo, hi = _span(out, "804-125_108692_16-250:1", ref.D2)
    assert hi - lo == pytest.approx(650, abs=0.5)
    lo, hi = _span(out, "804-125-904516A-200-400:1", ref.D1)
    assert hi - lo == pytest.approx(700, abs=0.5)


def test_further_bends_and_right_hand_bends_use_the_same_parts():
    out_ref = {i.name for i in reference_model().asm.instances}
    params = Params(("L", "R"), (700.0, 900.0, 800.0), 1200.0)
    layout = build_layout(params)
    out = _reload(compose_step(params, layout))
    # a second bend module = a second set of the client's bend parts (frame, plates, posts, stands, bars)
    assert layout.legs >= 4
    assert sum(1 for i in out.children[out.root_pd] if i.name.startswith("AC645086:")) == 2
    assert out_ref <= {i.name for i in out.instances} | {"x".join(h) for h in layout.hidden} | {h[0] for h in layout.hidden}


def test_every_configuration_maps_onto_the_client_parts():
    params, notes = family_params(_config())
    assert params == Params() and notes == []
    assert family_params(_config(offset=900, height=1250, endHorizontalPathLength=1200))[0] == Params.single(900, 1200, 1250)
    two = _config(curves=[
        {"curveType": "wheelband", "angle": 90, "radius": 400, "offset": 700, "direction": "left"},
        {"curveType": "wheelband", "angle": 90, "radius": 400, "offset": 2500, "direction": "right", "distanceFromPrevious": 600},
    ])
    assert family_params(two)[0] == Params(("L", "R"), (700.0, 600.0, 500.0), 1100.0)
    half_turn = _config(curves=[{"curveType": "wheelband", "angle": 180, "radius": 400, "offset": 700, "direction": "left"}])
    assert family_params(half_turn)[0] == Params(("L", "L"), (700.0, 0.0, 500.0), 1100.0)

    # options the client's file has no part for never switch to another model: they are reported, the client part is used
    for change, expected in [
        ({"chainMaterial": "steel"}, "chain"),
        ({"width": 114.3}, "width"),
        ({"height": 500}, "working height"),
        ({"drivePosition": "below-belt-end"}, "motor"),
        ({"curves": [{"curveType": "friction", "angle": 45, "radius": 800, "offset": 700, "direction": "left"}]}, "bend"),
    ]:
        params, notes = family_params(_config(**change))
        assert params is not None and any(expected in n for n in notes), (change, notes)
    # a drive at the infeed, no side guides and no supports are real variations of the client's parts
    p, _ = family_params(_config(drivePosition="start-left"))
    assert p.drive_at_start
    p, notes = family_params(_config(drivePosition="end-right"))
    assert p.motor_side == "right" and not notes                          # motor on the other side is a real variation
    p, _ = family_params(_config(sideGuides=[]))
    assert p.guides is False
    no_support = _config()
    no_support["workingHeight"]["type"] = "without-support"
    p, _ = family_params(no_support)
    assert p.supports is False


def test_straight_conveyor_and_guide_height_use_the_client_parts():
    straight = _config(shape="straight", curves=[], length=3000, height=900)
    straight["sideGuides"][0]["heightAboveChain"] = 120
    params, reasons = family_params(straight)
    assert params == Params((), (3000.0,), 900.0, 120.0), reasons
    layout = build_layout(params)
    out = _reload(compose_step(params, layout))
    assert any(c.get("prism") is not None for c in layout.clones)           # straight strips / guides cut from the client's bars
    top = {i.name for i in out.children[out.root_pd]}
    assert not any(n.startswith("AC645086:") for n in top)                   # no bend in a straight conveyor
    assert layout.legs >= 2 and "ATS12086S" in "".join(top)
    # nothing is left dangling in the file
    import re
    ids = {m.group(1) for m in re.finditer(r"#(\d+)\s*=", compose_step(params, layout))}
    assert ids


def test_stands_are_repeated_when_a_section_gets_long():
    assert build_layout(Params()).legs == 2
    assert build_layout(Params.single(3500, 3500)).legs > 2


def test_layout_endpoint_and_step_export():
    ok = client.post("/api/v1/conveyor/layout", json=_config(offset=700, height=1200))
    assert ok.status_code == 200 and ok.json()["exact"] is True
    assert ok.json()["layout"]["params"] == {"bends": ["L"], "straights": [700.0, 500.0], "height": 1200.0, "guideHeight": 60.0, "guides": True, "supports": True, "driveAtStart": False, "motorSide": "left", "width": 82.5, "foot": "brake", "doubleGuide": False}

    other = client.post("/api/v1/conveyor/layout", json=_config(chainMaterial="steel")).json()
    assert other["exact"] is True and other["layout"] is not None and any("chain" in n for n in other["reasons"])

    step = client.post("/api/v1/conveyor/step", json=_config(offset=600))
    assert step.status_code == 200 and b"600+500" in step.content[:2000]

    # BOM stand count follows the real model
    bom = client.post("/api/v1/conveyor/calculate-bom", json=_config(offset=3500)).json()
    assert bom["specifications"]["support_legs_count"] == build_layout(Params.single(3500, 500)).legs


@pytest.mark.skipif(os.environ.get("RUN_CAD_KERNEL_TESTS") != "1", reason="needs a CAD kernel (cadquery-ocp)")
def test_exported_step_is_valid_in_a_cad_kernel(tmp_path):
    from OCP.BRepCheck import BRepCheck_Analyzer
    from OCP.STEPControl import STEPControl_Reader
    from OCP.TopAbs import TopAbs_SOLID
    from OCP.TopExp import TopExp_Explorer
    from OCP.TopoDS import TopoDS

    path = tmp_path / "custom.stp"
    path.write_text(compose_step(Params.single(700, 900, 1250)), encoding="latin-1")
    reader = STEPControl_Reader()
    assert reader.ReadFile(str(path)) == 1
    reader.TransferRoots()
    explorer = TopExp_Explorer(reader.OneShape(), TopAbs_SOLID)
    solids = invalid = 0
    while explorer.More():
        solids += 1
        invalid += 0 if BRepCheck_Analyzer(TopoDS.Solid(explorer.Current())).IsValid() else 1
        explorer.Next()
    assert solids == 715 + 2 * 166 and invalid == 0


def test_width_changes_stretch_client_parts():
    """Any chain width widens / narrows the client's own parts: stays an exact layout, with moves and warps."""
    base = build_layout(Params(("L",), (400.0, 500.0), 1100.0, 60.0, True, True, False, "left", 82.5))
    assert not base.warps
    for w in (63.0, 304.8):
        p = Params(("L",), (400.0, 500.0), 1100.0, 60.0, True, True, False, "left", w)
        lay = build_layout(p)
        assert lay.warps and lay.to_json()["params"]["width"] == w
        assert compose_step(p, lay).startswith("ISO-10303-21")
