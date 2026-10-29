import { AlertCircle, ArrowUpRight, CheckCircle2, ChevronRight, LoaderCircle, Sparkles } from 'lucide-react';
import type { ReactNode } from 'react';
import type { ModelStatus } from '../types';

export function Button({ children, variant = 'primary', type = 'button', className = '', disabled = false, onClick }: { children: ReactNode; variant?: 'primary' | 'secondary' | 'ghost' | 'danger'; type?: 'button' | 'submit' | 'reset'; className?: string; disabled?: boolean; onClick?: () => void }) {
  return <button className={`button button-${variant} ${className}`} type={type} disabled={disabled} onClick={onClick}>{children}</button>;
}

export function ButtonLink({ children, to, variant = 'primary', className = '' }: { children: ReactNode; to: string; variant?: 'primary' | 'secondary' | 'ghost'; className?: string }) {
  return <a className={`button button-${variant} ${className}`} href={to}>{children}</a>;
}

export function PageIntro({ eyebrow, title, description, action }: { eyebrow?: string; title: string; description?: string; action?: ReactNode }) {
  return <div className="page-intro"><div>{eyebrow && <p className="eyebrow">{eyebrow}</p>}<h1>{title}</h1>{description && <p className="page-description">{description}</p>}</div>{action}</div>;
}

export function MetricCard({ label, value, detail, icon: Icon, accent = 'blue' }: { label: string; value: string; detail?: string; icon: typeof Sparkles; accent?: 'blue' | 'teal' | 'violet' | 'amber' }) {
  return <article className={`metric-card metric-${accent}`}><div className="metric-top"><span>{label}</span><span className="metric-icon"><Icon size={18} /></span></div><strong>{value}</strong>{detail && <small>{detail}</small>}</article>;
}

export function StatusPill({ status }: { status: ModelStatus | 'success' | 'failed' }) {
  const labels = { available: 'Available', coming_soon: 'Coming soon', unavailable: 'Unavailable', success: 'Completed', failed: 'Failed' };
  return <span className={`status-pill status-${status}`}><span className="status-dot" />{labels[status]}</span>;
}

export function Card({ children, className = '', title, action }: { children: ReactNode; className?: string; title?: string; action?: ReactNode }) {
  return <section className={`card ${className}`}>{(title || action) && <div className="card-heading">{title && <h2>{title}</h2>}{action}</div>}{children}</section>;
}

export function LoadingState({ label = 'Loading workspace' }: { label?: string }) {
  return <div className="state-block"><LoaderCircle className="spin" size={24} /><span>{label}</span></div>;
}

export function EmptyState({ title, description, action }: { title: string; description: string; action?: ReactNode }) {
  return <div className="state-block empty-state"><span className="empty-icon"><Sparkles size={19} /></span><strong>{title}</strong><span>{description}</span>{action}</div>;
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return <div className="state-block error-state"><AlertCircle size={22} /><strong>{message}</strong>{onRetry && <Button variant="secondary" onClick={onRetry}>Try again</Button>}</div>;
}

export function Notice({ children, variant = 'info' }: { children: ReactNode; variant?: 'info' | 'warning' | 'success' }) {
  return <div className={`notice notice-${variant}`}><span>{variant === 'warning' ? <AlertCircle size={17} /> : variant === 'success' ? <CheckCircle2 size={17} /> : <Sparkles size={17} />}</span><div>{children}</div></div>;
}

export function LinkArrow({ children }: { children: ReactNode }) {
  return <span className="link-arrow">{children}<ArrowUpRight size={15} /></span>;
}

export function Breadcrumb({ label }: { label: string }) {
  return <div className="breadcrumb"><span>Workspace</span><ChevronRight size={14} /><strong>{label}</strong></div>;
}
