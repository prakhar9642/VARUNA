import { useEffect } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { useStore } from '../../store/useStore';
import { NAV_SECTIONS } from './navSections';

export default function NavDrawer() {
  const location = useLocation();
  const reduceMotion = useReducedMotion();
  const navDrawerOpen = useStore((s) => s.navDrawerOpen);
  const setNavDrawerOpen = useStore((s) => s.setNavDrawerOpen);

  // Close on Escape key press
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') setNavDrawerOpen(false);
    };
    if (navDrawerOpen) {
      window.addEventListener('keydown', handleKeyDown);
    }
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [navDrawerOpen, setNavDrawerOpen]);

  const closeDrawer = () => setNavDrawerOpen(false);

  return (
    <AnimatePresence>
      {navDrawerOpen && (
        <>
          {/* Backdrop with click-to-close */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 bg-[#0C1726]/40 z-40 backdrop-blur-[2px]"
            onClick={closeDrawer}
            aria-label="Close navigation"
          />

          {/* Left Slide-in Navigation Drawer (280px - 320px) */}
          <motion.aside
            initial={reduceMotion ? { opacity: 0 } : { x: '-100%' }}
            animate={reduceMotion ? { opacity: 1 } : { x: 0 }}
            exit={reduceMotion ? { opacity: 1 } : { x: '-100%' }}
            transition={
              reduceMotion
                ? { duration: 0 }
                : { duration: 0.22, ease: [0.16, 1, 0.3, 1] }
            }
            className="fixed top-0 left-0 bottom-0 w-[290px] sm:w-[320px] max-w-[85vw] bg-[var(--varuna-surface)] border-r border-[var(--varuna-border)] z-50 flex flex-col shadow-2xl overflow-hidden font-sans"
            role="dialog"
            aria-label="Application Navigation"
          >
            {/* Drawer Header */}
            <div className="h-16 px-5 border-b border-[var(--varuna-border)] flex items-center justify-between shrink-0 bg-[var(--varuna-surface)]">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-[var(--radius-md)] bg-[var(--varuna-blue)] text-white flex items-center justify-center shadow-xs shrink-0">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z" />
                    <path d="M13 13l-3 5h4l-2 5" />
                  </svg>
                </div>
                <div className="flex flex-col">
                  <span className="font-bold tracking-tight text-scale-base text-[var(--varuna-text)] leading-none">
                    VARUNA
                  </span>
                  <span className="text-[10px] font-semibold text-[var(--varuna-text-secondary)] tracking-wider uppercase mt-0.5">
                    Weather Intelligence
                  </span>
                </div>
              </div>

              {/* Close Button */}
              <button
                onClick={closeDrawer}
                className="w-8 h-8 rounded-[var(--radius-md)] hover:bg-[var(--varuna-surface-soft)] text-[var(--varuna-text-secondary)] hover:text-[var(--varuna-text)] flex items-center justify-center transition-colors cursor-pointer"
                title="Close menu (Esc)"
                aria-label="Close menu"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>

            {/* Sub-header Context Banner */}
            <div className="px-5 py-2.5 bg-[var(--varuna-surface-soft)] border-b border-[var(--varuna-border)] flex items-center justify-between text-[11px] text-[var(--varuna-text-secondary)] font-data">
              <span>WORKSPACES</span>
              <span className="text-[var(--varuna-blue-dark)] font-semibold">7 MODULES</span>
            </div>

            {/* Navigation Links List Grouped by Intent */}
            <nav className="flex-1 overflow-y-auto p-3 space-y-4">
              {NAV_SECTIONS.map((section) => (
                <div key={section.category} className="space-y-1">
                  <div className="px-3 py-1 text-[10px] font-bold tracking-wider text-[var(--varuna-text-muted)] font-data uppercase">
                    {section.category}
                  </div>
                  {section.items.map((item) => {
                    const isActive =
                      location.pathname === item.path ||
                      (item.path === '/command-centre' && (location.pathname === '/' || location.pathname === '/dashboard' || location.pathname === '/map'));
                    const Icon = ICON_MAP[item.icon] || CommandIcon;

                    return (
                      <NavLink
                        key={item.path}
                        to={item.path}
                        onClick={closeDrawer}
                        className={`
                          group relative flex items-start gap-3 px-3 py-2.5 rounded-[var(--radius-md)]
                          transition-all duration-150
                          ${
                            isActive
                              ? 'bg-[var(--varuna-blue-light)] text-[var(--varuna-blue-dark)] font-bold shadow-2xs border-l-3 border-[var(--varuna-blue)]'
                              : 'bg-transparent text-[var(--varuna-text-secondary)] hover:bg-[var(--varuna-surface-soft)] hover:text-[var(--varuna-text)] font-medium border-l-3 border-transparent'
                          }
                        `}
                      >
                        <div className={`mt-0.5 shrink-0 ${isActive ? 'text-[var(--varuna-blue)]' : 'text-[var(--varuna-text-muted)] group-hover:text-[var(--varuna-text)]'}`}>
                          <Icon size={16} active={isActive} />
                        </div>
                        <div className="flex flex-col min-w-0">
                          <span className="text-scale-xs leading-snug">
                            {item.label}
                          </span>
                          <span className={`text-[10px] leading-tight mt-0.5 truncate ${isActive ? 'text-[var(--varuna-blue-dark)] opacity-90' : 'text-[var(--varuna-text-muted)]'}`}>
                            {item.description}
                          </span>
                        </div>
                      </NavLink>
                    );
                  })}
                </div>
              ))}
            </nav>

            {/* Drawer Footer */}
            <div className="p-4 border-t border-[var(--varuna-border)] bg-[var(--varuna-surface-soft)]/60 text-[11px] text-[var(--varuna-text-secondary)] space-y-1 shrink-0 font-data">
              <div className="flex items-center justify-between font-semibold text-[var(--varuna-text)]">
                <span>SIH 2026 · Problem SIH26081</span>
                <span className="text-emerald-700 dark:text-emerald-400">● 4/4 NWP</span>
              </div>
              <div className="text-[10px] text-[var(--varuna-text-muted)]">
                ECMWF IFS · AIFS · NOAA GFS · DWD ICON
              </div>
            </div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}

/* --- Clean SVG Icons --- */
function CommandIcon({ size = 18, active }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={active ? 2.3 : 1.8} strokeLinecap="round" strokeLinejoin="round">
      <polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6" />
      <line x1="8" y1="2" x2="8" y2="18" />
      <line x1="16" y1="6" x2="16" y2="22" />
    </svg>
  );
}

function CloudIcon({ size = 18, active }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={active ? 2.3 : 1.8} strokeLinecap="round" strokeLinejoin="round">
      <path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z" />
    </svg>
  );
}

function AlertIcon({ size = 18, active }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={active ? 2.3 : 1.8} strokeLinecap="round" strokeLinejoin="round">
      <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  );
}

function BrainIcon({ size = 18, active }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={active ? 2.3 : 1.8} strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2a7 7 0 0 1 7 7c0 2.38-1.19 4.47-3 5.74V17a2 2 0 0 1-2 2h-4a2 2 0 0 1-2-2v-2.26C6.19 13.47 5 11.38 5 9a7 7 0 0 1 7-7z" />
      <line x1="9" y1="22" x2="15" y2="22" />
      <line x1="10" y1="19" x2="14" y2="19" />
    </svg>
  );
}

function LayersIcon({ size = 18, active }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={active ? 2.3 : 1.8} strokeLinecap="round" strokeLinejoin="round">
      <polygon points="12 2 2 7 12 12 22 7 12 2" />
      <polyline points="2 17 12 22 22 17" />
      <polyline points="2 12 12 17 22 12" />
    </svg>
  );
}

function ChartIcon({ size = 18, active }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={active ? 2.3 : 1.8} strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="20" x2="18" y2="10" />
      <line x1="12" y1="20" x2="12" y2="4" />
      <line x1="6" y1="20" x2="6" y2="14" />
    </svg>
  );
}

function GearIcon({ size = 18, active }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={active ? 2.3 : 1.8} strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}

const ICON_MAP = {
  command: CommandIcon,
  cloud: CloudIcon,
  alert: AlertIcon,
  brain: BrainIcon,
  layers: LayersIcon,
  chart: ChartIcon,
  gear: GearIcon,
};

