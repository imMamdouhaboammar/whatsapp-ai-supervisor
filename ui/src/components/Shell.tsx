import { useEffect, useState, type ReactNode } from 'react';
import { Icon } from './Icon';
import { navItems, type RouteKey } from '../app/nav';
import '../styles/mobile-menu.css';

export function Shell({
  route,
  onRoute,
  onRefresh,
  realtimeConnected = false,
  children
}: {
  route: RouteKey;
  onRoute: (route: RouteKey) => void;
  onRefresh: () => void;
  realtimeConnected?: boolean;
  children: ReactNode;
}) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  useEffect(() => {
    setMobileMenuOpen(false);
  }, [route]);

  useEffect(() => {
    if (!mobileMenuOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMobileMenuOpen(false);
    };
    addEventListener('keydown', onKeyDown);
    return () => removeEventListener('keydown', onKeyDown);
  }, [mobileMenuOpen]);

  return (
    <div className="shell">
      <aside className="nav-drawer">
        <button className="brand" onClick={() => onRoute('overview')} aria-label="Go to overview">
          <span className="brand-mark"><Icon name="smart" size={22} /></span>
          <span className="brand-copy"><strong>Supervisor</strong><small>WhatsApp AI</small></span>
        </button>
        <nav className="nav-list" aria-label="Primary navigation">
          {navItems.map((item) => (
            <button key={item.key} className={`nav-item ${route === item.key ? 'selected' : ''}`} onClick={() => onRoute(item.key)}>
              <Icon name={item.icon} size={20} /><span>{item.label}</span>
            </button>
          ))}
        </nav>
        <div className="nav-foot">Local + VPS ready</div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <div className="topbar-leading">
            <button className="icon-button mobile-menu-button" onClick={() => setMobileMenuOpen(true)} aria-label="Open navigation menu"><Icon name="menu" /></button>
            <div><div className="topbar-title">{navItems.find((item) => item.key === route)?.label}</div><div className="topbar-subtitle">Operator console</div></div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              fontSize: '0.8rem',
              fontWeight: 500,
              padding: '4px 10px',
              borderRadius: 12,
              background: realtimeConnected ? '#e6f4ea' : '#fce8e6',
              color: realtimeConnected ? '#137333' : '#c5221f'
            }}>
              <span style={{
                width: 8,
                height: 8,
                borderRadius: '50%',
                background: realtimeConnected ? '#34a853' : '#ea4335',
                boxShadow: realtimeConnected ? '0 0 6px #34a853' : 'none'
              }} />
              <span>{realtimeConnected ? 'Live Real-Time' : 'Connecting...'}</span>
            </div>
            <button className="icon-button" onClick={onRefresh} title="Refresh" aria-label="Refresh current page"><Icon name="refresh" /></button>
          </div>
        </header>
        <main className="content">{children}</main>
      </div>
      <nav className="bottom-nav" aria-label="Mobile navigation">
        {navItems.slice(0, 5).map((item) => (
          <button key={item.key} className={route === item.key ? 'selected' : ''} onClick={() => onRoute(item.key)}>
            <Icon name={item.icon} size={20} /><span>{item.label}</span>
          </button>
        ))}
      </nav>
      {mobileMenuOpen ? <div className="mobile-menu-scrim" onClick={() => setMobileMenuOpen(false)}>
        <aside className="mobile-menu-sheet" role="dialog" aria-modal="true" aria-label="Navigation menu" onClick={(event) => event.stopPropagation()}>
          <div className="mobile-menu-head">
            <div><strong>Supervisor</strong><span>Operator console</span></div>
            <button className="icon-button" onClick={() => setMobileMenuOpen(false)} aria-label="Close navigation menu"><Icon name="close" /></button>
          </div>
          <nav className="mobile-menu-nav" aria-label="All destinations">
            {navItems.map((item) => (
              <button key={item.key} className={`mobile-menu-item ${route === item.key ? 'selected' : ''}`} onClick={() => onRoute(item.key)}>
                <Icon name={item.icon} size={21} /><span>{item.label}</span>
              </button>
            ))}
          </nav>
        </aside>
      </div> : null}
    </div>
  );
}
