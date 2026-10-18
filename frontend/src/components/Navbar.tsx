import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Sliders, BookOpen, Library, Save, Menu, X, Sun, Moon } from 'lucide-react';
import { useTheme } from '../context/ThemeContext';

export default function Navbar() {
  const location = useLocation();
  const [isOpen, setIsOpen] = React.useState(false);
  const { theme, toggleTheme } = useTheme();

  const navItems = [
    { name: 'Configure', path: '/', icon: Sliders, enabled: true },
    { name: 'Conveyor Library', path: '#', icon: Library, enabled: false, badge: 'CAD Lib' },
    { name: 'Saved Configurations', path: '#', icon: Save, enabled: false, badge: 'Vault' },
    { name: 'Documentation', path: '#', icon: BookOpen, enabled: false },
  ];

  return (
    <nav className="app-navbar h-16 border-b border-cad-border bg-white/95 dark:bg-[#0A1018]/95 backdrop-blur-sm sticky top-0 z-50 select-none transition-colors duration-200">
      <div className="mx-auto max-w-[1720px] h-full px-4 sm:px-6">
        <div className="flex h-full items-center justify-between">
          {/* Left: Brand Identity */}
          <div className="flex items-center gap-6 lg:gap-8">
            <Link to="/" className="flex items-center gap-3 group py-1">
              <img
                src={theme === 'dark' ? '/images/logo-white.png' : '/images/logo.png'}
                alt="ALUTEC KK - Aluminium Structural System"
                className="h-8 sm:h-9 w-auto max-w-[200px] object-contain transition-transform group-hover:scale-[1.02]"
                onError={(e) => {
                  const target = e.currentTarget;
                  if (!target.dataset.triedFallback) {
                    target.dataset.triedFallback = 'true';
                    target.src = '/images/logo.jpg';
                  }
                }}
              />
            </Link>

            <div className="h-5 w-[1px] bg-cad-border hidden lg:block" />

            {/* Center Navigation Links */}
            <div className="hidden lg:flex items-center gap-1">
              {navItems.map((item) => {
                const isActive = location.pathname === item.path;

                if (!item.enabled) {
                  return (
                    <div
                      key={item.name}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-mono font-medium text-cad-textMuted cursor-not-allowed select-none"
                    >
                      <span>{item.name}</span>
                      {item.badge && (
                        <span className="text-[9px] font-mono px-1 py-0.2 bg-cad-panel border border-cad-border text-cad-textSecondary rounded">
                          {item.badge}
                        </span>
                      )}
                    </div>
                  );
                }

                return (
                  <Link
                    key={item.name}
                    to={item.path}
                    className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-mono font-semibold rounded transition-all duration-150 ${
                      isActive
                        ? 'bg-cad-accent/10 text-cad-accent border border-cad-accent/30 shadow-xs'
                        : 'text-cad-textSecondary hover:text-cad-textPrimary hover:bg-cad-panel'
                    }`}
                  >
                    <span>{item.name}</span>
                  </Link>
                );
              })}
            </div>
          </div>

          {/* Right Status & Controls */}
          <div className="flex items-center gap-3">
            {/* Theme Toggle Button */}
            <button
              onClick={toggleTheme}
              title={`Switch to ${theme === 'dark' ? 'Light' : 'Dark'} Mode`}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-cad-panel hover:bg-cad-panelElevated border border-cad-border text-cad-textPrimary text-xs font-mono font-semibold transition-all duration-200 shadow-sm"
            >
              {theme === 'dark' ? (
                <>
                  <Sun className="w-3.5 h-3.5 text-amber-400" />
                  <span className="hidden sm:inline text-[11px]">Light</span>
                </>
              ) : (
                <>
                  <Moon className="w-3.5 h-3.5 text-sky-600" />
                  <span className="hidden sm:inline text-[11px]">Dark</span>
                </>
              )}
            </button>

            {/* Mobile menu toggle button */}
            <div className="flex lg:hidden">
              <button
                onClick={() => setIsOpen(!isOpen)}
                className="p-2 rounded text-cad-textSecondary hover:text-cad-textPrimary hover:bg-cad-panel"
                aria-label="Toggle navigation menu"
              >
                {isOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Mobile Menu */}
      {isOpen && (
        <div className="lg:hidden border-b border-cad-border bg-white dark:bg-[#0B121B] px-4 py-3 space-y-1.5 shadow-xl">
          {navItems.map((item) => {
            const isActive = location.pathname === item.path;

            if (!item.enabled) {
              return (
                <div
                  key={item.name}
                  className="flex items-center justify-between px-3 py-2 text-xs font-mono text-cad-textMuted"
                >
                  <span>{item.name}</span>
                  {item.badge && (
                    <span className="text-[9px] px-1.5 py-0.5 bg-cad-panel text-cad-textSecondary rounded border border-cad-border">
                      {item.badge}
                    </span>
                  )}
                </div>
              );
            }

            return (
              <Link
                key={item.name}
                to={item.path}
                onClick={() => setIsOpen(false)}
                className={`block px-3 py-2 text-xs font-mono font-medium rounded ${
                  isActive
                    ? 'bg-cad-accent/10 text-cad-accent border border-cad-accent/30 font-bold'
                    : 'text-cad-textSecondary hover:bg-cad-panel hover:text-cad-textPrimary'
                }`}
              >
                {item.name}
              </Link>
            );
          })}
        </div>
      )}
    </nav>
  );
}
