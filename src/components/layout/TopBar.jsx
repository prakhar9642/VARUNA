import { Link, useLocation } from 'react-router-dom';
import { useStore } from '../../store/useStore';
import { NAV_SECTIONS } from './navSections';

export default function TopBar() {
  const location = useLocation();
  const searchQuery = useStore((s) => s.filters.searchQuery);
  const setFilter = useStore((s) => s.setFilter);
  const theme = useStore((s) => s.theme);
  const toggleTheme = useStore((s) => s.toggleTheme);
  const effectiveMode = useStore((s) => s.effectiveMode);
  const toggleNavDrawer = useStore((s) => s.toggleNavDrawer);

  // Derive active category and page label from current path
  let activeCategory = 'OPERATIONS';
  let activePageLabel = 'Command Centre';
  for (const sec of NAV_SECTIONS) {
    for (const item of sec.items) {
      if (item.path === location.pathname || (item.path === '/command-centre' && (location.pathname === '/' || location.pathname === '/dashboard' || location.pathname === '/map'))) {
        activeCategory = sec.category;
        activePageLabel = item.label;
        break;
      }
    }
  }

  return (
    <header className="h-14 px-3 sm:px-6 bg-[var(--varuna-surface)] border-b border-[var(--varuna-border)] flex items-center justify-between shrink-0 z-30 transition-colors">
      {/* Left: Menu Trigger (☰) + Product Brand */}
      <div className="flex items-center gap-2 sm:gap-3">
        {/* Navigation Drawer Menu Button */}
        <button
          onClick={toggleNavDrawer}
          className="w-9 h-9 flex items-center justify-center rounded-[var(--radius-md)] hover:bg-[var(--varuna-surface-soft)] text-[var(--varuna-text)] transition-colors cursor-pointer border border-[var(--varuna-border)] shadow-2xs"
          title="Open Navigation Menu"
          aria-label="Open Navigation Menu"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="3" y1="6" x2="21" y2="6" />
            <line x1="3" y1="12" x2="21" y2="12" />
            <line x1="3" y1="18" x2="21" y2="18" />
          </svg>
        </button>

        <Link to="/" className="flex items-center gap-2.5 group">
          <div className="w-8 h-8 rounded-[var(--radius-md)] bg-[var(--varuna-blue)] text-white flex items-center justify-center shadow-xs group-hover:bg-[var(--varuna-blue-dark)] transition-colors shrink-0">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
              <path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z" />
              <path d="M13 13l-3 5h4l-2 5" />
            </svg>
          </div>
          <div className="flex flex-col">
            <div className="flex items-center gap-1.5">
              <span className="text-scale-base font-bold tracking-tight text-[var(--varuna-text)] leading-none">
                VARUNA
              </span>
              <span className="text-[10px] font-bold px-1.5 py-0.2 rounded bg-[var(--varuna-blue-light)] text-[var(--varuna-blue-dark)] font-data hidden xs:inline">
                NWP-AI
              </span>
            </div>
            <span className="text-[9px] font-semibold tracking-wider text-[var(--varuna-text-secondary)] uppercase mt-0.5 hidden sm:inline">
              Adaptive Weather Intelligence
            </span>
          </div>
        </Link>

        {/* Section Context Breadcrumb (Nirikshan-style Category Anchor) */}
        <div className="hidden lg:flex items-center gap-1.5 ml-2 pl-3 border-l border-[var(--varuna-border)] text-[11px] font-data">
          <span className="text-[var(--varuna-text-muted)] uppercase tracking-wider">{activeCategory}</span>
          <span className="text-[var(--varuna-border-strong)]">/</span>
          <span className="font-bold text-[var(--varuna-blue-dark)]">{activePageLabel}</span>
        </div>

        {/* Data Mode Pill */}
        <div className="hidden md:flex items-center gap-1.5 ml-2 pl-3 border-l border-[var(--varuna-border)]">
          <span className="relative flex h-2 w-2">
            <span
              className={`inline-flex rounded-full h-2 w-2 ${
                effectiveMode === 'LIVE'
                  ? 'bg-emerald-500 animate-ping'
                  : effectiveMode === 'REPLAY'
                  ? 'bg-sky-500'
                  : 'bg-amber-500'
              }`}
            />
          </span>
          <span className="text-[11px] text-[var(--varuna-text-secondary)] font-data tabular-nums">
            {effectiveMode === 'LIVE'
              ? 'GATEWAY · 00Z STREAM'
              : effectiveMode === 'REPLAY'
              ? 'REPLAY · ERA5 ARCHIVE'
              : 'CACHED FORECAST DATA'}
          </span>
        </div>
      </div>

      {/* Center: Search Bar */}
      <div className="flex-1 max-w-xs sm:max-w-sm mx-2 sm:mx-4">
        <div className="relative">
          <svg
            className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--varuna-text-muted)] pointer-events-none"
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            type="text"
            placeholder="Search regions, zones, regimes..."
            value={searchQuery}
            onChange={(e) => setFilter('searchQuery', e.target.value)}
            className="w-full h-8 pl-8 pr-3 text-scale-xs bg-[var(--varuna-surface-soft)] border border-[var(--varuna-border)] rounded-[var(--radius-md)] text-[var(--varuna-text)] placeholder:text-[var(--varuna-text-muted)] focus:outline-none focus:border-[var(--varuna-blue)] focus:bg-[var(--varuna-surface)] focus:ring-1 focus:ring-[var(--varuna-blue)] transition-colors"
          />
        </div>
      </div>

      {/* Right: Technical Meta & Controls */}
      <div className="flex items-center gap-2 sm:gap-3 text-scale-xs text-[var(--varuna-text-secondary)] shrink-0">
        <span className="font-data hidden lg:inline text-[11px]">IFS · AIFS · GFS · ICON</span>
        <div className="w-px h-4 bg-[var(--varuna-border)] hidden lg:block" />

        <span className="font-data font-semibold text-[var(--varuna-blue)] px-2 py-0.5 rounded bg-[var(--varuna-blue-light)] text-[11px] hidden sm:inline">
          SIH 2026
        </span>
        <div className="w-px h-4 bg-[var(--varuna-border)] hidden sm:block" />

        {/* Dark/Light mode toggle */}
        <button
          onClick={toggleTheme}
          className="p-1.5 rounded-[var(--radius-md)] hover:bg-[var(--varuna-surface-soft)] text-[var(--varuna-text-secondary)] hover:text-[var(--varuna-text)] transition-colors cursor-pointer border border-transparent hover:border-[var(--varuna-border)]"
          title={`Switch to ${theme === 'light' ? 'Dark' : 'Light'} Mode`}
          aria-label="Toggle theme"
        >
          {theme === 'light' ? (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
            </svg>
          ) : (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="5" />
              <line x1="12" y1="1" x2="12" y2="3" />
              <line x1="12" y1="21" x2="12" y2="23" />
              <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
              <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
              <line x1="1" y1="12" x2="3" y2="12" />
              <line x1="21" y1="12" x2="23" y2="12" />
              <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
              <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
            </svg>
          )}
        </button>

        {/* Operational Disclaimer tooltip icon */}
        <span
          className="inline-flex items-center text-[var(--varuna-text-muted)] hover:text-[var(--varuna-text)] transition-colors cursor-help p-1"
          title="VARUNA: Multi-model adaptive ensemble blending ECMWF IFS, ECMWF AIFS, NOAA GFS, and DWD ICON with contextual XGBoost error estimation and historical ERA5 reference evaluation."
          aria-label="Operational Disclaimer"
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="16" x2="12" y2="12" />
            <line x1="12" y1="8" x2="12.01" y2="8" />
          </svg>
        </span>
      </div>
    </header>
  );
}
