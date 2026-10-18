import React, { useState, useMemo, useEffect } from 'react';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import axios from 'axios';
import {
  RotateCcw,
  HardDrive,
  ListCollapse,
  Printer,
  Download,
  FileCode,
  Check,
  Cpu,
  Layers,
  ShieldCheck,
  AlertTriangle,
  Loader2
} from 'lucide-react';
import confetti from 'canvas-confetti';
import { ConveyorConfiguration } from '../types/conveyor';
import { ValidationService } from '../services/validationService';
import { ConfigurationService } from '../services/configurationService';
import { ConveyorCanvas } from '../components/3d/ConveyorCanvas';
import { ParametricControls } from '../components/configurator/ParametricControls';
import { FocusTarget } from '../components/3d/ConveyorScene';
import { getBOMItemThumbnail, PRODUCT_ASSETS } from '../services/productAssetService';
import { generateExactConveyorStep } from '../services/stepGenerator';
import { fetchCadLayout, cadLayoutKey } from '../services/cadLayoutService';

// Dev falls back to the local API; production builds use same-origin /api (Vercel/Zeabur rewrites).
const API_BASE = import.meta.env.VITE_API_URL ?? (import.meta.env.DEV ? 'http://localhost:8000' : '');

export default function ConfiguratorPage() {
  // Centralized Configuration State
  const [configuration, setConfiguration] = useState<ConveyorConfiguration>(() =>
    ConfigurationService.getDefaultConfiguration()
  );

  const [focusedComponent, setFocusedComponent] = useState<FocusTarget>('overview');
  const [copiedJson, setCopiedJson] = useState(false);
  const [isExportingStep, setIsExportingStep] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [exportNote, setExportNote] = useState<string | null>(null);

  // Dev-only hook so the configurator can be driven from end-to-end checks
  useEffect(() => {
    if (import.meta.env.DEV) (window as unknown as Record<string, unknown>).__aluflexSetConfig = setConfiguration;
  }, []);

  // How the client's exact CAD parts are arranged for this configuration (debounced: backend call per settled edit)
  const [settledConfig, setSettledConfig] = useState(configuration);
  useEffect(() => {
    const t = setTimeout(() => setSettledConfig(configuration), 250);
    return () => clearTimeout(t);
  }, [configuration]);
  const { data: cadLayout } = useQuery({
    queryKey: ['cad-layout', settledConfig],
    queryFn: () => fetchCadLayout(settledConfig),
    placeholderData: keepPreviousData,
    staleTime: 60_000
  });

  // Stand count of the client's exact CAD model (only when its layout belongs to the current configuration)
  const exactStands = useMemo(() => {
    if (!cadLayout?.exact || !cadLayout.layout || cadLayout.key !== cadLayoutKey(configuration)) return undefined;
    return { legs: cadLayout.layout.legs, maxSpan: cadLayout.layout.maxSpan };
  }, [cadLayout, configuration]);

  // Validation
  const validation = useMemo(() => {
    return ValidationService.validate(configuration);
  }, [configuration]);

  // Synchronized Dynamic BOM & Specifications
  const dynamicBOM = useMemo(() => {
    return ConfigurationService.calculateDynamicBOM(configuration, exactStands);
  }, [configuration, exactStands]);

  const dynamicSpecs = useMemo(() => {
    return ConfigurationService.calculateDynamicSpecifications(configuration, exactStands);
  }, [configuration, exactStands]);

  // Any edit that departs from the reference preset must drop the preset flags, otherwise the
  // backend would keep returning the pre-made reference STEP for a different configuration.
  const handleConfigChange = (next: ConveyorConfiguration) => {
    const { presetId, isClientReferencePreset, ...rest } = next;
    setConfiguration(
      ConfigurationService.isReferencePreset(next)
        ? next
        : { ...rest, presetId: undefined, isClientReferencePreset: false }
    );
  };

  const handleReset = () => {
    setConfiguration(ConfigurationService.getDefaultConfiguration());
  };

  const handleExportJSON = () => {
    const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(configuration, null, 2));
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute('href', dataStr);
    downloadAnchor.setAttribute('download', `TEDES_Conveyor_Config_${configuration.chainMaterial}_${configuration.width}mm.json`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();

    confetti({
      particleCount: 50,
      spread: 60,
      origin: { y: 0.8 }
    });
  };



  const handleExportSTEP = async () => {
    if (isExportingStep) return;
    if (!validation.valid) {
      setExportError('Fix the configuration errors before exporting.');
      return;
    }
    setIsExportingStep(true);
    setExportError(null);
    setExportNote(null);

    try {
      let stepBlob: Blob | null = null;

      // Try backend FastAPI service first if available
      try {
        const response = await axios.post(
          `${API_BASE}/api/v1/conveyor/step`,
          configuration,
          { responseType: 'blob', timeout: 35000 }
        );
        if (response.data && response.data.size > 200) {
          stepBlob = new Blob([response.data], { type: 'application/step' });
          const mode = response.headers['x-cad-mode'];
          const why = response.headers['x-cad-reasons'];
          setExportNote(
            mode === 'exact'
              ? "STEP exported from the client's exact CAD parts (same parts as the 3D view)."
              : `STEP exported as an APPROXIMATE model - the client's real parts cannot express: ${why || 'this configuration'}.`
          );
          if (mode === 'exact' && why) setExportNote(`STEP exported from the client's exact CAD parts. Options without a client part (client part used): ${why}.`
          );
        }
      } catch (err) {
        if (cadLayout?.exact && cadLayout.key === cadLayoutKey(configuration)) {
          // The 3D view shows the client's exact parts: never hand out the old approximate model instead.
          setExportError('The exact-parts STEP export needs the backend (it could not be reached or rejected the configuration).');
          setIsExportingStep(false);
          return;
        }
        console.info('FastAPI unavailable or timed out, generating precision CAD STEP model directly client-side...', err);
      }

      // High-precision client-side generator fallback if backend unavailable
      if (!stepBlob) {
        // Only serve the pre-made reference file when the configuration is exactly the reference preset.
        const isUnmodifiedReference =
          configuration.isClientReferencePreset === true &&
          JSON.stringify(configuration) === JSON.stringify(ConfigurationService.getDefaultConfiguration());
        if (isUnmodifiedReference) {
          try {
            const staticRes = await fetch('/reference-model/804-125.stp');
            if (staticRes.ok) {
              stepBlob = await staticRes.blob();
            }
          } catch (e) {
            console.error('Failed to load static reference model', e);
          }
        }
        if (!stepBlob) {
          await new Promise((resolve) => setTimeout(resolve, 60));
          const stepContent = generateExactConveyorStep(configuration);
          stepBlob = new Blob([stepContent], { type: 'application/step' });
        }
      }

      const downloadUrl = window.URL.createObjectURL(stepBlob);
      const downloadAnchor = document.createElement('a');
      downloadAnchor.style.display = 'none';
      downloadAnchor.href = downloadUrl;
      downloadAnchor.download = `ALUFLEX_CONVEYOR_${configuration.chainMaterial}_${configuration.width}mm_${configuration.length}mm.step`;

      document.body.appendChild(downloadAnchor);
      downloadAnchor.click();

      // Clean up
      document.body.removeChild(downloadAnchor);
      window.URL.revokeObjectURL(downloadUrl);

      confetti({
        particleCount: 60,
        spread: 70,
        origin: { y: 0.8 }
      });
    } catch (err) {
      console.error('Failed to export CAD STEP model:', err);
      setExportError('STEP export failed. Please try again.');
    } finally {
      setIsExportingStep(false);
    }
  };




  const handlePrint = () => {
    window.print();
  };

  const handleCopySpec = () => {
    const text = `TEDES CONVEYOR CONFIGURATION
Material: ${configuration.chainMaterial.toUpperCase()}
Width: ${configuration.width} mm
Length: ${configuration.length} mm
Working Height: ${configuration.workingHeight.enabled ? `${configuration.workingHeight.height} mm (${configuration.workingHeight.type})` : 'None'}
Drive: ${configuration.drivePosition.toUpperCase()}
Motor: ${configuration.motor?.name || 'Motor 1'} (${dynamicSpecs.recommended_motor_power_kw} kW)
Shape: ${configuration.shape.toUpperCase()}
Estimated Weight: ${dynamicSpecs.total_weight_kg_est} kg`;

    navigator.clipboard.writeText(text);
    setCopiedJson(true);
    setTimeout(() => setCopiedJson(false), 2000);
  };

  return (
    <div className="relative flex-grow bg-cad-bg py-5 min-h-screen text-cad-textPrimary transition-colors duration-200">
      <div className="mx-auto max-w-[1720px] px-4 sm:px-6 relative z-10 flex flex-col gap-5">
        {/* Title Bar & Engineering Action Bar */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between border-b border-cad-border pb-3.5 gap-3">
          <div className="flex items-center gap-3">
            <h1 className="text-base sm:text-lg font-bold uppercase tracking-wider text-cad-textPrimary font-mono flex items-center gap-2">
              <span>ALUFLEX</span>
              <span className="text-xs text-cad-accent font-bold px-2 py-0.5 bg-cad-accent/10 border border-cad-accent/30 rounded">
                POWERED BY TEDES
              </span>
            </h1>
            <span className="bg-cad-panel border border-cad-border text-cad-textSecondary font-mono text-[10px] font-bold px-2 py-0.5 rounded hidden md:inline-block">
              PARAMETRIC CAD v2.4
            </span>
          </div>

          {/* Action Toolbar */}
          <div className="flex items-center gap-2 flex-wrap">

            <button
              onClick={handleExportJSON}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-cad-accent hover:bg-cad-accentHover text-white rounded font-mono text-xs font-semibold shadow-sm transition-colors"
            >
              <Download className="w-3.5 h-3.5" />
              <span>EXPORT CONFIGURATION</span>
            </button>

            <button
              onClick={handleExportSTEP}
              disabled={isExportingStep}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-white rounded font-mono text-xs font-semibold shadow-sm transition-all ${
                isExportingStep
                  ? 'bg-emerald-800 cursor-not-allowed opacity-80 ring-2 ring-emerald-400/30'
                  : 'bg-emerald-600 hover:bg-emerald-700 active:scale-95'
              }`}
            >
              {isExportingStep ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin text-emerald-200" />
              ) : (
                <Download className="w-3.5 h-3.5" />
              )}
              <span>{isExportingStep ? 'COMPILING CAD STEP...' : 'EXPORT CAD (.STEP)'}</span>
            </button>

            <button
              onClick={handleCopySpec}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-cad-panel hover:bg-cad-panelElevated border border-cad-border hover:border-cad-textSecondary text-cad-textSecondary hover:text-cad-textPrimary rounded font-mono text-xs font-semibold shadow-sm transition-colors"
            >
              {copiedJson ? <Check className="w-3.5 h-3.5 text-cad-success" /> : <FileCode className="w-3.5 h-3.5" />}
              <span>{copiedJson ? 'COPIED!' : 'COPY SUMMARY'}</span>
            </button>

            <button
              onClick={handlePrint}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-cad-panel hover:bg-cad-panelElevated border border-cad-border hover:border-cad-textSecondary text-cad-textSecondary hover:text-cad-textPrimary rounded font-mono text-xs font-semibold shadow-sm transition-colors"
            >
              <Printer className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">PRINT</span>
            </button>

            <button
              onClick={handleReset}
              title="Reset parameters to default preset"
              className="flex items-center gap-1.5 px-2.5 py-1.5 bg-cad-panel hover:bg-cad-panelElevated border border-cad-border hover:border-cad-error text-cad-textSecondary hover:text-cad-error rounded font-mono text-xs font-semibold shadow-sm transition-colors"
            >
              <RotateCcw className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>



        {/* Main 2-Column Industrial Workspace */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
          {/* Left Hero: 3D CAD Viewport */}
          <div className="lg:col-span-7 xl:col-span-8 flex flex-col">
            <div className="h-[560px] sm:h-[620px] w-full">
              <ConveyorCanvas
                configuration={configuration}
                cadLayout={cadLayout ?? null}
                focusedComponent={focusedComponent}
                onResetFocus={() => setFocusedComponent('overview')}
              />
            </div>
          </div>

          {/* Right Column: Parametric Controls Panel */}
          <div className="lg:col-span-5 xl:col-span-4 h-full">
            <ParametricControls
              configuration={configuration}
              onChange={handleConfigChange}
              onReset={handleReset}
              onFocusComponent={setFocusedComponent}
            />
          </div>
        </div>

        {/* Bottom Section: Engineering Specifications & Live BOM */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 pt-1">
          {/* Engineering Specifications Panel */}
          <div className="lg:col-span-5 spec-card rounded-xl p-5 space-y-4">
            <div className="flex items-center justify-between border-b border-cad-border pb-3">
              <h3 className="spec-title text-xs sm:text-sm font-mono uppercase tracking-wider flex items-center gap-2">
                <HardDrive className="spec-title-icon w-4 h-4" /> Engineering Specifications
              </h3>
              <span className="text-[10px] font-mono text-cad-textMuted uppercase">DIN / ISO RATED</span>
            </div>

            {/* Active Component Visual Preview Bar */}
            <div className="grid grid-cols-3 gap-2 p-2 rounded-lg bg-cad-panelElevated/50 border border-cad-border">
              {/* Motor */}
              <div className="flex flex-col items-center text-center p-1.5 rounded bg-white/70 border border-cad-border">
                <div className="w-10 h-10 flex items-center justify-center">
                  <img
                    src={configuration.driveKind === 'reductor' ? '/images/conveyor-motor-gearbox.png' : ((configuration.motor?.id && PRODUCT_ASSETS.motors[configuration.motor.id]?.primaryImage) || PRODUCT_ASSETS.motors['motor-001'].primaryImage)}
                    alt="Active Motor"
                    className="w-full h-full object-contain"
                  />
                </div>
                <span className="text-[9px] font-mono font-bold text-cad-textPrimary mt-1 truncate max-w-full uppercase">
                  {configuration.driveKind === 'reductor' ? 'Reductor Gearbox' : (configuration.driveKind === 'normal' ? 'Motor Head' : (configuration.motor?.name || 'Geared Motor'))}
                </span>
                <span className="text-[8px] font-mono text-cad-accent uppercase">
                  {configuration.drivePosition}
                </span>
              </div>

              {/* Chain */}
              <div className="flex flex-col items-center text-center p-1.5 rounded bg-white/70 border border-cad-border">
                <div className="w-10 h-10 flex items-center justify-center">
                  <img
                    src={PRODUCT_ASSETS.chains[configuration.chainMaterial]?.primaryImage || PRODUCT_ASSETS.chains.plastic.primaryImage}
                    alt="Active Chain"
                    className="w-full h-full object-contain"
                  />
                </div>
                <span className="text-[9px] font-mono font-bold text-cad-textPrimary mt-1 truncate max-w-full">
                  {configuration.chainMaterial.toUpperCase()} CHAIN
                </span>
                <span className="text-[8px] font-mono text-cad-textSecondary">
                  PITCH {dynamicSpecs.chain_pitch_mm} mm
                </span>
              </div>

              {/* Sprocket */}
              <div className="flex flex-col items-center text-center p-1.5 rounded bg-white/70 border border-cad-border">
                <div className="w-10 h-10 flex items-center justify-center">
                  <img
                    src={PRODUCT_ASSETS.sprockets.drive.primaryImage}
                    alt="Active Sprocket"
                    className="w-full h-full object-contain"
                  />
                </div>
                <span className="text-[9px] font-mono font-bold text-cad-textPrimary mt-1 truncate max-w-full">
                  DRIVE SPROCKET
                </span>
                <span className="text-[8px] font-mono text-cad-textSecondary">
                  {configuration.width} mm WIDTH
                </span>
              </div>
            </div>

            <div className="space-y-2.5 font-mono text-xs">
              <div className="spec-row flex justify-between items-center pb-2 pt-1">
                <span className="spec-label">CHAIN MATERIAL</span>
                <span className="spec-value uppercase">{configuration.chainMaterial}</span>
              </div>
              <div className="spec-row flex justify-between items-center pb-2">
                <span className="spec-label">WIDTH OF THE CHAIN</span>
                <span className="spec-value">{configuration.width} mm</span>
              </div>
              <div className="spec-row flex justify-between items-center pb-2">
                <span className="spec-label">TOTAL PATH LENGTH</span>
                <span className="spec-value">{dynamicSpecs.total_path_length_mm} mm</span>
              </div>
              <div className="spec-row flex justify-between items-center pb-2">
                <span className="spec-label">CHAIN PITCH</span>
                <span className="spec-value">{dynamicSpecs.chain_pitch_mm} mm</span>
              </div>
              <div className="spec-row flex justify-between items-center pb-2">
                <span className="spec-label">MAX TENSILE FORCE</span>
                <span className="spec-value">{dynamicSpecs.max_tensile_force_n} N</span>
              </div>
              <div className="spec-row flex justify-between items-center pb-2">
                <span className="spec-label">MAX LOAD ON THE CONVEYOR</span>
                <span className="spec-value">{configuration.loadPerMeter} kg/m</span>
              </div>
              <div className="spec-row flex justify-between items-center pb-2">
                <span className="spec-label">DRIVE ORIENTATION</span>
                <span className="spec-value uppercase">
                  {configuration.drivePosition} ({configuration.driveKind === 'reductor' ? 'REDUCTOR' : (configuration.driveKind === 'normal' ? 'MOTOR HEAD' : 'DIRECT')})
                </span>
              </div>
              <div className="spec-row flex justify-between items-center pb-2">
                <span className="spec-label">WORKING HEIGHT</span>
                <span className="spec-value">
                  {configuration.workingHeight.enabled
                    ? `${configuration.workingHeight.height} mm (${configuration.workingHeight.footType ? configuration.workingHeight.footType.replace(/-/g, ' ') : configuration.workingHeight.type})`
                    : 'Without Supports'}
                </span>
              </div>
              <div className="flex justify-between items-center pt-0.5">
                <span className="spec-label">MAX SUPPORT SPAN</span>
                <span className="text-cad-success font-bold text-xs">{dynamicSpecs.support_max_spacing_mm} mm</span>
              </div>
            </div>
          </div>

          {/* Synchronized Bill of Materials (BOM) */}
          <div className="lg:col-span-7 bom-card rounded-xl p-5 space-y-4">
            <div className="flex justify-between items-center border-b border-cad-border pb-3">
              <h3 className="bom-title text-xs sm:text-sm font-mono uppercase tracking-wider flex items-center gap-2">
                <ListCollapse className="bom-title-icon w-4 h-4" /> Live Bill of Materials (BOM)
              </h3>
              <span className="bom-badge text-[10px] font-mono px-2.5 py-1 rounded">
                {dynamicBOM.length} Line Items
              </span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left font-mono text-xs">
                <thead>
                  <tr className="bom-header text-[10px] sm:text-xs">
                    <th className="pb-2.5 uppercase tracking-wider">PART DESCRIPTION</th>
                    <th className="pb-2.5 text-right uppercase tracking-wider">QUANTITY</th>
                    <th className="pb-2.5 text-right uppercase tracking-wider">UNIT</th>
                  </tr>
                </thead>
                <tbody>
                  {dynamicBOM.map((item, idx) => (
                    <tr key={idx} className="bom-row transition-colors">
                      <td className="bom-desc py-2 pr-4">
                        <div className="flex items-center gap-2.5">
                          <div className="w-8 h-8 rounded bg-white border border-cad-border p-0.5 flex-shrink-0 flex items-center justify-center overflow-hidden shadow-2xs">
                            <img
                              src={getBOMItemThumbnail(item.item)}
                              alt={item.item}
                              className="w-full h-full object-contain"
                              loading="lazy"
                            />
                          </div>
                          <span className="font-semibold">{item.item}</span>
                        </div>
                      </td>
                      <td className="bom-qty py-2 text-right">{item.quantity}</td>
                      <td className="bom-unit py-2 text-right text-[11px] pl-2 uppercase">{item.unit}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {exportNote && !exportError && (
          <div role="status" className="flex items-center gap-2 rounded border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-xs font-mono text-emerald-500">
            <Check className="w-4 h-4" />
            <span>{exportNote}</span>
          </div>
        )}
        {exportError && (
          <div role="alert" className="flex items-center gap-2 rounded border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs font-mono text-red-400">
            <AlertTriangle className="w-4 h-4" />
            <span>{exportError}</span>
          </div>
        )}

        {/* STEP CAD Export Progress Overlay Modal */}
        {isExportingStep && (
          <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="bg-cad-panel border border-cad-border rounded-xl p-6 max-w-md w-full shadow-2xl flex flex-col items-center text-center space-y-4 animate-in fade-in zoom-in-95 duration-200">
              <div className="relative">
                <div className="w-16 h-16 rounded-full border-4 border-emerald-500/20 border-t-emerald-500 animate-spin" />
                <div className="absolute inset-0 flex items-center justify-center">
                  <Download className="w-6 h-6 text-emerald-400 animate-pulse" />
                </div>
              </div>
              <div className="space-y-1">
                <h3 className="font-mono text-base font-bold text-cad-textPrimary tracking-wide">
                  GENERATING CAD STEP MODEL
                </h3>
                <p className="text-xs text-cad-textSecondary font-sans">
                  Compiling ISO 10303-21 MANIFOLD_SOLID_BREP geometry, modular chain links, and single-column support stands...
                </p>
              </div>
              <div className="w-full bg-cad-background rounded-full h-1.5 overflow-hidden">
                <div className="bg-emerald-500 h-full w-2/3 animate-pulse rounded-full" />
              </div>
              <span className="font-mono text-[10px] text-emerald-400 tracking-widest uppercase font-semibold">
                Compiling CAD Entities • Please wait
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
