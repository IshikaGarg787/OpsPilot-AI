import { Activity, BarChart3, BrainCircuit, ChevronDown, Clock3, Gauge, History, LayoutDashboard, LogOut, Menu, PanelLeftClose, PanelLeftOpen, Settings, Ticket, UserRoundCog, Plus, X, ShieldCheck, ListChecks, Users } from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { Link, NavLink, useLocation, useNavigate, useOutlet } from 'react-router-dom';
import { Fragment, useEffect, useRef, useState } from 'react';
import { Logo } from './Logo';
import { ThemeToggle } from './ThemeToggle';
import { useAuth } from '../contexts/AuthContext';

const adminNavItems = [
  { to: '/app', label: 'Overview', icon: LayoutDashboard, end: true },
  { to: '/app/tickets', label: 'Ticket Queue', icon: Ticket },
  { to: '/app/triage', label: 'Pipeline', icon: BrainCircuit },
  { to: '/app/recommendations', label: 'Recommendation Engine', icon: ListChecks },
  { to: '/app/models', label: 'Model Center', icon: Gauge },
  { to: '/app/history', label: 'Prediction History', icon: History },
  { to: '/app/analytics', label: 'Analytics', icon: BarChart3 },
  { to: '/app/workforce', label: 'IT Workforce', icon: Users },
  { to: '/app/sla', label: 'SLA Management', icon: ShieldCheck },
  { to: '/app/users', label: 'Users & Roles', icon: UserRoundCog },
  { to: '/app/settings', label: 'Settings', icon: Settings },
];
const teamNavItems = [
  { to: '/app', label: 'Overview', icon: LayoutDashboard, end: true },
  { to: '/app/tickets', label: 'My tickets & assignments', icon: Ticket },
  { to: '/app/tickets/new', label: 'Raise an issue', icon: Plus },
  { to: '/app/history', label: 'My AI estimates', icon: History },
  { to: '/app/settings', label: 'Settings', icon: Settings },
];
const customerNavItems = [
  { to: '/app', label: 'Overview', icon: LayoutDashboard, end: true },
  { to: '/app/tickets', label: 'My tickets', icon: Ticket },
  { to: '/app/tickets/new', label: 'Raise a ticket', icon: Plus },
  { to: '/app/settings', label: 'Settings', icon: Settings },
];

const pageNames: Record<string, string> = {
  '/app': 'Overview',
  '/app/tickets': 'Tickets',
  '/app/tickets/new': 'Raise a ticket',
  '/app/predictions': 'AI Predictions',
  '/app/triage': 'Pipeline',
  '/app/recommendations': 'Recommendation Engine',
  '/app/resolution-time': 'Resolution Time',
  '/app/models': 'Model Center',
  '/app/history': 'Prediction History',
  '/app/analytics': 'Analytics',
  '/app/settings': 'Settings',
  '/app/operational-risk': 'Operational Risk',
  '/app/workforce': 'IT Workforce',
  '/app/users': 'Users & Roles',
  '/app/sla': 'SLA Management',
};

export function AppShell() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const reduceMotion = useReducedMotion();
  const outlet = useOutlet();
  const routeContentRef = useRef<HTMLDivElement>(null);
  const isWorkforceMemberPage = /^\/app\/workforce\/[^/]+$/.test(location.pathname);
  const pageName = pageNames[location.pathname] ?? (location.pathname.startsWith('/app/tickets/') ? 'Ticket detail' : isWorkforceMemberPage ? 'Member profile' : 'Workspace');
  const navItems = user?.role === 'admin' ? adminNavItems : user?.role === 'customer' ? customerNavItems : teamNavItems;
  const initials = user?.name.split(' ').map((name) => name[0]).slice(0, 2).join('').toUpperCase() ?? 'OP';

  async function handleLogout() {
    await logout();
    navigate('/login');
  }

  const roleLabel = user?.role === 'admin' ? 'Admin' : user?.role === 'it_team' ? 'IT Team' : 'Customer';

  useEffect(() => {
    const root = routeContentRef.current;
    if (!root || reduceMotion || !('IntersectionObserver' in window)) return;

    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add('scroll-reveal-visible');
        observer.unobserve(entry.target);
      });
    }, { threshold: 0.08, rootMargin: '0px 0px -24px 0px' });
    const observed = new WeakSet<Element>();
    const observeTargets = () => {
      root.querySelectorAll<HTMLElement>(
        '.metric-card, .ticket-row, .ticket-audit-list > div, .customer-timeline li, .model-summary-row',
      ).forEach((element, index) => {
        if (observed.has(element)) return;
        observed.add(element);
        element.classList.add('scroll-reveal');
        element.style.setProperty('--scroll-reveal-delay', `${Math.min(index, 5) * 38}ms`);
        observer.observe(element);
      });
    };
    const mutations = new MutationObserver(observeTargets);
    observeTargets();
    mutations.observe(root, { childList: true, subtree: true });
    return () => { mutations.disconnect(); observer.disconnect(); };
  }, [location.pathname, reduceMotion]);

  return (
    <div className={`app-shell ${collapsed ? 'sidebar-collapsed' : ''}`}>
      <div className={`mobile-overlay ${mobileOpen ? 'show' : ''}`} onClick={() => setMobileOpen(false)} />
      <aside className={`sidebar ${mobileOpen ? 'mobile-open' : ''}`}>
        <div className="sidebar-top">
          <Logo compact={collapsed} />
          <button className="icon-button mobile-close" onClick={() => setMobileOpen(false)} aria-label="Close navigation">
            <X size={18} />
          </button>
        </div>
        <div className="workspace-switcher" title={`${user?.name} · ${roleLabel}`}>
          <span className="workspace-avatar">{user?.name ? user.name[0].toUpperCase() : 'O'}</span>
          {!collapsed && (
            <span>
              <small>{roleLabel} workspace</small>
              <strong>My workspace</strong>
            </span>
          )}
          {!collapsed && <ChevronDown size={15} />}
        </div>
        <nav className="sidebar-nav" aria-label="Application navigation">
          <span className="nav-caption">{user?.role === 'admin' ? 'Admin operations' : user?.role === 'it_team' ? 'IT workspace' : 'Customer workspace'}</span>
          {navItems.map(({ to, label, icon: Icon, end }) => (
            <Fragment key={to}>
              {to === '/app/recommendations' && <span className="nav-caption nav-caption-spaced">Decision support</span>}
              <NavLink
                to={to}
                end={end}
                onClick={() => setMobileOpen(false)}
                className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
                title={collapsed ? label : undefined}
              >
                {({ isActive }) => <>
                  {isActive && (reduceMotion
                    ? <span className="nav-active-marker" aria-hidden="true" />
                    : <motion.span className="nav-active-marker" layoutId="sidebar-active-marker" transition={{ type: 'spring', stiffness: 460, damping: 38 }} aria-hidden="true" />)}
                  <Icon size={18} />
                  <span>{!collapsed && label}</span>
                </>}
              </NavLink>
            </Fragment>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="sidebar-status">
            <Activity size={16} />
            {!collapsed && <span>Health checks in Model Center</span>}
          </div>
          <button className="nav-item logout-item" onClick={handleLogout} title="Log out">
            <LogOut size={18} />
            {!collapsed && <span>Log out</span>}
          </button>
        </div>
      </aside>
      <main className="main-shell">
        <header className="topbar">
          <button className="icon-button menu-button" onClick={() => setMobileOpen(true)} aria-label="Open navigation">
            <Menu size={20} />
          </button>
          <div className="topbar-context">
            <div className="breadcrumb" aria-label="Breadcrumb">
              <Link to="/app" className="breadcrumb-link">OpsPilot AI</Link>
              <span className="slash">/</span>
              {isWorkforceMemberPage ? <><Link to="/app/workforce" className="breadcrumb-link">IT Workforce</Link><span className="slash">/</span></> : null}
              <strong>{pageName}</strong>
            </div>
          </div>
          <div className="topbar-actions">
            <ThemeToggle />
            <button className="collapse-button icon-button" onClick={() => setCollapsed((value) => !value)} aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}>
              {collapsed ? <PanelLeftOpen size={19} /> : <PanelLeftClose size={19} />}
            </button>
            <button className="profile-chip" onClick={() => navigate('/app/settings')}>
              <span className="avatar">{initials}</span>
              <span className="profile-copy">
                <strong>{user?.name}</strong>
                <small>{user?.email} · {roleLabel}</small>
              </span>
              <ChevronDown size={15} />
            </button>
          </div>
        </header>
        <div className="content-wrap">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              className="route-stage"
              ref={routeContentRef}
              key={location.pathname}
              initial={reduceMotion ? false : { opacity: 0, y: 7 }}
              animate={{ opacity: 1, y: 0 }}
              exit={reduceMotion ? undefined : { opacity: 0, y: -4 }}
              transition={reduceMotion ? { duration: 0 } : { duration: .18, ease: 'easeOut' }}
            >
              {outlet}
            </motion.div>
          </AnimatePresence>
        </div>
      </main>
    </div>
  );
}
