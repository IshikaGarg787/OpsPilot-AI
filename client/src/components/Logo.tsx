import { Link } from 'react-router-dom';

export function Logo({ compact = false }: { compact?: boolean }) {
  return <Link className="brand" to="/" aria-label="Pragya home">
    <img className="brand-mark" style={{ background: 'transparent', boxShadow: 'none', borderRadius: 0, objectFit: 'contain' }} src="/assets/pragya-mark.svg" alt="" aria-hidden="true" />
    {!compact && <span className="brand-name">Pragya</span>}
  </Link>;
}
