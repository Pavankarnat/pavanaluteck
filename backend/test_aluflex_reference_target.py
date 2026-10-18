"""
Automated Test Suite for Aluflex Target Reference Model Match:
DD82,5-400+ZP90+500_1100-1300mm

Validates:
1. Reference model configuration detection and generation.
2. 100% equivalence of assembly hierarchy (125 products, 378 placements).
3. Preservation of true analytic CAD surfaces (4,117 Cylinders, 1,139 Toroids, 294 B-Splines).
4. Automated reports creation: reference_geometry_report.json, model_difference_report.csv, validation_report.md.
5. Generation and integrity of ALUFLEX_CONVEYOR_REFERENCE_MATCH.step.
6. Non-regression of existing parametric generation for other configurations.
"""

import os
import sys
import pytest

# Add backend directory to sys.path
sys.path.insert(0, os.path.join(os.path.dirname(__file__)))

from app.cad_step_builder import build_cad_conveyor_step
from app.aluflex_reference_builder import AluflexReferenceModelBuilder
from app.geometry_comparator import StepGeometryComparator

class MockConfig:
    def __init__(self, **kwargs):
        for k, v in kwargs.items():
            setattr(self, k, v)

def get_target_reference_config(working_height: float = 1100.0):
    return MockConfig(
        language="en",
        chainMaterial="plastic",
        width=82.5,
        loadPerMeter=50.0,
        length=1700.0,
        shape="curved",
        curves=[
            MockConfig(
                id="curve-zp90",
                curveType="wheelband",
                angle=90.0,
                radius=400.0,
                offset=400.0,
                direction="left"
            )
        ],
        endHorizontalPathLength=500.0,
        workingHeight=MockConfig(
            enabled=True,
            type="electrically-adjustable",
            height=working_height,
            footType="wheel-with-brake"
        ),
        sideGuides=[
            MockConfig(
                type="904516",
                widthBetweenGuides=100.0,
                heightAboveChain=60.0
            )
        ],
        drivePosition="left",
        driveKind="normal",
        motor=MockConfig(
            id="motor-vf49",
            name="VF49 (0.12 kW)",
            powerKw=0.12,
            torqueNm=50.0
        ),
        isClientReferencePreset=True,
        presetId="DD82_5_ZP90_400_500"
    )

def test_aluflex_reference_target_generation():
    workspace_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
    ref_step_path = os.path.join(workspace_dir, "frontend", "public", "reference-model", "804-125.stp")
    assert os.path.exists(ref_step_path), f"Official reference STEP missing at: {ref_step_path}"

    config = get_target_reference_config(working_height=1100.0)
    builder = AluflexReferenceModelBuilder(workspace_dir)
    assert builder.matches_target_configuration(config), "Target configuration failed to match reference criteria"

    step_content = build_cad_conveyor_step(config)
    assert len(step_content) > 10_000_000, f"Target STEP file content unexpectedly small: {len(step_content)} bytes"

    # Save ALUFLEX_CONVEYOR_REFERENCE_MATCH.step
    output_path = os.path.join(workspace_dir, "reports", "ALUFLEX_CONVEYOR_REFERENCE_MATCH.step")
    with open(output_path, "w", encoding="utf-8") as f:
        f.write(step_content)

    assert os.path.exists(output_path), "ALUFLEX_CONVEYOR_REFERENCE_MATCH.step was not generated"

    # Compare geometry and assembly structure
    comparator = StepGeometryComparator(ref_step_path, output_path)
    reports = comparator.generate_reports(os.path.join(workspace_dir, "reports"))

    assert os.path.exists(reports["json_report"]), "reference_geometry_report.json not generated"
    assert os.path.exists(reports["csv_report"]), "model_difference_report.csv not generated"
    assert os.path.exists(reports["markdown_report"]), "validation_report.md not generated"

    # Assert exact assembly hierarchy
    assert comparator.gen_data["pdef_count"] == comparator.ref_data["pdef_count"], \
        f"Product definition count mismatch: {comparator.gen_data['pdef_count']} vs {comparator.ref_data['pdef_count']}"
    assert comparator.gen_data["assembly_count"] == comparator.ref_data["assembly_count"], \
        f"Assembly occurrence count mismatch: {comparator.gen_data['assembly_count']} vs {comparator.ref_data['assembly_count']}"

    # Assert exact analytic surface representation
    assert comparator.gen_data["surfaces"]["CYLINDRICAL_SURFACE"] == comparator.ref_data["surfaces"]["CYLINDRICAL_SURFACE"], \
        f"Cylindrical surface mismatch: {comparator.gen_data['surfaces']['CYLINDRICAL_SURFACE']} vs {comparator.ref_data['surfaces']['CYLINDRICAL_SURFACE']}"
    assert comparator.gen_data["surfaces"]["TOROIDAL_SURFACE"] == comparator.ref_data["surfaces"]["TOROIDAL_SURFACE"], \
        f"Toroidal surface mismatch: {comparator.gen_data['surfaces']['TOROIDAL_SURFACE']} vs {comparator.ref_data['surfaces']['TOROIDAL_SURFACE']}"
    assert comparator.gen_data["surfaces"]["B_SPLINE_SURFACE_WITH_KNOTS"] == comparator.ref_data["surfaces"]["B_SPLINE_SURFACE_WITH_KNOTS"], \
        f"B-spline surface mismatch: {comparator.gen_data['surfaces']['B_SPLINE_SURFACE_WITH_KNOTS']} vs {comparator.ref_data['surfaces']['B_SPLINE_SURFACE_WITH_KNOTS']}"

    # Assert bounding box physical match
    dx_diff = abs(comparator.gen_data["bbox"]["dx"] - comparator.ref_data["bbox"]["dx"])
    dy_diff = abs(comparator.gen_data["bbox"]["dy"] - comparator.ref_data["bbox"]["dy"])
    dz_diff = abs(comparator.gen_data["bbox"]["dz"] - comparator.ref_data["bbox"]["dz"])
    assert dx_diff < 1.0, f"Bounding box X dimension mismatch: delta {dx_diff} mm"
    assert dy_diff < 1.0, f"Bounding box Y dimension mismatch: delta {dy_diff} mm"
    assert dz_diff < 1.0, f"Bounding box Z dimension mismatch: delta {dz_diff} mm"

    print("\n[ALL REFERENCE CAD VALIDATION CHECKS PASSED]")

def test_non_reference_configuration_backward_compatibility():
    # Validates that custom conveyors still generate valid solid models via standard generator
    custom_config = MockConfig(
        language="en",
        chainMaterial="steel",
        width=114.3,
        loadPerMeter=40.0,
        length=2000.0,
        shape="straight",
        curves=[],
        endHorizontalPathLength=0.0,
        workingHeight=MockConfig(
            enabled=True,
            type="fixed",
            height=800.0,
            footType="adjustable"
        ),
        sideGuides=[],
        drivePosition="right",
        driveKind="normal",
        motor=MockConfig(id="m1", name="Motor", powerKw=0.25, torqueNm=20.0),
        isClientReferencePreset=False
    )
    step_out = build_cad_conveyor_step(custom_config)
    assert len(step_out) > 5000
    assert "MANIFOLD_SOLID_BREP" in step_out
    assert "CLOSED_SHELL" in step_out
