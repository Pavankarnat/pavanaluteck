import { ConveyorConfiguration, ValidationResult } from '../types/conveyor';
import { resolveCurveRadius } from '../components/3d/pathMath';

export class ValidationService {
  public static validate(config: ConveyorConfiguration): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (!Number.isFinite(config.length) || !Number.isFinite(config.width) || !Number.isFinite(config.loadPerMeter)) {
      errors.push('Length, width and load must be valid numbers.');
      return { valid: false, errors, warnings };
    }

    // 1. Length validation (600 mm - 12000 mm)
    if (config.length < 600) {
      errors.push(`Conveyor length (${config.length} mm) is below the minimum engineering limit of 600 mm.`);
    } else if (config.length > 12000) {
      errors.push(`Conveyor length (${config.length} mm) exceeds the maximum structural limit of 12000 mm.`);
    }

    // 2. Load validation (<= 125 kg/m)
    if (config.loadPerMeter > 125) {
      errors.push(`Load per meter (${config.loadPerMeter} kg/m) exceeds maximum allowable limit of 125 kg/m.`);
    } else if (config.loadPerMeter > 90) {
      warnings.push(`High load application (${config.loadPerMeter} kg/m). Reinforced slide rails are recommended.`);
    } else if (config.loadPerMeter < 5) {
      warnings.push(`Load per meter (${config.loadPerMeter} kg/m) is unusually low. Standard calculation assumes minimum 5 kg/m.`);
    }

    // 3. Material & Width compatibility
    if ((config.chainMaterial === 'steel' || config.chainMaterial === 'stainless-steel') && config.width > 190.5) {
      errors.push(
        `${config.chainMaterial === 'steel' ? 'Steel' : 'Stainless Steel'} chain is not available for widths above 190.5 mm. Select Plastic chain for widths $\\ge$ 254 mm.`
      );
    }

    // 4. Shape & Curve validation
    if (config.shape === 'curved') {
      if (!config.curves || config.curves.length === 0) {
        warnings.push('Curved conveyor selected, but no curve segments are added. Generating straight path preview.');
      } else if (config.curves.length > 5) {
        errors.push('Maximum of 5 curves supported in a single modular conveyor chain.');
      }

      config.curves?.forEach((curve, index) => {
        const curveNum = index + 1;
        if (curve.curveType === 'friction') {
          if (curve.angle < 20) {
            errors.push(`Curve ${curveNum}: Friction curve angle (${curve.angle}°) cannot be less than 20°.`);
          } else if (curve.angle > 180) {
            errors.push(`Curve ${curveNum}: Friction curve angle (${curve.angle}°) cannot exceed 180°.`);
          }
        } else if (curve.curveType === 'wheelband') {
          if (curve.angle !== 90 && curve.angle !== 180) {
            errors.push(`Curve ${curveNum}: Wheelband curve angle (${curve.angle}°) must be exactly 90° or 180°.`);
          }
        }

        // The inner rail sits at radius - frame half width; it must stay positive or the geometry inverts.
        const radius = resolveCurveRadius(curve, config.width);
        const minRadius = config.width / 2 + 25;
        if (radius < minRadius) {
          errors.push(`Curve ${curveNum}: Radius (${Math.round(radius)} mm) is too small for a ${config.width} mm chain. Minimum is ${Math.ceil(minRadius)} mm.`);
        }

        if (curve.offset < 200) {
          warnings.push(`Curve ${curveNum}: Straight lead-in offset (${curve.offset} mm) is recommended to be at least 200 mm from drive/idler end.`);
        }
      });
    }

    // 5. Working Height & Support validation
    if (config.workingHeight.enabled && config.workingHeight.type !== 'without-support') {
      if (config.workingHeight.height < 400) {
        errors.push(`Working height (${config.workingHeight.height} mm) is below the minimum ground clearance limit of 400 mm.`);
      } else if (config.workingHeight.height > 2000) {
        errors.push(`Working height (${config.workingHeight.height} mm) exceeds the standard support leg height limit of 2000 mm.`);
      }
    }

    // 6. Side Guides validation
    if (config.sideGuides && config.sideGuides.length > 0) {
      config.sideGuides.forEach((sg, index) => {
        const guideNum = index + 1;
        if (sg.widthBetweenGuides < config.width) {
          warnings.push(
            `Side guide ${guideNum}: Guide spacing (${sg.widthBetweenGuides} mm) is narrower than conveyor chain width (${config.width} mm). Recommended $\\ge$ ${config.width + 10} mm.`
          );
        }
        if (sg.heightAboveChain < 20) {
          warnings.push(`Side guide ${guideNum}: Height above chain (${sg.heightAboveChain} mm) is very low.`);
        } else if (sg.heightAboveChain > 300) {
          warnings.push(`Side guide ${guideNum}: Height above chain (${sg.heightAboveChain} mm) exceeds standard single-bracket reach.`);
        }
      });
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings
    };
  }
}
