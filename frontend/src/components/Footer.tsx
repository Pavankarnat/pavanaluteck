import React from 'react';
import { Link } from 'react-router-dom';
import { useTheme } from '../context/ThemeContext';
import { ExternalLink } from 'lucide-react';

export default function Footer() {
  const { theme } = useTheme();

  return (
    <footer className="app-footer border-t border-cad-border bg-white dark:bg-[#080E16] py-12 text-xs transition-colors duration-200">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        {/* Main 3-Column Section */}
        <div className="grid grid-cols-1 md:grid-cols-12 gap-8 pb-10 border-b border-cad-border">
          {/* Left Column: Brand & Engineering Identity (5 cols) */}
          <div className="md:col-span-5 flex flex-col items-start gap-3">
            <Link to="/" className="inline-block">
              <img
                src={theme === 'dark' ? '/images/logo-white.png' : '/images/logo.png'}
                alt="ALUTEC KK - Aluminium Structural System"
                className="h-8 w-auto object-contain"
                onError={(e) => {
                  const target = e.currentTarget;
                  if (!target.dataset.triedFallback) {
                    target.dataset.triedFallback = 'true';
                    target.src = '/images/logo.jpg';
                  }
                }}
              />
            </Link>
            <p className="text-cad-textSecondary text-[13px] leading-relaxed max-w-sm mt-1">
              Precision-engineered aluminium systems for industrial automation, production environments, material handling and custom engineering applications.
            </p>
            <div className="flex items-center gap-2 pt-1">
              <span className="font-mono text-[10px] uppercase font-bold tracking-wider text-cad-accent bg-cad-accent/10 border border-cad-accent/20 px-2 py-0.5 rounded">
                ESTABLISHED 1994
              </span>
              <span className="text-[11px] font-mono text-cad-textMuted">
                ALUTEC KK GROUP
              </span>
            </div>
          </div>

          {/* Center Column: Engineering Navigation (4 cols) */}
          <div className="md:col-span-4 flex flex-col gap-2.5">
            <h4 className="font-mono text-[11px] font-bold uppercase tracking-wider text-cad-textPrimary mb-1">
              Systems & Navigation
            </h4>
            <div className="grid grid-cols-2 gap-y-2 gap-x-4 text-xs font-mono">
              <Link to="/" className="text-cad-textSecondary hover:text-cad-accent transition-colors font-semibold">
                Configure
              </Link>
              <span className="text-cad-textMuted cursor-not-allowed flex items-center justify-between">
                <span>Conveyor Library</span>
              </span>
              <span className="text-cad-textMuted cursor-not-allowed flex items-center justify-between">
                <span>CAD Library</span>
              </span>
              <span className="text-cad-textMuted cursor-not-allowed flex items-center justify-between">
                <span>Saved Vault</span>
              </span>
              <span className="text-cad-textMuted cursor-not-allowed">
                Documentation
              </span>
            </div>
          </div>

          {/* Right Column: Legal & Support (3 cols) */}
          <div className="md:col-span-3 flex flex-col gap-2.5">
            <h4 className="font-mono text-[11px] font-bold uppercase tracking-wider text-cad-textPrimary mb-1">
              Technical & Support
            </h4>
            <div className="flex flex-col gap-2 text-xs font-mono">
              <a href="#" className="text-cad-textSecondary hover:text-cad-accent transition-colors">
                Privacy Policy
              </a>
              <a href="#" className="text-cad-textSecondary hover:text-cad-accent transition-colors">
                Terms of Service
              </a>
              <a href="#" className="text-cad-textSecondary hover:text-cad-accent transition-colors">
                Contact Support
              </a>
              <span className="text-[11px] text-cad-textMuted font-sans pt-1">
                ALUTEC KK • Industrial Systems & Conveyor Engineering Suite.
              </span>
            </div>
          </div>
        </div>

        {/* Bottom Bar: Copyright & Powered by TEDES.IN */}
        <div className="pt-6 flex flex-col sm:flex-row items-center justify-between gap-4 font-mono text-[11px] text-cad-textSecondary">
          <div>
            &copy; 2026 ALUTEC KK. All rights reserved.
          </div>

          {/* Powered by TEDES.IN credit */}
          <div className="flex items-center gap-1.5">
            <span className="text-cad-textMuted">Powered by</span>
            <a
              href="https://tedes.in"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 font-bold text-cad-accent hover:underline hover:text-cad-accentHover transition-colors uppercase tracking-wider"
            >
              <span>TEDES.IN</span>
              <ExternalLink className="w-3 h-3 stroke-[2.5]" />
            </a>
          </div>
        </div>
      </div>
    </footer>
  );
}
