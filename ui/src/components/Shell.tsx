import type { ReactNode } from 'react';
import { Icon } from './Icon';
import { navItems, type RouteKey } from '../app/nav';

export function Shell({ route, onRoute, onRefresh, children }: { route: RouteKey; onRoute: (route: RouteKey) => void; onRefresh: () => void; children: ReactNode }) {
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
          <div><div className="topbar-title">{navItems.find((item) => item.key === route)?.label}</div><div className="topbar-subtitle">Operator console</div></div>
          <button className="icon-button" onClick={onRefresh} title="Refresh"><Icon name="refresh" /></button>
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
    </div>
  );
}
